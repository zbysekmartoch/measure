import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import path from 'path';
import { config } from '../config.js';

const OFFICE_DOC_TYPES = {
  docx: 'word',
  xlsx: 'cell',
};

const OFFICE_EXTENSIONS = new Set(Object.keys(OFFICE_DOC_TYPES));

const FORCE_SAVE_INTERVAL_MS = Number.isFinite(Number(config.office.forceSaveIntervalMs))
  ? Math.max(5000, Number(config.office.forceSaveIntervalMs))
  : 30000;

const FORCE_SAVE_WAIT_TIMEOUT_MS = Number.isFinite(Number(config.office.forceSaveWaitTimeoutMs))
  ? Math.max(1000, Number(config.office.forceSaveWaitTimeoutMs))
  : 12000;

const SESSION_PREREGISTRATION_TTL_MS = Number.isFinite(Number(config.office.sessionPreregistrationTtlMs))
  ? Math.max(1000, Number(config.office.sessionPreregistrationTtlMs))
  : 120000;

// sessionId -> session metadata
const activeOfficeSessions = new Map();
// document key -> sessionId
const officeKeyToSessionId = new Map();

function asString(value, fallback = '') {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeResultId(resultId) {
  return asString(resultId, '-');
}

function normalizeScope({ area, labId, resultId, filePath }) {
  return {
    area: asString(area),
    labId: asString(labId),
    resultId: normalizeResultId(resultId),
    filePath: asString(filePath),
  };
}

function makeOfficeSessionId(scope) {
  return `${scope.area}::${scope.labId}::${scope.resultId}::${scope.filePath}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createSessionKey(sessionId) {
  return crypto
    .createHash('sha1')
    .update(`${sessionId}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 40);
}

function parseCommandServiceResponse(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getSessionByContext(scope) {
  return activeOfficeSessions.get(makeOfficeSessionId(scope)) || null;
}

function getSessionByKey(key) {
  const sessionId = officeKeyToSessionId.get(asString(key));
  if (!sessionId) return null;
  return activeOfficeSessions.get(sessionId) || null;
}

function toOfficeUserDisplay(user) {
  const name = asString(user?.name || user?.displayName);
  if (name) return name;
  const email = asString(user?.email);
  if (email) return email;
  return 'Unknown user';
}

function upsertSessionUser(session, user) {
  const userId = asString(user?.id);
  if (!userId) return;
  session.users.set(userId, {
    id: userId,
    name: toOfficeUserDisplay(user),
    email: asString(user?.email),
    lastSeenAt: nowIso(),
  });
}

function toSessionSnapshot(session) {
  const users = [...session.users.values()]
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      lastSeenAt: u.lastSeenAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    key: session.key,
    area: session.area,
    labId: session.labId,
    resultId: session.resultId === '-' ? null : session.resultId,
    filePath: session.filePath,
    users,
    userCount: users.length,
    forceSaveIntervalMs: FORCE_SAVE_INTERVAL_MS,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function resolveSessionWaiters(session, payload) {
  const waiters = [...session.waiters];
  session.waiters = [];

  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutId);
    if (payload?.ok === false) {
      waiter.reject(new Error(payload.reason || payload.message || 'Office session closed'));
    } else {
      waiter.resolve(payload);
    }
  }
}

function clearSessionTimer(session) {
  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
}

function removeSession(session, reason = 'closed') {
  if (!session) return;
  clearSessionTimer(session);
  activeOfficeSessions.delete(session.id);
  officeKeyToSessionId.delete(session.key);
  resolveSessionWaiters(session, { ok: false, reason });
}

function waitForSessionSave(session, timeoutMs = FORCE_SAVE_WAIT_TIMEOUT_MS) {
  const waitMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1000, Number(timeoutMs))
    : FORCE_SAVE_WAIT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timeoutId: null,
    };

    waiter.timeoutId = setTimeout(() => {
      session.waiters = session.waiters.filter((w) => w !== waiter);
      reject(new Error(`Timed out waiting for Office save callback (${waitMs} ms)`));
    }, waitMs);

    session.waiters.push(waiter);
  });
}

