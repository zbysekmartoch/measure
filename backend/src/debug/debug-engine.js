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
  // Force-kill any leftover session before starting a new one
  if (debugState.status !== 'idle' && debugState.status !== 'ended') {
    console.log(`[debug-engine] Cleaning up previous session (status=${debugState.status})`);
    endDebugSession();
    // Give process a moment to die
    await new Promise(r => setTimeout(r, 300));
    resetState();
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

  // python -Xfrozen_modules=off -m debugpy --log-to-stderr --listen 127.0.0.1:<port> --wait-for-client <script> [args...]
  // --log-to-stderr makes debugpy print lifecycle messages to stderr, including
  // "Adapter is accepting incoming client connections on 127.0.0.1:<port>"
  // which we watch for to know when DAP is truly ready.
  const spawnArgs = [
    '-Xfrozen_modules=off',
    '-m', 'debugpy',
    '--log-to-stderr',
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
      PYDEVD_DISABLE_FILE_VALIDATION: '1',
    },
  });

  debugState.process = child;
  debugState.pid = child.pid;
  // Don't set waiting_for_client yet — wait until debugpy is actually ready
  emitStatus();

  child.stdout.on('data', async (data) => {
    const text = data.toString();
    debugState.stdout += text;
    debugState.events.emit('stdout', text);
    if (opts.logFile) {
      try { await fs.appendFile(opts.logFile, text); } catch { /* ignore */ }
    }
  });

  // stderr handler needs special treatment — debugpy's own log messages
  // (from --log-to-stderr) go here mixed with script errors.
  // We filter debugpy log lines (start with letter + "+" like "I+00000.123:")
  // and only forward non-debugpy lines to the error file.
  child.stderr.on('data', async (data) => {
    const text = data.toString();
    debugState.stderr += text;
    debugState.events.emit('stderr', text);

    // Filter: only write non-debugpy lines to error log
    if (opts.errorFile) {
      const lines = text.split('\n');
      const nonDebugpy = lines.filter(l => !isDebugpyLogLine(l)).join('\n');
      if (nonDebugpy.trim()) {
        try { await fs.appendFile(opts.errorFile, nonDebugpy); } catch { /* ignore */ }
      }
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

  // Wait for debugpy's "Adapter is accepting incoming client connections" message.
  // We MUST NOT make any TCP connection to the port — debugpy treats the first
  // connection as the DAP client. Only the real DAP proxy should connect.
  await waitForDebugpyReady(child, port, 15000);
  debugState.status = 'waiting_for_client';
  emitStatus();
  console.log(`[debug-engine] debugpy ready on 127.0.0.1:${port}, waiting for DAP client`);

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
 * Check if a stderr line is a debugpy internal log message.
 * debugpy --log-to-stderr lines look like:
 *   "I+00000.123: ..."  or  "D+00000.123: ..."  or  "W+00000.123: ..."
 * or continuation lines indented with spaces.
 */
function isDebugpyLogLine(line) {
  return /^[A-Z]\+\d+\.\d+:/.test(line) || /^\s{2,}/.test(line);
}

/**
 * Wait for debugpy to be ready by watching its stderr output for the
 * "Adapter is accepting incoming client connections" message.
 *
 * This is the ONLY reliable way to know debugpy's DAP server is ready
 * without consuming its one-shot client slot via a TCP connection.
 *
 * Requires --log-to-stderr in the debugpy spawn args.
 *
 * @param {import('child_process').ChildProcess} child
 * @param {number} port
 * @param {number} timeoutMs
 */
function waitForDebugpyReady(child, port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderrAccum = '';

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.stderr.off('data', onData);
        console.error(`[debug-engine] Timeout waiting for debugpy ready (accumulated stderr: ${stderrAccum.length} chars)`);
        // Don't reject — resolve anyway, the DAP client will report the real error
        resolve();
      }
    }, timeoutMs);

    function onData(data) {
      if (resolved) return;
      const text = data.toString();
      stderrAccum += text;

      // Look for the magic line from debugpy's adapter
      if (stderrAccum.includes('Adapter is accepting incoming client connections')) {
        resolved = true;
        clearTimeout(timer);
        child.stderr.off('data', onData);
        console.log(`[debug-engine] Detected debugpy ready message`);
        resolve();
      }
    }

    child.stderr.on('data', onData);

    child.once('exit', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        child.stderr.off('data', onData);
        reject(new Error('debugpy process exited before becoming ready'));
      }
    });
  });
}
