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
import path from 'path';
import { fileURLToPath } from 'url';
import { getWorkflowRun, readPersistedState } from './workflow-runner.js';

const router = Router({ mergeParams: true });
const LABS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../labs');

/** State of a run that is no longer in memory: the snapshot persisted in the result dir. */
function persistedState(labId, resultId) {
  if (!/^[\w.-]+$/.test(String(labId)) || !/^[\w.-]+$/.test(String(resultId))) return null;
  return readPersistedState(path.join(LABS_ROOT, String(labId), 'results', String(resultId)));
}

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
router.get('/events', async (req, res) => {
  const { labId, resultId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // The workflow run may still be registering (race between SSE connect and
  // the HTTP POST that starts the workflow). Wait briefly if no run yet.
  let run = getWorkflowRun(labId, resultId);
  if (!run) {
    for (let i = 0; i < 20 && !run; i++) {
      await new Promise(r => setTimeout(r, 250));
      run = getWorkflowRun(labId, resultId);
    }
  }

  if (!run) {
    // Still no run in memory — send the persisted final state (or idle) and close
    const saved = persistedState(labId, resultId);
    res.write(`event: state\ndata: ${JSON.stringify(saved || { status: 'idle', steps: [] })}\n\n`);
    res.end();
    return;
  }

  // Event handlers
  const events = [
    'workflow-start', 'step-start', 'step-complete', 'step-failed',
    'step-waiting', 'step-progress',
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
  }

  const attach = (r) => {
    for (const eventName of events) r.on(eventName, handlers[eventName]);
    res.write(`event: state\ndata: ${JSON.stringify(r.getState())}\n\n`);
  };
  const detach = (r) => {
    for (const eventName of events) r.off(eventName, handlers[eventName]);
  };

  attach(run);

  // A rerun of the same result creates a NEW WorkflowRun object under the same key while
  // the finished one may still be in memory (kept for late clients). Clients that connected
  // before the rerun started must follow the key, not the object — otherwise they would keep
  // showing the old run forever.
  const follow = setInterval(() => {
    const current = getWorkflowRun(labId, resultId);
    if (current && current !== run) {
      detach(run);
      run = current;
      attach(run);
    }
  }, 1000);

  // Send keepalive every 15s to prevent timeout
  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`);
    } catch { /* ignore */ }
  }, 15000);

  // Cleanup when client disconnects
  req.on('close', () => {
    clearInterval(keepalive);
    clearInterval(follow);
    detach(run);
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
    return res.json(persistedState(labId, resultId) || { status: 'idle', steps: [] });
  }

  res.json(run.getState());
});

export default router;
