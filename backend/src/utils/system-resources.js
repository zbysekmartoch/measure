/**
 * system-resources.js — System memory helpers and per-process memory guard
 * for workflow script execution.
 *
 * Provides:
 *   - readMemInfo()            — system memory snapshot (/proc/meminfo, os fallback)
 *   - getResourceLimits()      — effective limits derived from config + machine size
 *   - detectCgroupRunner()     — one-time probe whether `systemd-run --user --scope`
 *                                can enforce a hard MemoryMax cgroup limit
 *   - wrapWithMemoryLimit()    — wrap a command so it runs inside a limited cgroup
 *   - ProcessMemoryWatchdog    — samples RSS of a process tree, tracks peak, and
 *                                (as a fallback when no cgroup is available) kills
 *                                the tree when it exceeds the limit
 *   - describeProcessExit()    — human-readable explanation of a failed step
 */

import os from 'os';
import { readFileSync, readdirSync } from 'fs';
import { execFile } from 'child_process';
import { config } from '../config.js';

const MB = 1024 * 1024;

// ── System memory ───────────────────────────────────────────────────────────

/**
 * Read system memory from /proc/meminfo (Linux). Falls back to os.*
 * which has no notion of "available" (uses free).
 * @returns {{ totalMb:number, availableMb:number, freeMb:number, usedMb:number,
 *             usedPercent:number, swapTotalMb:number, swapUsedMb:number, source:string }}
 */
export function readMemInfo() {
  try {
    const text = readFileSync('/proc/meminfo', 'utf-8');
    const kb = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) kb[m[1]] = Number(m[2]);
    }
    const totalMb = (kb.MemTotal || 0) / 1024;
    const availableMb = (kb.MemAvailable ?? kb.MemFree ?? 0) / 1024;
    const freeMb = (kb.MemFree || 0) / 1024;
    const swapTotalMb = (kb.SwapTotal || 0) / 1024;
    const swapUsedMb = ((kb.SwapTotal || 0) - (kb.SwapFree || 0)) / 1024;
    const usedMb = totalMb - availableMb;
    return {
      totalMb: round1(totalMb),
      availableMb: round1(availableMb),
      freeMb: round1(freeMb),
      usedMb: round1(usedMb),
      usedPercent: totalMb > 0 ? round1((usedMb / totalMb) * 100) : 0,
      swapTotalMb: round1(swapTotalMb),
      swapUsedMb: round1(swapUsedMb),
      source: 'proc',
    };
  } catch {
    const totalMb = os.totalmem() / MB;
    const freeMb = os.freemem() / MB;
    return {
      totalMb: round1(totalMb),
      availableMb: round1(freeMb),
      freeMb: round1(freeMb),
      usedMb: round1(totalMb - freeMb),
      usedPercent: totalMb > 0 ? round1(((totalMb - freeMb) / totalMb) * 100) : 0,
      swapTotalMb: 0,
      swapUsedMb: 0,
      source: 'os',
    };
  }
}

function round1(v) {
  return Number((Number(v) || 0).toFixed(1));
}

// ── Limits from config ──────────────────────────────────────────────────────

/**
 * Effective resource limits. Absolute MB values in config win over percentages.
 *
 * config.json → "resources": {
 *   "maxMemoryMb": 0,            // hard cap per script; 0 = use maxMemoryPercent
 *   "maxMemoryPercent": 90,      // % of total RAM
 *   "minAvailableMb": 0,         // do not start a step below this; 0 = use percent
 *   "minAvailablePercent": 20,   // % of total RAM
 *   "waitPollMs": 5000,          // how often to re-check while waiting
 *   "maxWaitMs": 1800000,        // give up waiting after this (0 = wait forever)
 *   "sampleIntervalMs": 2000,    // RSS sampling interval for progress display
 *   "useCgroup": true            // try systemd-run --user --scope for a hard limit
 * }
 */
export function getResourceLimits() {
  const r = config.resources || {};
  const total = readMemInfo().totalMb;
  const pct = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const maxMemoryMb = pct(r.maxMemoryMb, 0) || Math.round(total * pct(r.maxMemoryPercent, 90) / 100);
  const minAvailableMb = pct(r.minAvailableMb, 0) || Math.round(total * pct(r.minAvailablePercent, 20) / 100);
  return {
    totalMb: total,
    maxMemoryMb,
    minAvailableMb,
    waitPollMs: pct(r.waitPollMs, 5000),
    maxWaitMs: Number.isFinite(Number(r.maxWaitMs)) ? Number(r.maxWaitMs) : 1_800_000,
    sampleIntervalMs: pct(r.sampleIntervalMs, 2000),
    useCgroup: r.useCgroup !== false,
  };
}

// ── cgroup (systemd-run) detection ──────────────────────────────────────────

let cgroupProbe = null;
let cgroupProbeResult = null;

/** Last known probe result without awaiting (null until the probe finished). */
export function getCgroupStatusSync() {
  return cgroupProbeResult;
}

/**
 * Probe once whether `systemd-run --user --scope -p MemoryMax=…` works for this
 * process (needs a user systemd instance with the memory controller delegated,
 * which is the default on modern distributions when the server runs inside a
 * user session; it is NOT available under e.g. a bare Docker container).
 * @returns {Promise<{ available: boolean, reason: string }>}
 */
export function detectCgroupRunner() {
  if (cgroupProbe) return cgroupProbe;
  cgroupProbe = new Promise((resolve) => {
    if (process.platform !== 'linux') {
      cgroupProbeResult = { available: false, reason: 'not linux' };
      return resolve(cgroupProbeResult);
    }
    const args = ['--user', '--scope', '--quiet', '-p', 'MemoryMax=64M', '-p', 'MemorySwapMax=0', '/bin/true'];
    execFile('systemd-run', args, { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) {
        cgroupProbeResult = { available: false, reason: (stderr || err.message || '').trim().split('\n')[0] || 'systemd-run failed' };
      } else {
        cgroupProbeResult = { available: true, reason: 'systemd-run --user --scope OK' };
      }
      resolve(cgroupProbeResult);
    });
  });
  return cgroupProbe;
}