async function commandForceSave(session) {
  ensureOfficeConfigured();

  const payload = { c: 'forcesave', key: session.key };
  const token = jwt.sign(payload, config.office.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });

  const response = await fetch(`${config.office.documentServerUrl}/coauthoring/CommandService.ashx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, token }),
  });

  const raw = await response.text();
  const data = parseCommandServiceResponse(raw);
  const parsedError = Number(data?.error);
  const errorCode = Number.isFinite(parsedError) ? parsedError : (response.ok ? 0 : response.status);

  if (response.ok && errorCode === 0) {
    return { accepted: true, errorCode: 0 };
  }

  // Error 1: key not found in DS — session ended without our knowledge, clean up.
  if (errorCode === 1) {
    removeSession(session, 'session_missing_on_document_server');
    return {
      accepted: false,
      skipped: true,
      errorCode,
      message: 'Document Server no longer tracks this session key',
    };
  }

  // Error 4: no unsaved changes in DS — document is already in sync, nothing to do.
  if (errorCode === 4) {
    return {
      accepted: false,
      skipped: true,
      errorCode,
      message: 'No unsaved changes in Document Server (already in sync)',
    };
  }

  return {
    accepted: false,
    errorCode,
    message: data?.message || data?.raw || `CommandService returned error ${errorCode}`,
  };
}

async function syncSingleSession(session, { waitForSave = true, timeoutMs = FORCE_SAVE_WAIT_TIMEOUT_MS } = {}) {
  const force = await commandForceSave(session);
  if (!force.accepted) {
    if (force.skipped) {
      return {
        ok: true,
        skipped: true,
        reason: 'session_not_found_in_document_server',
      };
    }
    return {
      ok: false,
      errorCode: force.errorCode,
      error: force.message || `CommandService error ${force.errorCode}`,
    };
  }

  if (!waitForSave) {
    return {
      ok: true,
      queued: true,
    };
  }

  try {
    const saved = await waitForSessionSave(session, timeoutMs);
    return {
      ok: true,
      queued: false,
      status: saved.status,
      savedAt: saved.savedAt,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
    };
  }
}

export function isOfficeConfigured() {
  return Boolean(
    config.office.enabled
    && config.office.documentServerUrl
    && config.office.jwtSecret
    && config.office.tokenSecret,
  );
}

export function ensureOfficeConfigured() {
  if (!isOfficeConfigured()) {
    const err = new Error('Office integration is not configured');
    err.statusCode = 503;
    throw err;
  }
}

export function getOfficeFileExtension(filePath) {
  return path.extname(String(filePath || '')).slice(1).toLowerCase();
}

export function isOfficeFilePath(filePath) {
  return OFFICE_EXTENSIONS.has(getOfficeFileExtension(filePath));
}

export function getOfficeDocumentType(extension) {
  return OFFICE_DOC_TYPES[String(extension || '').toLowerCase()] || null;
}

export function getOfficeDocumentServerUrl() {
  return config.office.documentServerUrl;
}

export function resolveOfficeAppUrl(req) {
  if (config.office.appUrl) return config.office.appUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

export function makeCollaborativeDocumentKey(scope, filePath, mtimeMs) {
  const source = `${scope}::${filePath}::${Number.isFinite(mtimeMs) ? mtimeMs : 0}`;
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 40);
}

export function createOfficeViewDocumentKey({ area, labId, resultId, filePath }) {
  const scope = normalizeScope({ area, labId, resultId, filePath });
  return makeCollaborativeDocumentKey(
    `${makeOfficeSessionId(scope)}:view`,
    scope.filePath,
    Date.now() + Math.floor(Math.random() * 1000),
  );
}

export function ensureOfficeEditSession({ area, labId, resultId, filePath, user }) {
  ensureOfficeConfigured();

  const scope = normalizeScope({ area, labId, resultId, filePath });
  if (!scope.area || !scope.labId || !scope.filePath) {
    const err = new Error('Invalid office edit session scope');
    err.statusCode = 400;
    throw err;
  }

  let session = getSessionByContext(scope);
  const sessionId = makeOfficeSessionId(scope);

  if (!session) {
    const key = createSessionKey(sessionId);
    session = {
      id: sessionId,
      key,
      area: scope.area,
      labId: scope.labId,
      resultId: scope.resultId,
      filePath: scope.filePath,
      users: new Map(),
      timer: null,
      waiters: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    activeOfficeSessions.set(sessionId, session);
    officeKeyToSessionId.set(session.key, session.id);

    const preregisteredKey = session.key;
    setTimeout(() => {
      const current = activeOfficeSessions.get(sessionId);
      if (current && current.key === preregisteredKey && !current.timer) {
        removeSession(current, 'preregistration_expired');
      }
    }, SESSION_PREREGISTRATION_TTL_MS);
  }

  upsertSessionUser(session, user);
  session.updatedAt = nowIso();

  return toSessionSnapshot(session);
}

export function markOfficeSessionOpened({ area, labId, resultId, filePath, key }) {
  if (!key) return null;

  const scope = normalizeScope({ area, labId, resultId, filePath });
  let session = getSessionByContext(scope) || getSessionByKey(key);

  if (!session) {
    const sessionId = makeOfficeSessionId(scope);
    session = {
      id: sessionId,
      key: String(key),
      area: scope.area,
      labId: scope.labId,
      resultId: scope.resultId,
      filePath: scope.filePath,
      users: new Map(),
      timer: null,
      waiters: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    activeOfficeSessions.set(sessionId, session);
    officeKeyToSessionId.set(session.key, session.id);
  }

  if (session.key !== String(key)) {
    return toSessionSnapshot(session);
  }

  session.updatedAt = nowIso();

  if (!session.timer) {
    session.timer = setInterval(() => {
      const current = getSessionByKey(session.key);
      if (!current) return;
      commandForceSave(current).catch((e) => {
        console.warn('[office forcesave] interval error:', e.message);
      });
    }, FORCE_SAVE_INTERVAL_MS);
  }

  return toSessionSnapshot(session);
}

export function markOfficeSessionSaved({ area, labId, resultId, filePath, key, status }) {
  const scope = normalizeScope({ area, labId, resultId, filePath });
  const session = (key ? getSessionByKey(key) : null) || getSessionByContext(scope);
  if (!session) return null;

  session.updatedAt = nowIso();
  resolveSessionWaiters(session, {
    ok: true,
    status,
    savedAt: session.updatedAt,
    key: session.key,
    filePath: session.filePath,
  });

  return toSessionSnapshot(session);
}

export function closeOfficeSession({ area, labId, resultId, filePath, key, reason = 'closed' }) {
  const scope = normalizeScope({ area, labId, resultId, filePath });
  const session = (key ? getSessionByKey(key) : null) || getSessionByContext(scope);
  if (!session) return false;
  if (key && session.key !== String(key)) return false;

  removeSession(session, reason);
  return true;
}

export function listOfficeSessionsForScope({ area, labId, resultId }) {
  const normalizedArea = asString(area);
  const normalizedLabId = asString(labId);
  const normalizedResultId = normalizeResultId(resultId);

  const out = {};
  for (const session of activeOfficeSessions.values()) {
    if (session.area !== normalizedArea) continue;
    if (session.labId !== normalizedLabId) continue;
    if (session.resultId !== normalizedResultId) continue;
    out[session.filePath] = toSessionSnapshot(session);
  }
  return out;
}

export async function syncOfficeSessionForFile({ area, labId, resultId, filePath, waitForSave = true, timeoutMs = FORCE_SAVE_WAIT_TIMEOUT_MS }) {
  const scope = normalizeScope({ area, labId, resultId, filePath });
  const session = getSessionByContext(scope);

  if (!session) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_active_session',
      filePath: scope.filePath,
    };
  }

  const result = await syncSingleSession(session, { waitForSave, timeoutMs });
  return {
    ...result,
    filePath: session.filePath,
    key: session.key,
    area: session.area,
    labId: session.labId,
    resultId: session.resultId === '-' ? null : session.resultId,
  };
}

export async function syncAllOfficeSessionsForLab(labId, { waitForSave = true, timeoutMs = FORCE_SAVE_WAIT_TIMEOUT_MS } = {}) {
  const normalizedLabId = asString(labId);
  const sessions = [...activeOfficeSessions.values()]
    .filter((session) => session.labId === normalizedLabId && session.area !== 'current_output');

  if (sessions.length === 0) {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };
  }

  const details = await Promise.all(sessions.map(async (session) => {
    const result = await syncSingleSession(session, { waitForSave, timeoutMs });
    return {
      ...result,
      area: session.area,
      labId: session.labId,
      resultId: session.resultId === '-' ? null : session.resultId,
      filePath: session.filePath,
      key: session.key,
    };
  }));

  const synced = details.filter((item) => item.ok && !item.skipped).length;
  const skipped = details.filter((item) => item.skipped).length;
  const failed = details.filter((item) => !item.ok).length;

  return {
    total: details.length,
    synced,
    skipped,
    failed,
    details,
  };
}

export function signOfficeAccessToken(payload) {
  return jwt.sign(
    { ...payload, type: 'office-access' },
    config.office.tokenSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.office.accessTokenTtl,
    },
  );
}

export function verifyOfficeAccessToken(token) {
  return jwt.verify(token, config.office.tokenSecret, { algorithms: ['HS256'] });
}

export function signOfficeDocumentConfig(configPayload) {
  const token = jwt.sign(configPayload, config.office.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.office.configTokenTtl,
  });
  return { ...configPayload, token };
}

export function decodeOfficeCallbackPayload(body) {
  let payload = body || {};

  // Document Server with outbox JWT wraps callback payload inside body.token.
  if (payload.token && config.office.jwtSecret) {
    try {
      const decoded = jwt.verify(payload.token, config.office.jwtSecret, { algorithms: ['HS256'] });
      if (decoded && typeof decoded === 'object' && decoded.status !== undefined) {
        payload = decoded;
      }
    } catch {
      // Fall back to plain callback payload.
    }
  }

  return payload;
}
