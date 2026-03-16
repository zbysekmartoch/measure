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
import { promises as fs } from 'fs';
import path from 'path';
import {
  startDebugSession,
  getDebugEvents,
  getDebugStatus,
  endDebugSession,
} from '../debug/debug-engine.js';

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
   * @param {string} opts.workflowRoot — relative directory of the .workflow file within scripts
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
    this.resultDir = opts.resultDir;
    this.scriptsRoot = opts.scriptsRoot;
    this.workflowRoot = opts.workflowRoot || '';
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
    }));
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
      currentStepIndex: this.currentStepIndex,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      debugVisible: this.debugVisible,
      stopOnFailure: this.stopOnFailure,
    };
  }

  /**
   * Emit a named event and also always emit a 'state' event with full snapshot.
   */
  _emit(eventName, data) {
    this.emit(eventName, data);
    this.emit('state', this.getState());
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
      path.join(this.resultDir, 'progress.json'),
      JSON.stringify(p, null, 2),
      'utf-8',
    );
  }

  /**
   * Append a debug log message.
   */
  async _debugLog(msg) {
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

    // Initialize log files
    await fs.writeFile(this.logFile, `Workflow execution started at ${now}\n${separator}\n`, 'utf-8');
    await fs.writeFile(this.errorFile, '', 'utf-8');
    await fs.writeFile(this.debugLogFile, `[debuger] Session started at ${now}\n${separator}\n`, 'utf-8');

    this._emit('workflow-start', {
      steps: [...this.steps],
      totalSteps: this.steps.length,
    });

    const workflowStartTime = Date.now();

    try {
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
        const stepStartTime = Date.now();

        // Update step status
        this.stepStatuses[i].status = StepStatus.RUNNING;
        this.stepStatuses[i].startedAt = new Date().toISOString();

        await this._writeProgress(i + 1, stepName, 'running');
        await fs.appendFile(this.logFile, `\n[${new Date().toISOString()}] Step ${i + 1}/${this.steps.length}: ${stepName}\n`);

        this._emit('step-start', {
          index: i,
          name: stepName,
          startedAt: this.stepStatuses[i].startedAt,
        });

        let success = false;

        if (shouldDebug) {
          // ── Debug mode: spawn via debugpy ──
          await this._debugLog(`Starting debugpy for step ${stepName}`);

          try {
            const { port, pid } = await startDebugSession({
              scriptAbsolutePath: scriptAbsPath,
              scriptPath: stepName,
              cwd: this.resultDir,
              pythonCommand: this.pythonCmd,
              args: [this.resultDir, this.workflowRoot, this.scriptsRoot],
              labId: this.labId,
              resultId: this.resultId,
              stepIndex: i,
              stepName: stepName,
              extraEnv: { PYTHONPATH: this.libScriptsPath + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '') },
              logFile: this.logFile,
              errorFile: this.errorFile,
            });

            await this._debugLog(`debugpy listening on port ${port}, PID ${pid}, waiting for client...`);
            await fs.appendFile(this.logFile, `[debugpy] listening on port ${port}, PID ${pid}\n`);

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

            success = await new Promise((resolve) => {
              const onStatus = (s) => {
                if (s.status !== lastDebugStatus) {
                  lastDebugStatus = s.status;
                  if (s.status === 'running' && this.stepStatuses[i].status === StepStatus.DEBUG_WAITING) {
                    this.stepStatuses[i].status = StepStatus.RUNNING;
                    this._emit('debug-attached', { index: i, name: stepName, status: 'running' });
                  } else if (s.status === 'waiting_for_client') {
                    this.stepStatuses[i].status = StepStatus.DEBUG_WAITING;
                    this._emit('debug-waiting', { index: i, name: stepName, port: s.port, status: 'waiting_for_client' });
                  }
                }
              };

              const onExit = (info) => {
                debugEvents.off('exit', onExit);
                debugEvents.off('status', onStatus);
                resolve(info.code === 0 || info.code === null);
              };

              debugEvents.on('exit', onExit);
              debugEvents.on('status', onStatus);

              // Check if already ended
              const st = getDebugStatus();
              if (!st.active) {
                debugEvents.off('exit', onExit);
                debugEvents.off('status', onStatus);
                resolve(false);
              }
            });

            await this._debugLog(`Step ${stepName} debug process exited, success=${success}`);

          } catch (err) {
            await this._debugLog(`Failed to start debug session: ${err.message}`);
            await fs.appendFile(this.errorFile, `[debugpy] Failed: ${err.message}\n`);
            success = false;
          }
        } else if (isPython) {
          // ── Python without debug ──
          success = await this._spawnScript(this.pythonCmd, scriptAbsPath);
        } else {
          // ── Non-Python scripts ──
          const cmdMap = { '.js': 'node', '.cjs': 'node', '.sh': 'bash', '.r': 'Rscript', '.R': 'Rscript' };
          const command = cmdMap[ext];
          if (!command) {
            await fs.appendFile(this.errorFile, `Unsupported script type: ${ext}\n`);
            success = false;
          } else {
            success = await this._spawnScript(command, scriptAbsPath);
          }
        }

        // Update step status after completion
        const stepDuration = Date.now() - stepStartTime;
        this.stepStatuses[i].durationMs = stepDuration;
        this.stepStatuses[i].completedAt = new Date().toISOString();

        if (success) {
          this.stepStatuses[i].status = StepStatus.COMPLETED;
          this.stepStatuses[i].exitCode = 0;
          this._emit('step-complete', {
            index: i,
            name: stepName,
            durationMs: stepDuration,
            exitCode: 0,
          });
        } else {
          this.stepStatuses[i].status = StepStatus.FAILED;
          this.stepStatuses[i].exitCode = 1;
          this.stepStatuses[i].error = `Script ${stepName} failed`;

          this._emit('step-failed', {
            index: i,
            name: stepName,
            durationMs: stepDuration,
            exitCode: 1,
            error: `Script ${stepName} failed`,
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
            await fs.appendFile(this.errorFile, `Step ${stepName} failed\n`);

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
          await fs.appendFile(this.logFile, `\n${separator}\n[${new Date().toISOString()}] WORKFLOW COMPLETED\n${separator}\n`);
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
   * @returns {Promise<boolean>} true if exit code was 0
   */
  _spawnScript(command, scriptAbsPath) {
    return new Promise((resolve) => {
      const env = { ...process.env, WORK_DIR: this.resultDir };
      // Add shared lib scripts to PYTHONPATH so labs can import from labs/lib/scripts
      if (command === this.pythonCmd) {
        env.PYTHONPATH = this.libScriptsPath + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '');
      }
      const child = spawn(command, [scriptAbsPath, this.resultDir, this.workflowRoot, this.scriptsRoot], {
        cwd: this.resultDir,
        env,
      });

      this._currentProcess = child;

      child.stdout.on('data', (d) => {
        fs.appendFile(this.logFile, d.toString()).catch(() => {});
      });

      child.stderr.on('data', (d) => {
        fs.appendFile(this.errorFile, d.toString()).catch(() => {});
      });

      child.on('error', () => {
        this._currentProcess = null;
        resolve(false);
      });

      child.on('close', (code) => {
        this._currentProcess = null;
        resolve(code === 0);
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
      if (current.status === StepStatus.RUNNING || current.status === StepStatus.DEBUG_WAITING || current.status === StepStatus.DEBUG_STOPPED) {
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
    // Keep the run in the map for a short time so SSE clients can get final state
    setTimeout(() => {
      activeRuns.delete(this.key);
    }, 30000); // 30 seconds
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
