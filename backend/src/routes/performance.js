import { Router } from 'express';
import {
  getPerformanceSnapshot,
  getRecentRequests,
  markAuthenticatedUser,
  markPerformanceStreamConnected,
  markPerformanceStreamDisconnected,
} from '../utils/performance-metrics.js';
import { getChatConnectedUsersCount } from '../chat/chat-ws.js';

const router = Router();
const STREAM_INTERVAL_MS = 2000;

function writeStatsEvent(res) {
  const snapshot = getPerformanceSnapshot({
    chatUsers: getChatConnectedUsersCount(),
  });
  res.write(`event: stats\n`);
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
}

router.get('/stats', (req, res) => {
  const snapshot = getPerformanceSnapshot({
    chatUsers: getChatConnectedUsersCount(),
  });
  res.json(snapshot);
});

router.get('/requests', (req, res) => {
  const limit = Number(req.query?.limit || 150);
  const details = getRecentRequests({ limit });
  res.json(details);
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  markPerformanceStreamConnected();
  markAuthenticatedUser(req.userId);

  writeStatsEvent(res);

  const timer = setInterval(() => {
    // Keep user presence fresh while monitoring is ON.
    markAuthenticatedUser(req.userId);
    writeStatsEvent(res);
  }, STREAM_INTERVAL_MS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(timer);
    markPerformanceStreamDisconnected();
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

export default router;