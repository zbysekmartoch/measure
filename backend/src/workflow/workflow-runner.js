/**
 * workflow-runner.js — Workflow execution engine with real-time event streaming.
 *
 * Manages sequential execution of workflow scripts with:
 *   - Per-step timing and status tracking
 *   - Real-time events for frontend progress display (via SSE)
 *   - Debug mode integration with debugpy (--wait-for-client)
 *   - Stop-on-failure control
 *
 * Each workflow run is tracked as a WorkflowRun instance keyed by "labId:resultId".
 * The frontend subscribes to events via the SSE endpoint in workflow-routes.js.
 *
 * Events emitted by WorkflowRun:
 *   'workflow-start'    — { steps: string[], totalSteps: number }
 *   'step-start'        — { index, name, startedAt }
 *   'step-complete'     — { index, name, durationMs, exitCode }
 *   'step-failed'       — { index, name, durationMs, exitCode, error }
 *   'step-waiting'      — { index, name, reason, availableMb, requiredMb, waitedMs }
 *   'step-progress'     — { index, name, rssMb, peakRssMb }
 *   'debug-waiting'     — { index, name, port, status: 'waiting_for_client' }
 *   'debug-attached'    — { index, name, status: 'running' }
 *   'debug-stopped'     — { index, name, status: 'stopped' }
 *   'workflow-complete'  — { totalDurationMs }
 *   'workflow-failed'    — { failedStep, error, totalDurationMs }
 *   'workflow-aborted'   — {}
 *   'state'             — full state snapshot (sent after every change)
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import {
  startDebugSession,
  getDebugEvents,
  getDebugStatus,
  endDebugSession,
} from '../debug/debug-engine.js';
import { closeAllDapConnections } from '../debug/dap-proxy.js';
import {
  readMemInfo,
  getResourceLimits,
  detectCgroupRunner,
  wrapWithMemoryLimit,
  ProcessMemoryWatchdog,
  describeProcessExit,
  fmtMb,
} from '../utils/system-resources.js';

export const STATE_FILE_NAME = '_workflow_state.json';

// ── Active workflow runs: Map<"labId:resultId", WorkflowRun> ────────────────

const activeRuns = new Map();

/**
 * Get an active workflow run by labId and resultId.
 * @param {string} labId
 * @param {string} resultId
 * @returns {WorkflowRun|null}
 */
export function getWorkflowRun(labId, resultId) {
  return activeRuns.get(`${labId}:${resultId}`) || null;
}

/**
 * Get all active workflow runs.
 * @returns {Map<string, WorkflowRun>}
 */
export function getActiveRuns() {
  return activeRuns;
}

// ── Step status enum ────────────────────────────────────────────────────────

export const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WAITING: 'waiting', // waiting for free system memory before start
  DEBUG_WAITING: 'debug-waiting',
  DEBUG_STOPPED: 'debug-stopped',
};

// ── WorkflowRun class ──────────────────────────────────────────────────────

