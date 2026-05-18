import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import api from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { getPool } from './db.js';
import { attachDapProxy } from './debug/dap-proxy.js';
import { attachChatWs } from './chat/chat-ws.js';
import { startBackupScheduler, stopBackupScheduler } from './utils/backup-scheduler.js';
import { performanceMetricsMiddleware } from './utils/performance-metrics.js';
import { initUserStore, userStoreNeedsSql } from './users/index.js';

const app = express();

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

function getRateLimitKey(req) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      if (decoded?.userId != null) {
        return `user:${decoded.userId}`;
      }
    } catch {
      // Fall back to IP key when token is missing/invalid.
    }
  }
  return `ip:${req.ip}`;
}

// Logging
app.use(pinoHttp({
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'silent';
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
}));

// Runtime metrics collection for /api/v1/performance/stats
app.use(performanceMetricsMiddleware);

// Security headers — relax CSP for Monaco Editor (loaded from CDN) and Perspective
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "blob:"],
      workerSrc: ["'self'", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'self'", "blob:"],
      frameSrc: ["'self'", "blob:"],
    },
  },
}));

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // e.g., curl
    if (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('CORS not allowed'), false);
  },
  credentials: true
}));

// JSON parsing
app.use(express.json({ limit: config.requestLimits.jsonBodyLimit }));

// Rate limiting:
// - auth routes: strict per-IP limits to protect login/reset endpoints
// - authenticated API: per-user limits (fallback IP) to avoid shared-NAT collisions
const authRateLimiter = rateLimit({
  windowMs: config.requestLimits.auth.windowMs,
  max: config.requestLimits.auth.maxPerIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip}`,
});

const apiRateLimiter = rateLimit({
  windowMs: config.requestLimits.api.windowMs,
  max: config.requestLimits.api.maxPerKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: (req) => (req.headers.accept || '').includes('text/event-stream'),
});

app.use('/api/v1/auth/login', authRateLimiter);
app.use('/api/v1/auth/register', authRateLimiter);
app.use('/api/v1/auth/reset-password', authRateLimiter);
app.use('/api/v1/auth/reset-password/confirm', authRateLimiter);
app.use('/api/v1/', apiRateLimiter);

// Mount API routes
app.use('/api', api);

// Serve built frontend (from frontend/dist) when available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(DIST));
// SPA fallback — any non-API/non-WS route serves index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/dap' || req.path === '/chat') return next();
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) next(); // dist not built — fall through to 404
  });
});

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

let server = null;

async function bootstrap() {
  await initUserStore();

  if (userStoreNeedsSql()) {
    // Verify SQL connectivity for modes that still depend on SQL-backed users.
    await getPool().query('SELECT 1');
  }

  server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port} env=${config.env}`);
    startBackupScheduler();
  });

  // Attach DAP WebSocket proxy for debugger
  attachDapProxy(server);

  // Attach Chat WebSocket server
  attachChatWs(server);
}

bootstrap().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  stopBackupScheduler();
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(async () => {
    try {
      if (userStoreNeedsSql()) {
        await getPool().end();
      }
    } finally {
      process.exit(0);
    }
  });
}
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
