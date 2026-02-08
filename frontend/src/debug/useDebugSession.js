/**
 * useDebugSession.js — React hook for managing a DAP debug session.
 *
 * Provides:
 *   - Connection to backend SSE for debug lifecycle events
 *   - DAP client connection + initialization
 *   - Breakpoints management (per-file, synced to DAP)
 *   - Stepping controls (continue, next, stepIn, stepOut)
 *   - Call stack + variables on stopped events
 *   - Current stopped location (file + line)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { DapClient } from './dap-client.js';

/**
 * @param {object} opts
 * @param {string} opts.labId — lab identifier for persisting breakpoints to debug.json
 * @returns debug session state + actions
 */
export function useDebugSession({ labId } = {}) {
  // ── State ──
  const [status, setStatus] = useState('idle'); // idle | connecting | attached | stopped | running | ended
  const [debugInfo, setDebugInfo] = useState(null); // backend debug status
  const [callStack, setCallStack] = useState([]); // StackFrame[]
  const [variables, setVariables] = useState([]); // Variable[]
  const [selectedFrameId, setSelectedFrameId] = useState(null);
  const [stoppedLocation, setStoppedLocation] = useState(null); // { file, line }
  const [stoppedThreadId, setStoppedThreadId] = useState(null);
  const [output, setOutput] = useState([]); // { type: 'stdout'|'stderr', text }[]
  const [error, setError] = useState(null);

  // ── Breakpoints: Map<relPath, Set<lineNumber>> ──
  // Keys are relative paths within the lab's scripts folder (e.g. "analyzy/sum.py")
  const [breakpointsMap, setBreakpointsMap] = useState(() => new Map());
  const bpSaveTimerRef = useRef(null);

  // ── Refs ──
  const clientRef = useRef(null);
  const sseRef = useRef(null);
  const pollingRef = useRef(null);
  const debugInfoRef = useRef(null); // latest debug info for abs path resolution

  /**
   * Resolve a relative script path to an absolute path using debug info.
   * The debug status provides scriptAbsolutePath and scriptPath — we can
   * derive the scriptsRoot from those.
   */
  function resolveAbsPath(relPath, info) {
    if (!info) return null;
    const sp = info.scriptPath;
    const sap = info.scriptAbsolutePath;
    if (sp && sap && sap.endsWith(sp)) {
      const root = sap.slice(0, -sp.length);
      return root + relPath;
    }
    return null;
  }

  // ── Load breakpoints from debug.json on mount ──
  useEffect(() => {
    if (!labId) return;
    const token = localStorage.getItem('authToken');
    fetch(`/api/v1/labs/${labId}/debug-state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : { breakpoints: {} })
      .then(data => {
        if (data.breakpoints && typeof data.breakpoints === 'object') {
          const map = new Map();
          for (const [filePath, lines] of Object.entries(data.breakpoints)) {
            if (Array.isArray(lines) && lines.length > 0) {
              map.set(filePath, new Set(lines));
            }
          }
          setBreakpointsMap(map);
        }
      })
      .catch(() => { /* ignore — no debug state yet */ });
  }, [labId]);

  // ── Persist breakpoints to debug.json (debounced) ──
  const persistBreakpoints = useCallback((map) => {
    if (!labId) return;
    if (bpSaveTimerRef.current) clearTimeout(bpSaveTimerRef.current);
    bpSaveTimerRef.current = setTimeout(() => {
      const breakpoints = {};
      for (const [filePath, lines] of map) {
        if (lines.size > 0) {
          breakpoints[filePath] = [...lines].sort((a, b) => a - b);
        }
      }
      const token = localStorage.getItem('authToken');
      fetch(`/api/v1/labs/${labId}/debug-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ breakpoints }),
      }).catch(() => { /* ignore */ });
    }, 500);
  }, [labId]);

  // ── Cleanup ──
  useEffect(() => {
    const sse = sseRef;
    const polling = pollingRef;
    const client = clientRef;
    const bpTimer = bpSaveTimerRef;
    return () => {
      if (client.current) { try { client.current.disconnect(); } catch { /* ignore */ } }
      if (sse.current) sse.current.close();
      if (polling.current) clearInterval(polling.current);
      if (bpTimer.current) clearTimeout(bpTimer.current);
    };
  }, []);

  // ── Poll debug status from backend ──
  const pollStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch('/api/v1/debug/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDebugInfo(data);
        debugInfoRef.current = data;
        return data;
      }
    } catch { /* network error, ignore */ }
    return null;
  }, []);

  // ── Start SSE for debug events ──
  const startSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();

    const token = localStorage.getItem('authToken');
    const es = new EventSource(`/api/v1/debug/events?token=${token}`);
    sseRef.current = es;

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setDebugInfo(data);
        debugInfoRef.current = data;
        if (data.status === 'ended') {
          setStatus('ended');
        }
      } catch { /* parse error */ }
    });

    es.addEventListener('stdout', (ev) => {
      try {
        const text = JSON.parse(ev.data);
        setOutput(prev => [...prev, { type: 'stdout', text }]);
      } catch { /* parse error */ }
    });

    es.addEventListener('stderr', (ev) => {
      try {
        const text = JSON.parse(ev.data);
        setOutput(prev => [...prev, { type: 'stderr', text }]);
      } catch { /* parse error */ }
    });

    es.addEventListener('exit', () => {
      setStatus('ended');
    });

    es.onerror = () => {
      // SSE reconnects automatically, but set error state
    };
  }, []);

  // ── Attach debugger ──
  const attach = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    setOutput([]);
    setCallStack([]);
    setVariables([]);
    setStoppedLocation(null);

    try {
      // Get current debug status
      const info = await pollStatus();
      if (!info?.active) {
        setError('No active debug session on backend');
        setStatus('idle');
        return;
      }

      // Start SSE
      startSSE();

      // Connect DAP client
      const wsUrl = info.wsUrl || '/dap';
      const client = new DapClient(wsUrl);
      clientRef.current = client;

      // Listen for DAP events
      client.on('stopped', async (body) => {
        setStatus('stopped');
        setStoppedThreadId(body.threadId);

        // Fetch stack trace
        try {
          const st = await client.stackTrace(body.threadId);
          const frames = st.stackFrames || [];
          setCallStack(frames);

          if (frames.length > 0) {
            const topFrame = frames[0];
            setSelectedFrameId(topFrame.id);
            setStoppedLocation({
              file: topFrame.source?.path || null,
              line: topFrame.line,
              name: topFrame.source?.name || null,
            });

            // Fetch variables for top frame
            try {
              const sc = await client.scopes(topFrame.id);
              const localScope = (sc.scopes || []).find(s => s.name === 'Locals' || s.name === 'Local');
              if (localScope) {
                const vars = await client.variables(localScope.variablesReference);
                setVariables(vars.variables || []);
              }
            } catch { /* ignore */ }
          }
        } catch (e) {
          console.error('[useDebugSession] stackTrace error:', e);
        }
      });

      client.on('continued', () => {
        setStatus('running');
        setStoppedLocation(null);
      });

      client.on('terminated', () => {
        setStatus('ended');
      });

      client.on('exited', () => {
        setStatus('ended');
      });

      client.on('disconnected', () => {
        setStatus('ended');
      });

      // Connect
      await client.connect();

      // Initialize
      await client.initialize();

      // Attach
      await client.attach();

      // Send all breakpoints (resolve relative paths to absolute for DAP)
      for (const [relPath, lines] of breakpointsMap) {
        if (lines.size > 0) {
          const absFilePath = resolveAbsPath(relPath, info);
          if (absFilePath) {
            try {
              await client.setBreakpoints(absFilePath, [...lines]);
            } catch (e) {
              console.warn('[useDebugSession] setBreakpoints error:', e);
            }
          }
        }
      }

      // Configuration done
      await client.configurationDone();

      setStatus('running');
    } catch (e) {
      setError(e.message);
      setStatus('idle');
      console.error('[useDebugSession] attach error:', e);
    }
  }, [pollStatus, startSSE, breakpointsMap]);

  // ── Detach / stop ──
  const detach = useCallback(async () => {
    if (clientRef.current) {
      try { await clientRef.current.request('disconnect', { terminateDebuggee: true }); } catch { /* ignore */ }
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    // Also tell backend to stop
    try {
      const token = localStorage.getItem('authToken');
      await fetch('/api/v1/debug/stop', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch { /* ignore */ }
    setStatus('ended');
  }, []);

  // ── Stepping ──
  const doContinue = useCallback(async () => {
    if (!clientRef.current || !stoppedThreadId) return;
    try {
      await clientRef.current.continue(stoppedThreadId);
      setStatus('running');
      setStoppedLocation(null);
    } catch (e) {
      setError(e.message);
    }
  }, [stoppedThreadId]);

  const doNext = useCallback(async () => {
    if (!clientRef.current || !stoppedThreadId) return;
    try {
      await clientRef.current.next(stoppedThreadId);
      setStatus('running');
    } catch (e) {
      setError(e.message);
    }
  }, [stoppedThreadId]);

  const doStepIn = useCallback(async () => {
    if (!clientRef.current || !stoppedThreadId) return;
    try {
      await clientRef.current.stepIn(stoppedThreadId);
      setStatus('running');
    } catch (e) {
      setError(e.message);
    }
  }, [stoppedThreadId]);

  const doStepOut = useCallback(async () => {
    if (!clientRef.current || !stoppedThreadId) return;
    try {
      await clientRef.current.stepOut(stoppedThreadId);
      setStatus('running');
    } catch (e) {
      setError(e.message);
    }
  }, [stoppedThreadId]);

  // ── Select frame ──
  const selectFrame = useCallback(async (frameId) => {
    setSelectedFrameId(frameId);
    if (!clientRef.current) return;

    const frame = callStack.find(f => f.id === frameId);
    if (frame) {
      setStoppedLocation({
        file: frame.source?.path || null,
        line: frame.line,
        name: frame.source?.name || null,
      });

      // Fetch variables for this frame
      try {
        const sc = await clientRef.current.scopes(frameId);
        const localScope = (sc.scopes || []).find(s => s.name === 'Locals' || s.name === 'Local');
        if (localScope) {
          const vars = await clientRef.current.variables(localScope.variablesReference);
          setVariables(vars.variables || []);
        } else {
          setVariables([]);
        }
      } catch { setVariables([]); }
    }
  }, [callStack]);

  // ── Breakpoints ──
  // filePath here is the RELATIVE path within scripts (e.g. "analyzy/sum.py")
  const toggleBreakpoint = useCallback((filePath, line) => {
    setBreakpointsMap(prev => {
      const next = new Map(prev);
      const lines = new Set(next.get(filePath) || []);
      if (lines.has(line)) {
        lines.delete(line);
      } else {
        lines.add(line);
      }
      if (lines.size === 0) {
        next.delete(filePath);
      } else {
        next.set(filePath, lines);
      }

      // Persist to debug.json
      persistBreakpoints(next);

      // Sync to DAP if connected (need absolute path for DAP)
      if (clientRef.current?.connected) {
        const info = debugInfoRef.current;
        const absFilePath = resolveAbsPath(filePath, info);
        if (absFilePath) {
          clientRef.current.setBreakpoints(absFilePath, [...lines]).catch(() => {});
        }
      }

      return next;
    });
  }, [persistBreakpoints]);

  const getBreakpoints = useCallback((filePath) => {
    return breakpointsMap.get(filePath) || new Set();
  }, [breakpointsMap]);

  const clearBreakpoints = useCallback((filePath) => {
    setBreakpointsMap(prev => {
      const next = new Map(prev);
      next.delete(filePath);

      persistBreakpoints(next);

      if (clientRef.current?.connected) {
        const info = debugInfoRef.current;
        const absFilePath = resolveAbsPath(filePath, info);
        if (absFilePath) {
          clientRef.current.setBreakpoints(absFilePath, []).catch(() => {});
        }
      }

      return next;
    });
  }, [persistBreakpoints]);

  // ── Expand variable children ──
  const expandVariable = useCallback(async (variablesReference) => {
    if (!clientRef.current) return [];
    try {
      const result = await clientRef.current.variables(variablesReference);
      return result.variables || [];
    } catch {
      return [];
    }
  }, []);

  return {
    // State
    status,
    debugInfo,
    callStack,
    variables,
    selectedFrameId,
    stoppedLocation,
    output,
    error,
    breakpointsMap,

    // Actions
    attach,
    detach,
    doContinue,
    doNext,
    doStepIn,
    doStepOut,
    selectFrame,
    toggleBreakpoint,
    getBreakpoints,
    clearBreakpoints,
    expandVariable,
    pollStatus,
  };
}