export class WorkflowRun extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.labId
   * @param {string} opts.resultId
   * @param {string[]} opts.steps — script paths (relative to scriptsRoot)
   * @param {string} opts.resultDir — absolute path to result directory
   * @param {string} opts.scriptsRoot — absolute path to lab scripts directory
  * @param {string} opts.workflowRoot — relative directory of the .workflow file within scripts (metadata only)
  * @param {string} opts.runtimeEnvPath — absolute path to runtime env JSON passed to scripts
   * @param {string} opts.pythonCmd — python executable
   * @param {boolean} opts.debugVisible — whether debug mode is active
   * @param {Set<string>} opts.debugScripts — scripts that should be debugged
   * @param {boolean} opts.stopOnFailure — stop execution on first failure
   * @param {object} opts.resolvedPaths — map of step names with <ALIAS> to pre-resolved absolute paths
   * @param {string} opts.logFile — path to output.log
   * @param {string} opts.errorFile — path to output.err
   * @param {string} opts.debugLogFile — path to debuger.log
   * @param {object} opts.progressBase — base progress.json content
   */
  constructor(opts) {
    super();
    this.setMaxListeners(50); // Allow many SSE clients

    this.labId = opts.labId;
    this.resultId = opts.resultId;
    this.steps = opts.steps;
    this.commentedSteps = opts.commentedSteps || []; // scripts starting with # (skipped)
    this.resultDir = opts.resultDir;
    this.scriptsRoot = opts.scriptsRoot;
    this.workflowRoot = opts.workflowRoot || '';
    this.runtimeEnvPath = opts.runtimeEnvPath || '';
    this.pythonCmd = opts.pythonCmd;
    this.debugVisible = opts.debugVisible;
    this.debugScripts = opts.debugScripts || new Set();
    this.stopOnFailure = opts.stopOnFailure !== false; // default: true
    this.resolvedPaths = opts.resolvedPaths || {}; // <ALIAS>/path → absolute path
    this.logFile = opts.logFile;
    this.errorFile = opts.errorFile;
    this.debugLogFile = opts.debugLogFile;
    this.progressBase = opts.progressBase || {};

    // Path to shared lib scripts (labs/lib/scripts) — available as PYTHONPATH
    this.libScriptsPath = path.resolve(opts.scriptsRoot, '../../lib/scripts');

    this.key = `${opts.labId}:${opts.resultId}`;
    // Full state snapshot persisted here on every change so SSE clients that reconnect
    // late (or after a backend restart) still get the final state instead of 'idle'.
    this.stateFile = path.join(this.resultDir, STATE_FILE_NAME);
    this._lastPersistAt = 0;
    this.status = 'idle'; // idle | running | completed | failed | aborted
    this.currentStepIndex = -1;
    this.stepStatuses = opts.steps.map((name) => ({
      name,
      status: StepStatus.PENDING,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      error: null,
      rssMb: null,      // current RSS of the step's process tree (MB)
      peakRssMb: null,  // peak RSS observed during the step (MB)
      waiting: null,    // { reason, availableMb, requiredMb, waitedMs } while status === 'waiting'
    }));
    this.limits = getResourceLimits();
    this.cgroup = { available: false, reason: 'not probed' };
    this.startedAt = null;
    this.completedAt = null;
    this.aborted = false;
    this._currentProcess = null; // currently running child process
  }

  /**
   * Get full state snapshot (safe to serialize to JSON).
   */
  getState() {
    return {
      labId: this.labId,
      resultId: this.resultId,
      status: this.status,
      steps: this.stepStatuses.map((s) => ({ ...s })),
      commentedSteps: this.commentedSteps,
      currentStepIndex: this.currentStepIndex,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      debugVisible: this.debugVisible,
      stopOnFailure: this.stopOnFailure,
      pid: this._currentProcess?.pid ?? null,
      updatedAt: new Date().toISOString(),
      system: (() => {
        const m = readMemInfo();
        return { totalMb: m.totalMb, availableMb: m.availableMb, usedPercent: m.usedPercent, swapUsedMb: m.swapUsedMb };
      })(),
      limits: {
        maxMemoryMb: this.limits.maxMemoryMb,
        minAvailableMb: this.limits.minAvailableMb,
        cgroup: this.cgroup.available,
      },
    };
  }

  /**
   * Block until the system has at least `minAvailableMb` of available memory,
   * so a step does not start while another heavy process is still running.
   * Emits 'step-waiting' while blocked. Resolves true when it is OK to start,
   * false on abort or when maxWaitMs elapsed.
   */
  async _waitForMemory(i, stepName) {
    const { minAvailableMb, waitPollMs, maxWaitMs } = this.limits;
    if (!(minAvailableMb > 0)) return true;
    const startedWaiting = Date.now();
    let announced = false;
    for (;;) {
      if (this.aborted) return false;
      const mem = readMemInfo();
      if (mem.availableMb >= minAvailableMb) {
        if (announced) {
          const waitedMs = Date.now() - startedWaiting;
          this.stepStatuses[i].waiting = null;
          if (this.logFile) await fs.appendFile(this.logFile, `[measure] memory OK after ${Math.round(waitedMs / 1000)} s (available ${fmtMb(mem.availableMb)}), starting step\n`).catch(() => {});
        }
        return true;
      }
      const waitedMs = Date.now() - startedWaiting;
      if (maxWaitMs > 0 && waitedMs > maxWaitMs) {
        this.stepStatuses[i].waiting = null;
        this.stepStatuses[i].error = `waited ${Math.round(waitedMs / 1000)} s for free memory (available ${fmtMb(mem.availableMb)} < required ${fmtMb(minAvailableMb)}), giving up`;
        return false;
      }
      const waiting = { reason: 'memory', availableMb: mem.availableMb, requiredMb: minAvailableMb, waitedMs };
      this.stepStatuses[i].status = StepStatus.WAITING;
      this.stepStatuses[i].waiting = waiting;
      if (!announced) {
        announced = true;
        if (this.logFile) await fs.appendFile(this.logFile, `[measure] waiting for free memory: available ${fmtMb(mem.availableMb)} < required ${fmtMb(minAvailableMb)}\n`).catch(() => {});
      }
      this._emit('step-waiting', { index: i, name: stepName, ...waiting });
      await new Promise((r) => setTimeout(r, waitPollMs));
    }
  }

  /**
   * Steps whose script name contains '!' run without the hard memory cap
   * (no cgroup MemoryMax, no watchdog kill). RSS is still sampled for display.
   */
  _isUncapped(stepName) {
    return typeof stepName === 'string' && stepName.includes('!');
  }

  /**
   * Record a memory sample for a running step and notify SSE clients.
   */
  _onMemorySample(i, stepName, { rssMb, peakMb }) {
    const st = this.stepStatuses[i];
    if (!st) return;
    st.rssMb = rssMb;
    st.peakRssMb = peakMb;
    this._emit('step-progress', { index: i, name: stepName, rssMb, peakRssMb: peakMb });
  }

  /**
   * Emit a named event and also always emit a 'state' event with full snapshot.
   */
  _emit(eventName, data) {
    this.emit(eventName, data);
    const state = this.getState();
    this.emit('state', state);
    // Persist: every real transition immediately, RSS samples at most every 5 s
    const now = Date.now();
    if (eventName !== 'step-progress' || now - this._lastPersistAt > 5000) {
      this._lastPersistAt = now;
      fs.writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf-8').catch(() => {});
    }
  }

  /**
   * Write progress.json to the result directory.
   */
  async _writeProgress(step, stepName, status) {
    const p = {
      ...this.progressBase,
      status,
      totalSteps: this.steps.length,
      currentStep: step,
      currentStepName: stepName,
      analysisStartedAt: this.progressBase.analysisStartedAt || this.startedAt,
      updatedAt: new Date().toISOString(),
    };
    if (status === 'completed' || status === 'failed' || status === 'aborted') {
      p.completedAt = new Date().toISOString();
    }
    await fs.writeFile(
      path.join(this.resultDir, '_progress.json'),
      JSON.stringify(p, null, 2),
      'utf-8',
    );
  }

  /**
   * Append a debug log message.
   */
  async _debugLog(msg) {
    if (!this.debugLogFile) return;
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    await fs.appendFile(this.debugLogFile, line).catch(() => {});
  }

  /**
   * Start the workflow execution (runs in background, returns immediately).
   */
  async run() {
    activeRuns.set(this.key, this);

    this.status = 'running';
    this.startedAt = new Date().toISOString();
    const now = this.startedAt;
    const separator = '='.repeat(80);

    // Initialize log files (skip if null — e.g. output-mode runs from Scripts tab)
    if (this.logFile) await fs.writeFile(this.logFile, `Workflow execution started at ${now}\n${separator}\n`, 'utf-8');
    if (this.errorFile) await fs.writeFile(this.errorFile, '', 'utf-8');
    if (this.debugLogFile) await fs.writeFile(this.debugLogFile, `[debuger] Session started at ${now}\n${separator}\n`, 'utf-8');

    this._emit('workflow-start', {
      steps: [...this.steps],
      totalSteps: this.steps.length,
    });

    const workflowStartTime = Date.now();

    try {
      if (this.limits.useCgroup) {
        this.cgroup = await detectCgroupRunner();
      } else {
        this.cgroup = { available: false, reason: 'disabled in config' };
      }
      const mem0 = readMemInfo();
      if (this.logFile) {
        await fs.appendFile(this.logFile,
          `[measure] memory guard: limit per script ${fmtMb(this.limits.maxMemoryMb)} `
          + `(${this.cgroup.available ? 'hard cgroup limit' : 'soft watchdog limit — ' + this.cgroup.reason}), `
          + `start requires ${fmtMb(this.limits.minAvailableMb)} available, `
          + `system ${fmtMb(mem0.availableMb)} available of ${fmtMb(mem0.totalMb)}\n`);
      }

      for (let i = 0; i < this.steps.length; i++) {
        if (this.aborted) {
          // Mark remaining steps as skipped
          for (let j = i; j < this.steps.length; j++) {
            this.stepStatuses[j].status = StepStatus.SKIPPED;
          }
          break;
        }

        const stepName = this.steps[i];
        const ext = path.extname(stepName).toLowerCase();
        const isPython = ext === '.py';
        // Use pre-resolved absolute path for cross-lab (<ALIAS>) steps, otherwise resolve locally
        const scriptAbsPath = this.resolvedPaths[stepName] || path.join(this.scriptsRoot, stepName);
        const shouldDebug = isPython && this.debugVisible;

        this.currentStepIndex = i;

        // Hold the step while the machine is short on memory
        const memoryOk = await this._waitForMemory(i, stepName);
        if (this.aborted) {
          for (let j = i; j < this.steps.length; j++) {
            if (this.stepStatuses[j].status === StepStatus.PENDING || this.stepStatuses[j].status === StepStatus.WAITING) {
              this.stepStatuses[j].status = StepStatus.SKIPPED;
            }
          }
          break;
        }

        const stepStartTime = Date.now();

        // Update step status
        this.stepStatuses[i].status = StepStatus.RUNNING;
        this.stepStatuses[i].startedAt = new Date().toISOString();

        await this._writeProgress(i + 1, stepName, 'running');
        if (this.logFile) await fs.appendFile(this.logFile, `\n[${new Date().toISOString()}] Step ${i + 1}/${this.steps.length}: ${stepName}\n`);

        this._emit('step-start', {
          index: i,
          name: stepName,
          startedAt: this.stepStatuses[i].startedAt,
        });

        if (this._isUncapped(stepName) && this.logFile) {
          await fs.appendFile(this.logFile, `[measure] script name contains '!' — running WITHOUT the memory cap (RSS is only monitored)\n`).catch(() => {});
        }

        let success = false;
        let failureMessage = null; // human-readable reason written to output.err

        if (!memoryOk) {
          failureMessage = this.stepStatuses[i].error;
        } else if (shouldDebug) {
          // ── Debug mode: spawn via debugpy ──
          await this._debugLog(`Starting debugpy for step ${stepName}`);

          // Close any stale DAP proxy WebSocket connections from previous steps
          closeAllDapConnections();

          try {
            const uncapped = this._isUncapped(stepName);
            const limited = wrapWithMemoryLimit(this.pythonCmd, [], {
              maxMemoryMb: uncapped ? 0 : this.limits.maxMemoryMb,
              cgroupAvailable: this.cgroup.available,
              unitName: `measure-debug-${this.labId}-${this.resultId}-${i}-${Date.now()}`,
            });
            const { port, pid } = await startDebugSession({
              scriptAbsolutePath: scriptAbsPath,
              scriptPath: stepName,
              cwd: this.resultDir,
              pythonCommand: this.pythonCmd,
              commandPrefix: limited.limited ? [limited.command, ...limited.args.slice(0, -1)] : null,
              args: [this.resultDir, this.runtimeEnvPath, this.scriptsRoot],
              labId: this.labId,
              resultId: this.resultId,
              stepIndex: i,
              stepName: stepName,
              extraEnv: {
                PYTHONPATH: this.libScriptsPath + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''),
                PYTHONUNBUFFERED: '1',
              },
              logFile: this.logFile,
              errorFile: this.errorFile,
            });

            await this._debugLog(`debugpy listening on port ${port}, PID ${pid}, waiting for client...`);
            if (this.logFile) await fs.appendFile(this.logFile, `[debugpy] listening on port ${port}, PID ${pid}\n`);

            // Emit debug-waiting event
            this.stepStatuses[i].status = StepStatus.DEBUG_WAITING;
            this._emit('debug-waiting', {
              index: i,
              name: stepName,
              port,
              status: 'waiting_for_client',
            });

            // Listen to debug events for status changes
            const debugEvents = getDebugEvents();
            let lastDebugStatus = null;

            const watchdog = new ProcessMemoryWatchdog(pid, {
              limitMb: this.limits.maxMemoryMb,
              enforce: !uncapped && !this.cgroup.available,
              intervalMs: this.limits.sampleIntervalMs,
              onSample: (sample) => this._onMemorySample(i, stepName, sample),
            });

            success = await new Promise((resolve) => {
              const onStatus = (s) => {
                if (s.status !== lastDebugStatus) {
                  this._debugLog(`[step ${i}] Debug status change: ${lastDebugStatus} → ${s.status}`).catch(() => {});
                  lastDebugStatus = s.status;
                  if (s.status === 'running' && this.stepStatuses[i].status === StepStatus.DEBUG_WAITING) {
                    this.stepStatuses[i].status = StepStatus.RUNNING;
                    this._emit('debug-attached', { index: i, name: stepName, status: 'running' });
                    this._debugLog(`[step ${i}] DAP client attached, script running`).catch(() => {});
                  } else if (s.status === 'stopped') {
                    this.stepStatuses[i].status = StepStatus.DEBUG_STOPPED;
                    this._emit('debug-stopped', { index: i, name: stepName, status: 'stopped' });
                    this._debugLog(`[step ${i}] Debugger stopped (breakpoint hit)`).catch(() => {});
                  } else if (s.status === 'waiting_for_client') {
                    this.stepStatuses[i].status = StepStatus.DEBUG_WAITING;
                    this._emit('debug-waiting', { index: i, name: stepName, port: s.port, status: 'waiting_for_client' });
                  }
                }
              };

              const onExit = (info) => {
                this._debugLog(`[step ${i}] Debug process exited: code=${info.code}, signal=${info.signal}`).catch(() => {});
                debugEvents.off('exit', onExit);
                debugEvents.off('status', onStatus);
                watchdog.stop();
                // Keep the historical semantics (a session ended by the user → code null → ok),
                // but treat SIGKILL (OOM) and watchdog kills as failures.
                const ok = info.code === 0 || (info.code === null && info.signal !== 'SIGKILL' && !watchdog.killed);
                if (!ok) {
                  failureMessage = describeProcessExit({
                    code: info.code,
                    signal: info.signal,
                    peakMb: watchdog.peakMb,
                    limitMb: this.limits.maxMemoryMb,
                    limited: limited.limited,
                    killedByWatchdog: watchdog.killed,
                    stderrBytes: 1, // debugpy always writes something to stderr
                    available: readMemInfo().availableMb,
                  });
                }
                resolve(ok);
              };

              debugEvents.on('exit', onExit);
              debugEvents.on('status', onStatus);

              // Check if already ended
              const st = getDebugStatus();
              if (!st.active) {
                this._debugLog(`[step ${i}] Debug session already ended before listeners were set`).catch(() => {});
                debugEvents.off('exit', onExit);
                debugEvents.off('status', onStatus);
                watchdog.stop();
                resolve(false);
              }
            });
            this.stepStatuses[i].peakRssMb = watchdog.peakMb;

            await this._debugLog(`Step ${stepName} debug process exited, success=${success}`);

          } catch (err) {
            await this._debugLog(`Failed to start debug session: ${err.message}`);
            if (this.errorFile) await fs.appendFile(this.errorFile, `[debugpy] Failed: ${err.message}\n`);
            success = false;
          }
        } else if (isPython) {
          // ── Python without debug ──
          ({ success, message: failureMessage } = await this._spawnScript(this.pythonCmd, scriptAbsPath, i, stepName));
        } else {
          // ── Non-Python scripts ──
          const cmdMap = { '.js': 'node', '.cjs': 'node', '.sh': 'bash', '.r': 'Rscript', '.R': 'Rscript' };
          const command = cmdMap[ext];
          if (!command) {
            if (this.errorFile) await fs.appendFile(this.errorFile, `Unsupported script type: ${ext}\n`);
            success = false;
          } else {
            ({ success, message: failureMessage } = await this._spawnScript(command, scriptAbsPath, i, stepName));
          }
        }

        // Update step status after completion
        const stepDuration = Date.now() - stepStartTime;
        this.stepStatuses[i].durationMs = stepDuration;
        this.stepStatuses[i].completedAt = new Date().toISOString();

        this.stepStatuses[i].rssMb = null;
        this.stepStatuses[i].waiting = null;
        const peakTxt = this.stepStatuses[i].peakRssMb > 0 ? `, peak RSS ${fmtMb(this.stepStatuses[i].peakRssMb)}` : '';

        if (success) {
          this.stepStatuses[i].status = StepStatus.COMPLETED;
          this.stepStatuses[i].exitCode = 0;
          if (this.logFile) await fs.appendFile(this.logFile, `[${new Date().toISOString()}] Step ${i + 1} finished in ${Math.round(stepDuration / 1000)} s${peakTxt}\n`).catch(() => {});
          this._emit('step-complete', {
            index: i,
            name: stepName,
            durationMs: stepDuration,
            exitCode: 0,
          });
        } else {
          this.stepStatuses[i].status = StepStatus.FAILED;
          this.stepStatuses[i].exitCode = 1;
          const reason = failureMessage || `Script ${stepName} failed`;
          this.stepStatuses[i].error = reason;
          if (this.errorFile) await fs.appendFile(this.errorFile, `[measure] Step ${i + 1} ${stepName} FAILED after ${Math.round(stepDuration / 1000)} s: ${reason}\n`).catch(() => {});
          if (this.logFile) await fs.appendFile(this.logFile, `[${new Date().toISOString()}] Step ${i + 1} FAILED: ${reason}\n`).catch(() => {});

          this._emit('step-failed', {
            index: i,
            name: stepName,
            durationMs: stepDuration,
            exitCode: 1,
            error: reason,
          });

          if (this.stopOnFailure) {
            // Mark remaining steps as skipped
            for (let j = i + 1; j < this.steps.length; j++) {
              this.stepStatuses[j].status = StepStatus.SKIPPED;
            }

            this.status = 'failed';
            this.completedAt = new Date().toISOString();
            const totalDuration = Date.now() - workflowStartTime;

            await this._writeProgress(i + 1, stepName, 'failed');
            if (this.errorFile) await fs.appendFile(this.errorFile, `Step ${stepName} failed\n`);

            this._emit('workflow-failed', {
              failedStep: i,
              error: `Script ${stepName} failed`,
              totalDurationMs: totalDuration,
            });

            this._cleanup();
            return;
          }
        }
      }

      // All steps processed
      if (this.aborted) {
        this.status = 'aborted';
        this.completedAt = new Date().toISOString();
        await this._writeProgress(this.currentStepIndex + 1, null, 'aborted');
        this._emit('workflow-aborted', {});
      } else {
        const hasFailures = this.stepStatuses.some((s) => s.status === StepStatus.FAILED);
        if (hasFailures) {
          this.status = 'failed';
          this.completedAt = new Date().toISOString();
          const totalDuration = Date.now() - workflowStartTime;
          const failedIdx = this.stepStatuses.findIndex((s) => s.status === StepStatus.FAILED);
          await this._writeProgress(this.steps.length, this.steps[this.steps.length - 1], 'failed');
          this._emit('workflow-failed', {
            failedStep: failedIdx,
            error: 'Workflow completed with failures',
            totalDurationMs: totalDuration,
          });
        } else {
          this.status = 'completed';
          this.completedAt = new Date().toISOString();
          const totalDuration = Date.now() - workflowStartTime;
          await this._writeProgress(this.steps.length, this.steps[this.steps.length - 1], 'completed');
          if (this.logFile) await fs.appendFile(this.logFile, `\n${separator}\n[${new Date().toISOString()}] WORKFLOW COMPLETED\n${separator}\n`);
          await this._debugLog('WORKFLOW COMPLETED');

          this._emit('workflow-complete', { totalDurationMs: totalDuration });
        }
      }
    } catch (err) {
      this.status = 'failed';
      this.completedAt = new Date().toISOString();
      const totalDuration = Date.now() - workflowStartTime;

      await this._writeProgress(0, null, 'failed');
      await fs.appendFile(this.errorFile, `SYSTEM ERROR: ${err.message}\n${err.stack}\n`);
      await this._debugLog(`SYSTEM ERROR: ${err.message}`);

      this._emit('workflow-failed', {
        failedStep: this.currentStepIndex,
        error: err.message,
        totalDurationMs: totalDuration,
      });
    }

    this._cleanup();
  }

  /**
   * Spawn a script and wait for it to exit.
   * The process runs inside a memory-limited cgroup when available; otherwise a
   * watchdog kills it when its RSS exceeds the configured limit.
   * @returns {Promise<{ success: boolean, message: string|null }>}
   */
  _spawnScript(command, scriptAbsPath, stepIndex, stepName) {
    return new Promise((resolve) => {
      const env = { ...process.env, WORK_DIR: this.resultDir };
      // Add shared lib scripts to PYTHONPATH so labs can import from labs/lib/scripts
      if (command === this.pythonCmd) {
        env.PYTHONPATH = this.libScriptsPath + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '');
        // Unbuffered stdout/stderr: otherwise print() output sits in Python's block
        // buffer and is lost entirely when the process is OOM-killed (SIGKILL).
        env.PYTHONUNBUFFERED = '1';
      }
      const scriptArgs = [scriptAbsPath, this.resultDir, this.runtimeEnvPath, this.scriptsRoot];
      const uncapped = this._isUncapped(stepName);
      const limited = wrapWithMemoryLimit(command, scriptArgs, {
        maxMemoryMb: uncapped ? 0 : this.limits.maxMemoryMb,
        cgroupAvailable: this.cgroup.available,
        unitName: `measure-run-${this.labId}-${this.resultId}-${stepIndex}-${Date.now()}`,
      });
      const child = spawn(limited.command, limited.args, {
        cwd: this.resultDir,
        env,
      });

      this._currentProcess = child;
      let stderrBytes = 0;

      const watchdog = new ProcessMemoryWatchdog(child.pid, {
        limitMb: this.limits.maxMemoryMb,
        enforce: !uncapped && !limited.limited,
        intervalMs: this.limits.sampleIntervalMs,
        onSample: (sample) => this._onMemorySample(stepIndex, stepName, sample),
      });

      child.stdout.on('data', (d) => {
        if (this.logFile) fs.appendFile(this.logFile, d.toString()).catch(() => {});
      });

      child.stderr.on('data', (d) => {
        stderrBytes += d.length;
        if (this.errorFile) fs.appendFile(this.errorFile, d.toString()).catch(() => {});
      });

      child.on('error', (err) => {
        watchdog.stop();
        this._currentProcess = null;
        resolve({ success: false, message: `failed to start process: ${err.message}` });
      });

      child.on('close', (code, signal) => {
        watchdog.stop();
        this._currentProcess = null;
        this.stepStatuses[stepIndex].peakRssMb = watchdog.peakMb;
        if (code === 0) {
          resolve({ success: true, message: null });
          return;
        }
        const message = describeProcessExit({
          code,
          signal,
          peakMb: watchdog.peakMb,
          limitMb: this.limits.maxMemoryMb,
          limited: limited.limited,
          killedByWatchdog: watchdog.killed,
          stderrBytes,
          available: readMemInfo().availableMb,
        });
        resolve({ success: false, message });
      });
    });
  }

  /**
   * Abort the workflow (called externally).
   */
  abort() {
    this.aborted = true;

    // Kill current process
    if (this._currentProcess) {
      try { this._currentProcess.kill('SIGTERM'); } catch { /* ignore */ }
    }

    // Kill debug session if active
    try {
      const debugStatus = getDebugStatus();
      if (debugStatus.active && String(debugStatus.resultId) === String(this.resultId)) {
        endDebugSession();
      }
    } catch { /* ignore */ }

    this.status = 'aborted';
    this.completedAt = new Date().toISOString();

    // Mark current step as failed, remaining as skipped
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.stepStatuses.length) {
      const current = this.stepStatuses[this.currentStepIndex];
      if (current.status === StepStatus.RUNNING || current.status === StepStatus.WAITING || current.status === StepStatus.DEBUG_WAITING || current.status === StepStatus.DEBUG_STOPPED) {
        current.status = StepStatus.FAILED;
        current.completedAt = new Date().toISOString();
        if (current.startedAt) {
          current.durationMs = Date.now() - new Date(current.startedAt).getTime();
        }
      }
    }
    for (let j = this.currentStepIndex + 1; j < this.stepStatuses.length; j++) {
      if (this.stepStatuses[j].status === StepStatus.PENDING) {
        this.stepStatuses[j].status = StepStatus.SKIPPED;
      }
    }

    this._emit('workflow-aborted', {});
    this._cleanup();
  }

  /**
   * Remove from active runs map after completion.
   */
  _cleanup() {
    // Keep the run in the map for a while so SSE clients that reconnect late still
    // get the final state from memory (the persisted state file covers the rest)
    const t = setTimeout(() => {
      activeRuns.delete(this.key);
    }, 10 * 60 * 1000);
    if (typeof t.unref === 'function') t.unref();
  }
}

