import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import api from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { getPool } from './db.js';

const app = express();

// Logging
app.use(pinoHttp());

// Security headers
app.use(helmet());

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
app.use(express.json({ limit: '1mb' }));

// Rate limiting (basic, adjust as needed)
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300 }));

// Mount API routes
app.use('/api', api);

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

// Start
const server = app.listen(config.port, async () => {
  // Verify DB connection on startup
  await getPool().query('SELECT 1');
  console.log(`API listening on http://localhost:${config.port} env=${config.env}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  server.close(async () => {
    try {
      await getPool().end();
    } finally {
      process.exit(0);
    }
  });
}
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
