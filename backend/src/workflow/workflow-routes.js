/**
 * workflow-routes.js — SSE + REST endpoints for workflow execution monitoring.
 *
 * Mounted at /api/v1/labs/:labId/results/:resultId/workflow
 *
 * Endpoints:
 *   GET  /events    — SSE stream of workflow step events
 *   GET  /state     — current workflow run state (snapshot)
 */

import { Router } from 'express';
import { getWorkflowRun } from './workflow-runner.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/v1/labs/:labId/results/:resultId/workflow/events
 *
 * Server-Sent Events stream for real-time workflow progress.
 * Events:
 *   event: state          — full state snapshot (emitted after every change)
 *   event: workflow-start  — { steps, totalSteps }
 *   event: step-start      — { index, name, startedAt }
 *   event: step-complete   — { index, name, durationMs, exitCode }
 *   event: step-failed     — { index, name, durationMs, exitCode, error }
 *   event: debug-waiting   — { index, name, port, status }
 *   event: debug-attached  — { index, name, status }
 *   event: debug-stopped   — { index, name, status }
 *   event: workflow-complete — { totalDurationMs }
 *   event: workflow-failed  — { failedStep, error, totalDurationMs }
 *   event: workflow-aborted — {}
 */
router.get('/events', (req, res) => {
  const { labId, resultId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const run = getWorkflowRun(labId, resultId);

  if (!run) {
    // No active run — send an empty state and close
    res.write(`event: state\ndata: ${JSON.stringify({ status: 'idle', steps: [] })}\n\n`);
    res.end();
    return;
  }

  // Send current state immediately
  res.write(`event: state\ndata: ${JSON.stringify(run.getState())}\n\n`);

  // Event handlers
  const events = [
    'workflow-start', 'step-start', 'step-complete', 'step-failed',
    'debug-waiting', 'debug-attached', 'debug-stopped',
    'workflow-complete', 'workflow-failed', 'workflow-aborted', 'state',
  ];

  const handlers = {};

  for (const eventName of events) {
    handlers[eventName] = (data) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* connection closed */ }
    };
    run.on(eventName, handlers[eventName]);
  }

  // Send keepalive every 15s to prevent timeout
  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`);
    } catch { /* ignore */ }
  }, 15000);

  // Cleanup when client disconnects
  req.on('close', () => {
    clearInterval(keepalive);
    for (const eventName of events) {
      run.off(eventName, handlers[eventName]);
    }
  });
});

/**
 * GET /api/v1/labs/:labId/results/:resultId/workflow/state
 *
 * Returns the current workflow run state (or idle if no active run).
 */
router.get('/state', (req, res) => {
  const { labId, resultId } = req.params;
  const run = getWorkflowRun(labId, resultId);

  if (!run) {
    return res.json({ status: 'idle', steps: [] });
  }

  res.json(run.getState());
});

export default router;
