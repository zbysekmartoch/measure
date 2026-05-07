import os from 'os';
import { performance as nodePerformance } from 'perf_hooks';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

const RATE_WINDOW_MS = 60_000;
const USER_ACTIVITY_WINDOW_MS = Number(process.env.PERF_ACTIVE_USER_TTL_MS || 30_000);
const MAX_RECENT_REQUESTS = Number(process.env.PERF_RECENT_REQUESTS_LIMIT || 500);
const API_LIMIT_WINDOW_MS = Number(config.requestLimits?.api?.windowMs || 60_000);
const API_LIMIT_MAX_PER_KEY = Number(config.requestLimits?.api?.maxPerKey || 1200);

let totalApiRequests = 0;
let inFlightRequests = 0;
let peakInFlightRequests = 0;

const statusTotals = {
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
  '429': 0,
};

let latencyEwmaMs = 0;
const latencySamples = []; // [timestampMs, latencyMs]

const requestTimestamps = [];
const status429Timestamps = [];
const status4xxTimestamps = [];
const status5xxTimestamps = [];
const recentRequests = [];
let totalRecentRequestsObserved = 0;
const apiKeyUsage = new Map(); // key -> { userId, timestamps[] }

const activeUsers = new Map(); // userId -> lastSeen timestamp
let activePerformanceStreams = 0;
const userProfileCache = new Map(); // userId -> userName
const userProfilePending = new Set();

let loopLagEwmaMs = 0;
const loopIntervalMs = 1000;
let loopLastTick = nodePerformance.now();
const loopMonitor = setInterval(() => {
  const now = nodePerformance.now();
  const lag = Math.max(0, now - loopLastTick - loopIntervalMs);
  loopLagEwmaMs = loopLagEwmaMs === 0 ? lag : (loopLagEwmaMs * 0.85) + (lag * 0.15);
  loopLastTick = now;
}, loopIntervalMs);
if (typeof loopMonitor.unref === 'function') {
  loopMonitor.unref();
}

let lastCpuSampleAt = Date.now();
let lastCpuUsage = process.cpuUsage();

function pruneOld(arr, now, windowMs) {
  const cutoff = now - windowMs;
  while (arr.length > 0 && arr[0] < cutoff) {
    arr.shift();
  }
}

function pruneLatencySamples(now) {
  const cutoff = now - RATE_WINDOW_MS;
  while (latencySamples.length > 0 && latencySamples[0][0] < cutoff) {
    latencySamples.shift();
  }
}

function pruneActiveUsers(now) {
  const cutoff = now - USER_ACTIVITY_WINDOW_MS;
  for (const [userId, ts] of activeUsers.entries()) {
    if (ts < cutoff) {
      activeUsers.delete(userId);
    }
  }
}

function pruneApiKeyUsage(now) {
  const cutoff = now - API_LIMIT_WINDOW_MS;
  const activeUserIds = new Set(activeUsers.keys());

  for (const [key, entry] of apiKeyUsage.entries()) {
    const ts = entry.timestamps;
    while (ts.length > 0 && ts[0] < cutoff) {
      ts.shift();
    }
    const hasActiveUser = entry.userId != null && activeUserIds.has(String(entry.userId));
    if (ts.length === 0 && !hasActiveUser) {
      apiKeyUsage.delete(key);
    }
  }
}

function maintenance(now = Date.now()) {
  pruneOld(requestTimestamps, now, RATE_WINDOW_MS);
  pruneOld(status429Timestamps, now, RATE_WINDOW_MS);
  pruneOld(status4xxTimestamps, now, RATE_WINDOW_MS);
  pruneOld(status5xxTimestamps, now, RATE_WINDOW_MS);
  pruneLatencySamples(now);
  pruneActiveUsers(now);
  pruneApiKeyUsage(now);
}

function pushRecentRequest(entry) {
  totalRecentRequestsObserved += 1;
  recentRequests.push(entry);
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.shift();
  }
}

function addUserActivity(userId, now = Date.now()) {
  if (userId == null) return;
  const id = String(userId);
  activeUsers.set(id, now);
  ensureUserNameLoaded(id);
}

function getTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.query?.token === 'string' && req.query.token.length > 0) {
    return req.query.token;
  }
  return null;
}