// ── Factory function to create and start a workflow run ─────────────────────

/**
 * Create and start a new workflow run.
 *
 * @param {object} opts — same as WorkflowRun constructor opts
 * @returns {WorkflowRun}
 */
export function startWorkflowRun(opts) {
  // Abort any existing run for this lab:result
  const key = `${opts.labId}:${opts.resultId}`;
  const existing = activeRuns.get(key);
  if (existing && (existing.status === 'running' || existing.status === 'idle')) {
    existing.abort();
  }

  const run = new WorkflowRun(opts);
  // Start execution in background (don't await)
  run.run().catch((err) => {
    console.error(`[workflow-runner] Unhandled error in workflow ${key}:`, err);
  });

  return run;
}

/**
 * Abort a running workflow.
 *
 * @param {string} labId
 * @param {string} resultId
 * @returns {boolean} true if a run was found and aborted
 */
export function abortWorkflowRun(labId, resultId) {
  const run = getWorkflowRun(labId, resultId);
  if (run) {
    run.abort();
    return true;
  }
  return false;
}

/**
 * Read the persisted state snapshot of a run that is no longer in memory.
 * @returns {object|null}
 */
export function readPersistedState(resultDir) {
  try {
    const raw = readFileSync(path.join(resultDir, STATE_FILE_NAME), 'utf-8');
    const st = JSON.parse(raw);
    return st && typeof st === 'object' ? st : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readCmdline(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' '); } catch { return ''; }
}

