/**
 * debug-routes.js — REST + SSE endpoints for the debug subsystem.
 *
 * Mounted at /api/v1/debug
 *
 * Endpoints:
 *   GET  /status            — current debug session status
 *   GET  /events            — SSE stream of debug lifecycle events
 *   POST /stop              — kill the active debug session
 */

import { Router } from 'express';
import { getDebugStatus, getDebugEvents, endDebugSession } from './debug-engine.js';

const router = Router();

/**
 * GET /api/v1/debug/status
 * Returns the current debug session info.
 */
router.get('/status', (req, res) => {
  const status = getDebugStatus();
  // Return relative /dap path — the frontend will resolve it against current origin.
  // This works both in dev (Vite proxy) and production.
  status.wsUrl = status.active ? '/dap' : null;
  res.json(status);
});

/**
 * GET /api/v1/debug/events
 * Server-Sent Events stream. Emits:
 *   event: status     — JSON payload with full debug status
 *   event: stdout     — text chunk
 *   event: stderr     — text chunk
 *   event: exit       — { code, signal }
 */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Send current status immediately
  const status = getDebugStatus();
  res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);

  const events = getDebugEvents();

  const onStatus = (s) => res.write(`event: status\ndata: ${JSON.stringify(s)}\n\n`);
  const onStdout = (text) => res.write(`event: stdout\ndata: ${JSON.stringify(text)}\n\n`);
  const onStderr = (text) => res.write(`event: stderr\ndata: ${JSON.stringify(text)}\n\n`);
  const onExit   = (info) => res.write(`event: exit\ndata: ${JSON.stringify(info)}\n\n`);

  events.on('status', onStatus);
  events.on('stdout', onStdout);
  events.on('stderr', onStderr);
  events.on('exit',   onExit);

  req.on('close', () => {
    events.off('status', onStatus);
    events.off('stdout', onStdout);
    events.off('stderr', onStderr);
    events.off('exit',   onExit);
  });
});

/**
 * POST /api/v1/debug/stop
 * Kill the active debug session.
 */
router.post('/stop', (req, res) => {
  endDebugSession();
  res.json({ ok: true });
});

export default router;
