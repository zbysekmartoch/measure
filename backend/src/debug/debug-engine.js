/**
 * debug-engine.js — Backend debug session manager.
 *
 * Responsibilities:
 *   1. Spawn Python scripts via debugpy (--listen --wait-for-client)
 *   2. Track active debug session state (port, pid, script, cwd)
 *   3. Provide getFreePort() utility
 *   4. Expose lifecycle: startDebugSession / endDebugSession / getStatus
 *
 * The engine is language-agnostic in its interface; the Python/debugpy
 * specifics are encapsulated in the spawn logic. Adding Node.js debug
 * later means adding a second launcher.
 */

import net from 'net';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { EventEmitter } from 'events';

// ── Global singleton state ─────────────────────────────────────────────────
const debugState = {
  /** @type {'idle'|'starting'|'waiting_for_client'|'running'|'stopped'|'ended'} */
  status: 'idle',
  port: null,
  scriptPath: null,
  scriptAbsolutePath: null,
  cwd: null,
  pid: null,
  labId: null,
  resultId: null,
  /** @type {import('child_process').ChildProcess|null} */
  process: null,
  /** Emitter for session lifecycle events */
  events: new EventEmitter(),
  /** Accumulated stdout */
  stdout: '',
  /** Accumulated stderr */
  stderr: '',
  /** Step index inside the workflow (0-based) */
  stepIndex: null,
  stepName: null,
};

/**
 * Get an available TCP port by binding to port 0.
 * @returns {Promise<number>}
 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Current debug session status (safe to serialize as JSON).
 */
export function getDebugStatus() {
  return {
    active: debugState.status !== 'idle' && debugState.status !== 'ended',
    status: debugState.status,
    port: debugState.port,
    scriptPath: debugState.scriptPath,
    scriptAbsolutePath: debugState.scriptAbsolutePath,
    cwd: debugState.cwd,
    pid: debugState.pid,
    labId: debugState.labId,
    resultId: debugState.resultId,
    stepIndex: debugState.stepIndex,
    stepName: debugState.stepName,
  };
}

/**
 * Readonly access to the event emitter.
 * Events:
 *   'status'  — { ...getDebugStatus() }
 *   'stdout'  — string chunk
 *   'stderr'  — string chunk
 *   'exit'    — { code, signal }
 */
export function getDebugEvents() {
  return debugState.events;
}

/**
 * Reset state to idle.
 */
export function resetState() {
  debugState.status = 'idle';
  debugState.port = null;
  debugState.scriptPath = null;
  debugState.scriptAbsolutePath = null;
  debugState.cwd = null;
  debugState.pid = null;
  debugState.labId = null;
  debugState.resultId = null;
  debugState.process = null;
  debugState.stdout = '';
  debugState.stderr = '';
  debugState.stepIndex = null;
  debugState.stepName = null;
}

function emitStatus() {
  debugState.events.emit('status', getDebugStatus());
}

/**
 * Start a debug session for a Python script.
 *
 * @param {object} opts
 * @param {string} opts.scriptAbsolutePath — absolute path to the .py file
 * @param {string} opts.scriptPath         — relative display path
 * @param {string} opts.cwd                — working directory for the script
 * @param {string} opts.pythonCommand      — python executable (default: "python")
 * @param {string[]} opts.args             — extra args after the script path
 * @param {string} opts.labId
 * @param {string} opts.resultId
 * @param {number} [opts.stepIndex]
 * @param {string} [opts.stepName]
 * @param {string} opts.logFile            — path to stdout log
 * @param {string} opts.errorFile          — path to stderr log
 * @returns {Promise<{ port: number, pid: number }>}
 */
export async function startDebugSession(opts) {
  if (debugState.status !== 'idle' && debugState.status !== 'ended') {
    throw new Error(`Debug session already active (status=${debugState.status})`);
  }

  const port = await getFreePort();

  debugState.status = 'starting';
  debugState.port = port;
  debugState.scriptPath = opts.scriptPath;
  debugState.scriptAbsolutePath = opts.scriptAbsolutePath;
  debugState.cwd = opts.cwd;
  debugState.labId = opts.labId;
  debugState.resultId = opts.resultId;
  debugState.stepIndex = opts.stepIndex ?? null;
  debugState.stepName = opts.stepName ?? null;
  debugState.stdout = '';
  debugState.stderr = '';
  emitStatus();

  const pythonCmd = opts.pythonCommand || 'python';

  // python -m debugpy --listen 127.0.0.1:<port> --wait-for-client <script> [args...]
  const spawnArgs = [
    '-m', 'debugpy',
    '--listen', `127.0.0.1:${port}`,
    '--wait-for-client',
    opts.scriptAbsolutePath,
    ...(opts.args || []),
  ];

  console.log(`[debug-engine] Spawning: ${pythonCmd} ${spawnArgs.join(' ')}`);
  console.log(`[debug-engine] CWD: ${opts.cwd}, DAP port: ${port}`);

  const child = spawn(pythonCmd, spawnArgs, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      WORK_DIR: opts.cwd,
    },
  });

  debugState.process = child;
  debugState.pid = child.pid;
  debugState.status = 'waiting_for_client';
  emitStatus();

  child.stdout.on('data', async (data) => {
    const text = data.toString();
    debugState.stdout += text;
    debugState.events.emit('stdout', text);
    if (opts.logFile) {
      try { await fs.appendFile(opts.logFile, text); } catch { /* ignore */ }
    }
  });

  child.stderr.on('data', async (data) => {
    const text = data.toString();
    debugState.stderr += text;
    debugState.events.emit('stderr', text);
    // debugpy prints its own messages to stderr — also route to error log
    if (opts.errorFile) {
      try { await fs.appendFile(opts.errorFile, text); } catch { /* ignore */ }
    }
  });

  child.on('error', (err) => {
    console.error('[debug-engine] Process error:', err.message);
    debugState.status = 'ended';
    emitStatus();
    debugState.events.emit('exit', { code: null, signal: null, error: err.message });
  });

  child.on('close', (code, signal) => {
    console.log(`[debug-engine] Process exited code=${code} signal=${signal}`);
    debugState.status = 'ended';
    emitStatus();
    debugState.events.emit('exit', { code, signal });
  });

  // Wait a short time for debugpy to bind the port
  await waitForPort(port, 10000);
  console.log(`[debug-engine] debugpy listening on 127.0.0.1:${port}`);

  return { port, pid: child.pid };
}

/**
 * End the active debug session (kill the process).
 */
export function endDebugSession() {
  if (debugState.process) {
    try { debugState.process.kill('SIGTERM'); } catch { /* ignore */ }
  }
  debugState.status = 'ended';
  emitStatus();
}

/**
 * Wait until a TCP port accepts connections.
 * @param {number} port
 * @param {number} timeoutMs
 */
function waitForPort(port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      if (Date.now() > deadline) return reject(new Error(`Timeout waiting for port ${port}`));
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        setTimeout(attempt, 100);
      });
    }
    attempt();
  });
}