function resolveUserIdFromRequest(req) {
  if (req.userId != null) return String(req.userId);

  const token = getTokenFromRequest(req);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.userId != null) {
      return String(decoded.userId);
    }
  } catch {
    // Ignore invalid token and fall back to unknown user.
  }

  return null;
}

function recordApiKeyUsage(req, now) {
  if (!req.originalUrl?.startsWith('/api/v1/')) return;
  if (req.originalUrl.startsWith('/api/v1/performance/')) return;
  if ((req.headers.accept || '').includes('text/event-stream')) return;

  const userId = resolveUserIdFromRequest(req);
  if (!userId) return;

  const key = `user:${userId}`;
  let entry = apiKeyUsage.get(key);
  if (!entry) {
    entry = { userId, timestamps: [] };
    apiKeyUsage.set(key, entry);
  }
  entry.userId = userId;
  entry.timestamps.push(now);

  addUserActivity(userId, now);
}

function getUserName(userId) {
  if (!userId) return 'Unknown user';
  return userProfileCache.get(String(userId)) || `User #${userId}`;
}

function ensureUserNameLoaded(userId) {
  const id = String(userId);
  if (userProfileCache.has(id) || userProfilePending.has(id)) return;
  userProfilePending.add(id);

  query('SELECT first_name, last_name FROM usr WHERE id = ?', [id])
    .then((rows) => {
      if (rows.length > 0) {
        const row = rows[0];
        const first = String(row.first_name || '').trim();
        const last = String(row.last_name || '').trim();
        const userName = `${first} ${last}`.trim() || `User #${id}`;
        userProfileCache.set(id, userName);
      } else {
        userProfileCache.set(id, `User #${id}`);
      }
    })
    .catch(() => {
      userProfileCache.set(id, `User #${id}`);
    })
    .finally(() => {
      userProfilePending.delete(id);
    });
}

function buildApiKeyUsage() {
  const max = Math.max(1, API_LIMIT_MAX_PER_KEY);
  const items = [];

  for (const [userId] of activeUsers.entries()) {
    const key = `user:${userId}`;
    const entry = apiKeyUsage.get(key);
    const used = entry ? entry.timestamps.length : 0;
    const usagePercentRaw = (used / max) * 100;
    const usagePercent = Math.max(0, Math.min(100, usagePercentRaw));

    items.push({
      key,
      userId,
      userName: getUserName(userId),
      used,
      max,
      remaining: Math.max(0, max - used),
      usagePercent: Number(usagePercent.toFixed(2)),
    });
  }

  return items.sort((a, b) => b.usagePercent - a.usagePercent || a.userName.localeCompare(b.userName));
}

function classifyStatus(statusCode) {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  return '2xx';
}

function sampleCpuPercent(now) {
  const elapsedMs = now - lastCpuSampleAt;
  const elapsedMicros = elapsedMs * 1000;
  const usageDelta = process.cpuUsage(lastCpuUsage);

  lastCpuSampleAt = now;
  lastCpuUsage = process.cpuUsage();

  if (elapsedMicros <= 0) return 0;

  const usedMicros = usageDelta.user + usageDelta.system;
  const cores = Math.max(1, os.cpus().length || 1);
  const cpuPct = (usedMicros / elapsedMicros) * (100 / cores);
  return Number.isFinite(cpuPct) ? cpuPct : 0;
}

function averageLatency1m() {
  if (latencySamples.length === 0) return 0;
  let sum = 0;
  for (const [, latencyMs] of latencySamples) {
    sum += latencyMs;
  }
  return sum / latencySamples.length;
}

export function markAuthenticatedUser(userId) {
  addUserActivity(userId);
}

export function markPerformanceStreamConnected() {
  activePerformanceStreams += 1;
}

export function markPerformanceStreamDisconnected() {
  activePerformanceStreams = Math.max(0, activePerformanceStreams - 1);
}