/**
 * Wrap a command so it executes inside a transient user scope with a hard
 * memory ceiling. `systemd-run --scope` exec()s the command in place, so the
 * returned child PID is the real script process and signals reach it directly.
 * Returns the original command untouched when the cgroup runner is unavailable.
 */
export function wrapWithMemoryLimit(command, args, { maxMemoryMb, cgroupAvailable, unitName }) {
  if (!cgroupAvailable || !(maxMemoryMb > 0)) {
    return { command, args, limited: false };
  }
  const wrapped = [
    '--user', '--scope', '--quiet', '--collect',
    '-p', `MemoryMax=${Math.round(maxMemoryMb)}M`,
    '-p', 'MemorySwapMax=0',
  ];
  if (unitName) wrapped.push('--unit', unitName);
  wrapped.push('--', command, ...args);
  return { command: 'systemd-run', args: wrapped, limited: true };
}

// ── Process tree RSS ────────────────────────────────────────────────────────

function readRssMb(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) / 1024 : 0;
  } catch {
    return 0;
  }
}

function readChildren(pid) {
  const out = [];
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      try {
        const txt = readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf-8').trim();
        if (txt) out.push(...txt.split(/\s+/).map(Number));
      } catch { /* ignore */ }
    }
  } catch { /* process gone */ }
  return out;
}

/**
 * Sum of RSS over a process and all its descendants (MB). Linux only; returns
 * 0 elsewhere.
 */
export function readProcessTreeRssMb(rootPid) {
  if (process.platform !== 'linux' || !rootPid) return 0;
  let total = 0;
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += readRssMb(pid);
    stack.push(...readChildren(pid));
  }
  return round1(total);
}

function killTree(rootPid, signal) {
  const pids = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    stack.push(...readChildren(pid));
  }
  // children first so they do not get re-parented and survive
  for (const pid of pids.reverse()) {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

// ── Watchdog ────────────────────────────────────────────────────────────────

/**
 * Periodically samples the RSS of a child process tree.
 *
 *   const wd = new ProcessMemoryWatchdog(child.pid, { limitMb, enforce, intervalMs, onSample });
 *   ... child exits ...
 *   wd.stop();  →  wd.peakMb, wd.lastMb, wd.killed
 *
 * When `enforce` is true (no cgroup available) and RSS exceeds `limitMb`, the
 * whole tree is killed with SIGKILL and `killed` records why.
 */
export class ProcessMemoryWatchdog {
  constructor(pid, { limitMb = 0, enforce = false, intervalMs = 2000, onSample = null } = {}) {
    this.pid = pid;
    this.limitMb = limitMb;
    this.enforce = enforce;
    this.intervalMs = intervalMs;
    this.onSample = onSample;
    this.peakMb = 0;
    this.lastMb = 0;
    this.killed = null; // { rssMb, limitMb, at }
    this.samples = 0;
    this._timer = setInterval(() => this._tick(), intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    this._tick();
  }

  _tick() {
    const rss = readProcessTreeRssMb(this.pid);
    this.samples += 1;
    this.lastMb = rss;
    if (rss > this.peakMb) this.peakMb = rss;
    if (this.enforce && this.limitMb > 0 && rss > this.limitMb && !this.killed) {
      this.killed = { rssMb: rss, limitMb: this.limitMb, at: new Date().toISOString() };
      killTree(this.pid, 'SIGKILL');
    }
    if (this.onSample) {
      try { this.onSample({ rssMb: rss, peakMb: this.peakMb, killed: this.killed }); } catch { /* ignore */ }
    }
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

// ── Exit description ────────────────────────────────────────────────────────

function fmtMb(mb) {
  if (!Number.isFinite(mb)) return '?';
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

/**
 * Build a human-readable explanation for a non-zero exit. Detects the two
 * memory cases explicitly:
 *   - killed by our watchdog (soft limit, no cgroup)
 *   - SIGKILL with no stderr → almost certainly the kernel OOM killer
 *     (cgroup MemoryMax or system-wide), which never prints a traceback
 */
export function describeProcessExit({ code, signal, peakMb = 0, limitMb = 0, limited = false, killedByWatchdog = null, stderrBytes = 0, available = null }) {
  const peak = peakMb > 0 ? `peak RSS ${fmtMb(peakMb)}` : 'peak RSS unknown';
  if (killedByWatchdog) {
    return `killed by Measure memory watchdog: RSS ${fmtMb(killedByWatchdog.rssMb)} exceeded limit ${fmtMb(killedByWatchdog.limitMb)} (${peak})`;
  }
  if (signal === 'SIGKILL') {
    const limitTxt = limited && limitMb > 0 ? ` of ${fmtMb(limitMb)}` : '';
    const sys = available != null ? `, system available now ${fmtMb(available)}` : '';
    const tail = stderrBytes === 0 ? ' — no traceback was written, which is typical for an out-of-memory kill' : '';
    return `killed by SIGKILL — most likely out of memory (${peak}${limitTxt}${sys})${tail}`;
  }
  if (signal) {
    return `terminated by signal ${signal} (${peak})`;
  }
  if (code === 137) {
    return `exit code 137 (SIGKILL, most likely out of memory; ${peak})`;
  }
  if (code === 139) {
    return `exit code 139 (segmentation fault in a native library; ${peak})`;
  }
  return `exit code ${code} (${peak})`;
}

export { fmtMb };