/**
 * Called once at backend startup. Any run whose persisted state still says 'running'
 * was interrupted by a backend restart (pm2 restart, crash, deploy): its Python child
 * kept running as an orphan nobody tracks, and the UI showed it as running forever.
 * We kill the orphan (if it still belongs to that run) and mark the run as aborted.
 */
export async function recoverOrphanedRuns(labsRoot) {
  let labs = [];
  try { labs = await fs.readdir(labsRoot, { withFileTypes: true }); } catch { return []; }
  const recovered = [];
  for (const lab of labs) {
    if (!lab.isDirectory()) continue;
    const resultsRoot = path.join(labsRoot, lab.name, 'results');
    let results = [];
    try { results = await fs.readdir(resultsRoot, { withFileTypes: true }); } catch { continue; }
    for (const r of results) {
      if (!r.isDirectory()) continue;
      const resultDir = path.join(resultsRoot, r.name);
      const st = readPersistedState(resultDir);
      if (!st || (st.status !== 'running' && st.status !== 'idle')) continue;
      const now = new Date().toISOString();
      const note = 'Measure backend restarted while this step was running';
      let killed = false;
      if (st.pid && isPidAlive(st.pid)) {
        const cmd = readCmdline(st.pid);
        if (cmd.includes(path.join(labsRoot, lab.name))) {
          try { process.kill(st.pid, 'SIGTERM'); killed = true; } catch { /* ignore */ }
          const pid = st.pid;
          const t = setTimeout(() => { if (isPidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ } } }, 5000);
          if (typeof t.unref === 'function') t.unref();
        }
      }
      st.status = 'aborted';
      st.completedAt = now;
      st.updatedAt = now;
      st.pid = null;
      for (const step of st.steps || []) {
        if (step.status === 'running' || step.status === 'waiting' || step.status === 'debug-waiting' || step.status === 'debug-stopped') {
          step.status = 'failed';
          step.completedAt = now;
          step.error = note + (killed ? ' (orphaned process killed)' : '');
          step.rssMb = null;
        } else if (step.status === 'pending') {
          step.status = 'skipped';
        }
      }
      await fs.writeFile(path.join(resultDir, STATE_FILE_NAME), JSON.stringify(st, null, 2), 'utf-8').catch(() => {});
      try {
        const pPath = path.join(resultDir, '_progress.json');
        const progress = JSON.parse(await fs.readFile(pPath, 'utf-8'));
        progress.status = 'aborted';
        progress.completedAt = now;
        progress.updatedAt = now;
        await fs.writeFile(pPath, JSON.stringify(progress, null, 2), 'utf-8');
      } catch { /* no progress file */ }
      await fs.appendFile(path.join(resultDir, 'output.err'), `[measure] ${note}${killed ? `; orphaned process PID ${st.pid || '?'} terminated` : ''}\n`).catch(() => {});
      recovered.push({ labId: lab.name, resultId: r.name, killed });
    }
  }
  if (recovered.length) console.warn('[workflow-runner] recovered interrupted runs:', recovered);
  return recovered;
}