export function performanceMetricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  inFlightRequests += 1;
  peakInFlightRequests = Math.max(peakInFlightRequests, inFlightRequests);

  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;

    inFlightRequests = Math.max(0, inFlightRequests - 1);

    if (!req.originalUrl?.startsWith('/api/')) {
      return;
    }

    if (req.originalUrl.startsWith('/api/v1/performance/')) {
      return;
    }

    const now = Date.now();
    const statusCode = Number(res.statusCode) || 0;
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const endpoint = (req.originalUrl || req.url || '').split('?')[0] || '/';
    const query = (() => {
      const raw = req.originalUrl || req.url || '';
      const idx = raw.indexOf('?');
      return idx >= 0 ? raw.slice(idx + 1) : '';
    })();

    totalApiRequests += 1;
    requestTimestamps.push(now);

    const bucket = classifyStatus(statusCode);
    statusTotals[bucket] += 1;

    if (statusCode === 429) {
      statusTotals['429'] += 1;
      status429Timestamps.push(now);
    }
    if (statusCode >= 400 && statusCode < 500) {
      status4xxTimestamps.push(now);
    }
    if (statusCode >= 500) {
      status5xxTimestamps.push(now);
    }

    recordApiKeyUsage(req, now);

    latencyEwmaMs = latencyEwmaMs === 0 ? latencyMs : (latencyEwmaMs * 0.85) + (latencyMs * 0.15);
    latencySamples.push([now, latencyMs]);

    pushRecentRequest({
      ts: now,
      method: req.method || 'GET',
      endpoint,
      query,
      statusCode,
      latencyMs: Number(latencyMs.toFixed(2)),
      userId: req.userId == null ? null : String(req.userId),
    });

    addUserActivity(req.userId, now);
    maintenance(now);
  };

  res.on('finish', finalize);
  res.on('close', finalize);
  next();
}

export function getPerformanceSnapshot({ chatUsers = 0 } = {}) {
  const now = Date.now();
  maintenance(now);

  const apiKeyUsageItems = buildApiKeyUsage();

  const mem = process.memoryUsage();
  const cpuPercent = sampleCpuPercent(now);

  const requestPerMinute = requestTimestamps.length;
  const status429PerMinute = status429Timestamps.length;
  const status4xxPerMinute = status4xxTimestamps.length;
  const status5xxPerMinute = status5xxTimestamps.length;

  return {
    timestamp: new Date(now).toISOString(),
    uptimeSec: Math.round(process.uptime()),
    users: {
      activeAuthenticated: activeUsers.size,
      activeInChat: Number(chatUsers) || 0,
      activityWindowSec: Math.round(USER_ACTIVITY_WINDOW_MS / 1000),
    },
    requests: {
      total: totalApiRequests,
      inFlight: inFlightRequests,
      peakInFlight: peakInFlightRequests,
      perMinute: requestPerMinute,
      perSecond: Number((requestPerMinute / 60).toFixed(2)),
      rateLimitedPerMinute: status429PerMinute,
      errors4xxPerMinute: status4xxPerMinute,
      errors5xxPerMinute: status5xxPerMinute,
      statusTotals: {
        ...statusTotals,
      },
      apiKeyUsage: apiKeyUsageItems,
    },
    requestLimits: {
      jsonBodyLimit: config.requestLimits?.jsonBodyLimit || '1mb',
      auth: {
        windowMs: Number(config.requestLimits?.auth?.windowMs || 60_000),
        maxPerIp: Number(config.requestLimits?.auth?.maxPerIp || 40),
      },
      api: {
        windowMs: API_LIMIT_WINDOW_MS,
        maxPerKey: API_LIMIT_MAX_PER_KEY,
      },
    },
    latency: {
      ewmaMs: Number(latencyEwmaMs.toFixed(2)),
      avgMs1m: Number(averageLatency1m().toFixed(2)),
    },
    runtime: {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      eventLoopLagMs: Number(loopLagEwmaMs.toFixed(2)),
      activePerformanceStreams,
      rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      externalMb: Number((mem.external / (1024 * 1024)).toFixed(2)),
      loadAvg1m: Number((os.loadavg()?.[0] ?? 0).toFixed(2)),
    },
  };
}

export function getRecentRequests({ limit = 150 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 150, 1000));
  const slice = recentRequests.slice(-safeLimit).reverse();

  return {
    totalObserved: totalRecentRequestsObserved,
    buffered: recentRequests.length,
    items: slice.map((r) => ({
      timestamp: new Date(r.ts).toISOString(),
      method: r.method,
      endpoint: r.endpoint,
      query: r.query,
      statusCode: r.statusCode,
      latencyMs: r.latencyMs,
      userId: r.userId,
    })),
  };
}