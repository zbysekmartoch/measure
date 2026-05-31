/**
 * LabResultsPane — "Results" sub-tab of a lab workspace.
 *
 * Shows:
 *   1. A result selector dropdown (subfolders of lab's results/)
 *   2. Separate "Run" and "Debug" buttons for workflow execution
 *   3. "Stop on failure" checkbox
 *   4. WorkflowProgressPane with real-time step-by-step progress
 *   5. FileManagerEditor rooted in the selected result subfolder
 *
 * The debug panel itself lives in LabWorkspaceTab (shown as a splitter pane).
 * This component receives `debug` from parent to trigger debug runs + auto-attach.
 *
 * Props:
 *   lab   – lab metadata { id, name, … }
 *   debug – debug session object from useDebugSession() (provided by LabWorkspaceTab)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog.jsx';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile } from '../components/file-manager/fileUtils.js';
import CodeEditor from '../components/CodeEditor.jsx';
import { appConfig as appCfg } from '../lib/appConfig.js';
import { shadow, resultButtons as rbtn } from '../lib/uiConfig.js';
import ZoomableImage from '../components/ZoomableImage.jsx';
import WorkflowProgressPane from '../components/WorkflowProgressPane.jsx';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents.js';

/** Build display label for a result: "run.name [folderId]" or just "#folderId" */
function getResultLabel(r) {
  if (r.run?.name) return `${r.run.name} [${r.id}]`;
  return `#${r.id}`;
}

export default function LabResultsPane({
  lab,
  debug,
  debugVisible = false,
  runDebugRef,
  runResultRef,
  onAnalyze,
  appConfig,
  saveAllRef,
  onShowDebugPanel,
  pollingEnabled = true,
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();

  const [results, setResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(true);
  const [showProgress, setShowProgress] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sseKey, setSseKey] = useState(0); // bump to force SSE reconnection
  const [preRunMessages, setPreRunMessages] = useState([]); // messages shown above workflow steps ("saved ...", "skipped ...")

  // ---- Open file tabs (sub-tabs within Results) ----
  const [activeSubTab, setActiveSubTab] = useState('browser');
  const [openFiles, setOpenFiles] = useState([]);
  const [editorTheme] = useState(() => localStorage.getItem('monacoTheme') || 'vs-dark');

  const pollIntervalRef = useRef(null);

  // Ref to access latest debug callbacks without causing effect re-runs
  const debugActionsRef = useRef(null);
  debugActionsRef.current = { attach: debug.attach, pollStatus: debug.pollStatus };

  // ---- Workflow SSE events (real-time progress) ----
  const { workflowState: rawWorkflowState } = useWorkflowEvents(lab.id, selectedResultId, showProgress || workflowRunning, sseKey);

  // Merge workflow state with frontend debug status for accurate step statuses
  const workflowState = useMemo(() => {
    if (!rawWorkflowState) return null;
    if (!debugVisible && !rawWorkflowState.debugVisible) return rawWorkflowState;

    // If the frontend debug session is stopped at a breakpoint, patch the current
    // running/debug-waiting step to show debug-stopped
    const debugStatus = debug.status;
    const steps = rawWorkflowState.steps?.map(s => {
      if ((s.status === 'running' || s.status === 'debug-waiting') && debugStatus === 'stopped') {
        return { ...s, status: 'debug-stopped' };
      }
      return s;
    });
    return { ...rawWorkflowState, steps };
  }, [rawWorkflowState, debug.status, debugVisible]);

  // Auto-show progress when workflow begins, auto-hide when done
  useEffect(() => {
    if (!workflowState) return;
    const st = workflowState.status;
    if (st === 'running') {
      setShowProgress(true);
      setWorkflowRunning(true);
    } else if (st === 'completed' || st === 'failed' || st === 'aborted' || st === 'idle') {
      setWorkflowRunning(false);
      // Keep progress visible so user sees final state — they can close manually
      // (except idle means no active run — hide if there are no steps)
      if (st === 'idle' && (!workflowState.steps || workflowState.steps.length === 0)) {
        setShowProgress(false);
      }
    }
  }, [workflowState]);

  // Auto-attach debugger when workflow enters debug-waiting state.
  // Uses AbortController for cancellation and debugActionsRef to avoid
  // depending on the whole `debug` object (which changes identity every render).
  const attachAbortRef = useRef(null);

  useEffect(() => {
    // Use workflowState.debugVisible (from backend) — NOT the prop debugVisible —
    // so auto-attach works even when the debug panel hasn't been opened yet.
    if (!workflowState || !workflowState.debugVisible) return;
    const waitingStep = workflowState.steps?.find(s => s.status === 'debug-waiting');
    if (!waitingStep) return;
    // Allow re-attach from idle and ended states (ended = previous step finished)
    if (debug.status !== 'idle' && debug.status !== 'ended') return;

    // Cancel any previous in-flight auto-attach loop
    if (attachAbortRef.current) attachAbortRef.current.abort();
    const controller = new AbortController();
    attachAbortRef.current = controller;

    const doAttach = async () => {
      console.log(`[LabResultsPane] Auto-attach: waiting step "${waitingStep.name}", debug.status="${debug.status}"`);
      // Auto-show debug panel if it's hidden
      if (onShowDebugPanel) onShowDebugPanel();

      const maxAttempts = 30;
      const interval = 500;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (controller.signal.aborted) return;
        await new Promise(r => setTimeout(r, interval));
        if (controller.signal.aborted) return;
        try {
          const info = await debugActionsRef.current.pollStatus();
          console.log(`[LabResultsPane] Auto-attach attempt ${attempt + 1}: backend=${info?.status}`);
          if (controller.signal.aborted) return;
          if (info?.active && info?.status === 'waiting_for_client') {
            await debugActionsRef.current.attach();
            console.log('[LabResultsPane] Auto-attach successful');
            return; // done
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          console.warn(`[LabResultsPane] Auto-attach attempt ${attempt + 1} error:`, e.message);
        }
      }
      console.warn('[LabResultsPane] Auto-attach failed after all attempts');
    };

    doAttach();

    // Cleanup: cancel the loop when deps change or component unmounts
    return () => controller.abort();
  }, [workflowState, debug.status, onShowDebugPanel]);

  // ---- Load result list ----
  const loadResults = useCallback(async () => {
    try {
      const data = await fetchJSON(`/api/v1/labs/${lab.id}/results`);
      setResults(data.items || []);
    } catch {
      setResults([]);
    }
  }, [lab.id]);

  useEffect(() => {
    if (!pollingEnabled) return;
    loadResults();
  }, [loadResults, pollingEnabled]);

  // ---- Filter & sort results ----
  // Show own results + non-private results from others, sort alphabetically by display name
  const filteredResults = useMemo(() => {
    const currentUserId = user?.id != null ? String(user.id) : null;
    const visible = results.filter((r) => {
      const run = r.run;
      if (!run) return true; // legacy results without run — always show
      const isOwn = currentUserId && String(run._usr_id) === currentUserId;
      if (isOwn) return true;
      return !run.private; // show others only if not private
    });
    // Sort alphabetically by display label
    visible.sort((a, b) => {
      const labelA = getResultLabel(a);
      const labelB = getResultLabel(b);
      return labelA.localeCompare(labelB);
    });
    return visible;
  }, [results, user]);

  // ---- Select result ----
  const handleSelect = useCallback((e) => {
    const id = e.target.value;
    setSelectedResultId(id);
    if (!id) { setSelectedResult(null); return; }
    const item = filteredResults.find((r) => r.id === id);
    setSelectedResult(item || null);
    setRefreshTrigger((p) => p + 1);
  }, [filteredResults]);

  // ---- Remove result ----
  const handleRemoveResult = useCallback(async () => {
    if (!selectedResult) return;
    const shouldRemove = await dialog.confirm({
      title: 'Remove debug session',
      message: `Remove debug session "${getResultLabel(selectedResult)}"?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      tone: 'danger',
    });
    if (!shouldRemove) return;
    try {
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}`, { method: 'DELETE' });
      toast.success(`Debug session ${selectedResult.id} removed`);
      setSelectedResultId('');
      setSelectedResult(null);
      loadResults();
    } catch (err) {
      toast.error(`Remove failed: ${err.message || err}`);
    }
  }, [selectedResult, lab.id, toast, loadResults, dialog]);

  // ---- Polling for running results ----
  const isPending = selectedResult?.status === 'pending' || selectedResult?.status === 'running';

  // ---- Refresh content of all open file tabs (when workflow completes) ----
  const refreshOpenFileTabs = useCallback(() => {
    if (!selectedResultId || openFiles.length === 0) return;
    const apiPath = `/api/v1/labs/${lab.id}/results/${selectedResultId}/files`;
    openFiles.forEach((file) => {
      if (!file.isText) return;
      fetch(`${apiPath}/content?file=${encodeURIComponent(file.path)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(data => {
          setOpenFiles(prev => prev.map(f =>
            f.path === file.path ? { ...f, content: data.content || '' } : f
          ));
        })
        .catch(() => { /* ignore */ });
    });
  }, [lab.id, selectedResultId, openFiles]);

  useEffect(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (!pollingEnabled) return;
    if (!selectedResultId || !isPending) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const data = await fetchJSON(`/api/v1/labs/${lab.id}/results`);
        const items = data.items || [];
        setResults(items);
        const updated = items.find((r) => r.id === selectedResultId);
        if (updated) {
          setSelectedResult(updated);
          if (updated.status !== 'pending' && updated.status !== 'running') {
            setRefreshTrigger((p) => p + 1);
            // Refresh content of any open file tabs
            refreshOpenFileTabs();
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch { /* ignore */ }
    }, appCfg.RESULT_LOG_POLL_INTERVAL_MS || 3000);

    return () => { if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } };
  }, [selectedResultId, isPending, lab.id, refreshOpenFileTabs, pollingEnabled]);

  // Refresh file browser when workflow steps complete (for file change highlighting)
  useEffect(() => {
    const onStepDone = () => {
      setRefreshTrigger(p => p + 1);
    };
    const onWorkflowDone = () => {
      setRefreshTrigger(p => p + 1);
      loadResults();
      refreshOpenFileTabs();
    };
    window.addEventListener('workflow:step-complete', onStepDone);
    window.addEventListener('workflow:step-failed', onStepDone);
    window.addEventListener('workflow:workflow-complete', onWorkflowDone);
    window.addEventListener('workflow:workflow-failed', onWorkflowDone);
    window.addEventListener('workflow:workflow-aborted', onWorkflowDone);
    return () => {
      window.removeEventListener('workflow:step-complete', onStepDone);
      window.removeEventListener('workflow:step-failed', onStepDone);
      window.removeEventListener('workflow:workflow-complete', onWorkflowDone);
      window.removeEventListener('workflow:workflow-failed', onWorkflowDone);
      window.removeEventListener('workflow:workflow-aborted', onWorkflowDone);
    };
  }, [loadResults, refreshOpenFileTabs]);

  // ---- Run workflow (no debug) ----
  const handleRun = useCallback(async () => {
    if (!selectedResult) return;
    try {
      setWorkflowRunning(true);
      setShowProgress(true);
      setPreRunMessages([]);

      // Auto-save all dirty script files before running
      if (saveAllRef?.current) {
        try {
          const saved = await saveAllRef.current();
          if (saved.length > 0) {
            setPreRunMessages(saved.map(f => ({ type: 'saved', text: `${f} saved` })));
          }
        } catch (e) {
          console.warn('[LabResultsPane] auto-save error:', e);
        }
      }

      // Start the workflow FIRST so the run is registered in activeRuns
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugVisible: false, stopOnFailure }),
      });
      // THEN reconnect SSE — the run is guaranteed to exist now
      setSseKey(k => k + 1);
      toast.success(t('workflowStarted') || 'Workflow started');
      loadResults();
    } catch (err) {
      toast.error(`${t('errorStartingWorkflow') || 'Error'}: ${err.message || err}`);
      setWorkflowRunning(false);
    }
  }, [selectedResult, lab.id, t, toast, loadResults, stopOnFailure, saveAllRef]);

  // ---- Debug workflow ----
  const handleDebug = useCallback(async () => {
    if (!selectedResult) return;
    try {
      setWorkflowRunning(true);
      setShowProgress(true);
      setPreRunMessages([]);

      // Auto-save all dirty script files before debugging
      if (saveAllRef?.current) {
        try {
          const saved = await saveAllRef.current();
          if (saved.length > 0) {
            setPreRunMessages(saved.map(f => ({ type: 'saved', text: `${f} saved` })));
          }
        } catch (e) {
          console.warn('[LabResultsPane] auto-save error:', e);
        }
      }

      // Force-stop any existing debug session before starting a new one
      if (debug) {
        try { await debug.detach(); } catch { /* ignore */ }
      }

      // Start the workflow FIRST so the run is registered in activeRuns
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugVisible: true, stopOnFailure }),
      });
      // THEN reconnect SSE — the run is guaranteed to exist now
      setSseKey(k => k + 1);
      toast.success(t('debugWorkflowStarted') || 'Debug workflow started');
      loadResults();
    } catch (err) {
      toast.error(`${t('errorStartingDebugAnalysis') || 'Error'}: ${err.message || err}`);
      setWorkflowRunning(false);
    }
  }, [selectedResult, lab.id, t, toast, loadResults, stopOnFailure, debug, saveAllRef]);

  // ---- Load current_output into selected result ----
  const handleLoadCurrentOutput = useCallback(async () => {
    if (!selectedResult) return;
    try {
      const data = await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/load-current-output`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      setRefreshTrigger((p) => p + 1);
      refreshOpenFileTabs();

      const copiedCount = Number.isFinite(data?.copiedCount) ? data.copiedCount : null;
      if (copiedCount === 0) {
        toast.success(`${t('currentOutputLoaded') || 'Current output loaded into selected session'} (0 items)`);
      } else if (copiedCount != null) {
        toast.success(`${t('currentOutputLoaded') || 'Current output loaded into selected session'} (${copiedCount} ${copiedCount === 1 ? 'item' : 'items'})`);
      } else {
        toast.success(t('currentOutputLoaded') || 'Current output loaded into selected session');
      }
    } catch (err) {
      toast.error(`${t('errorLoadingCurrentOutput') || 'Error loading current output'}: ${err.message || err}`);
    }
  }, [selectedResult, lab.id, t, toast, refreshOpenFileTabs]);

  // ---- Reset (abort) a running/pending result ----
  const handleReset = useCallback(async () => {
    if (!selectedResult) return;
    try {
      // Stop debug session if active
      if (debug) {
        try { await debug.detach(); } catch { /* ignore */ }
      }
      // Abort workflow / update progress.json
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setWorkflowRunning(false);
      setShowProgress(false);
      toast.success('Result reset');
      loadResults();
    } catch (err) {
      toast.error(`Reset failed: ${err.message || err}`);
    }
  }, [selectedResult, lab.id, toast, loadResults, debug]);

  // Expose handleRun for F9 keyboard shortcut (via ref from parent)
  // F9 runs, Shift+F9 could debug in future
  const handleRunDebug = debugVisible ? handleDebug : handleRun;
  useEffect(() => {
    if (runDebugRef) runDebugRef.current = handleRunDebug;
    return () => { if (runDebugRef) runDebugRef.current = null; };
  }, [handleRunDebug, runDebugRef]);

  // Expose plain "Run" (without forcing debug) for keyboard menu action.
  useEffect(() => {
    if (runResultRef) runResultRef.current = handleRun;
    return () => { if (runResultRef) runResultRef.current = null; };
  }, [handleRun, runResultRef]);

  // ---- Formatting helpers ----
  const formatDT = (s) => {
    if (!s) return '-';
    try { return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return s; }
  };

  const statusColor = (status) => {
    switch (status) {
      case 'completed': return { background: '#dcfce7', color: '#166534' };
      case 'running':   return { background: '#dbeafe', color: '#1d4ed8' };
      case 'failed':    return { background: '#fee2e2', color: '#991b1b' };
      case 'pending':   return { background: '#fef3c7', color: '#92400e' };
      case 'ready':     return { background: '#e0e7ff', color: '#3730a3' };
      case 'aborted':   return { background: '#fef3c7', color: '#92400e' };
      default:          return { background: '#f3f4f6', color: '#374151' };
    }
  };

  const statusLabel = (status) => {
    const map = { completed: 'Completed', running: 'Running', failed: 'Failed', pending: 'Pending', ready: 'Ready', aborted: 'Aborted', unknown: '?' };
    return t(`status_${status}`) || map[status] || status;
  };

  // ---- API path for file manager ----
  const fileManagerApiPath = useMemo(() => {
    if (!selectedResultId) return null;
    return `/api/v1/labs/${lab.id}/results/${selectedResultId}/files`;
  }, [lab.id, selectedResultId]);

  // ---- Open file in a sub-tab (double-click or button) ----
  const handleFileOpen = useCallback((file) => {
    if (!fileManagerApiPath) return;
    const filePath = file.path;
    if (openFiles.find((f) => f.path === filePath)) {
      setActiveSubTab(`file:${filePath}`);
      return;
    }

    const isImg = isImageFile(filePath);
    const isPd = isPdfFile(filePath);
    const isTxt = file.isText || isTextFile(filePath);

    if (isTxt) {
      fetch(`${fileManagerApiPath}/content?file=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      })
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((data) => {
          setOpenFiles((prev) => [...prev, {
            path: filePath, name: file.name,
            content: data.content || '',
            language: getLanguageFromFilename(filePath),
            isImage: false, isPdf: false, isText: true,
          }]);
          setActiveSubTab(`file:${filePath}`);
        })
        .catch(() => toast.error(`Failed to load ${filePath}`));
    } else if (isImg || isPd) {
      setOpenFiles((prev) => [...prev, {
        path: filePath, name: file.name, content: '',
        language: 'plaintext', isImage: isImg, isPdf: isPd, isText: false,
      }]);
      setActiveSubTab(`file:${filePath}`);
    }
  }, [openFiles, fileManagerApiPath, toast]);

  const handleFileClose = useCallback((filePath) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    setActiveSubTab((prev) => (prev === `file:${filePath}` ? 'browser' : prev));
  }, []);

  const canRun = selectedResult && !workflowRunning && !isPending;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Top bar: selector + Run / Debug buttons + stop-on-failure + status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
        background: '#f2f8f0', border: '1px solid #e2e8f0', borderRadius: 8, flexWrap: 'wrap',
      }}>
        {/* Result picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>
            {t('selectResult') || 'Result'}:
          </label>
          <select
            value={selectedResultId}
            onChange={handleSelect}
            onFocus={loadResults}
            style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, minWidth: 320, background: 'white', fontSize: 13 }}
          >
            <option value="">— {t('selectResultPlaceholder') || 'Select a result'} —</option>
            {filteredResults.map((r) => {
              const currentUserId = user?.id != null ? String(user.id) : null;
              const isOwn = !r.run || (currentUserId && String(r.run._usr_id) === currentUserId);
              return (
                <option key={r.id} value={r.id} style={{ fontStyle: isOwn ? 'normal' : 'italic', color: isOwn ? '#111827' : '#6b7280' }}>
                  {isOwn ? '' : '👤 '}{getResultLabel(r)}
                </option>
              );
            })}
          </select>
        </div>

        {/* Run / Debug / Reset buttons */}
        {isPending || workflowRunning ? (
          <button
            onClick={handleReset}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: rbtn.reset.bg,
              color: 'white', border: 'none', borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500, fontSize: 13,
              boxShadow: shadow.normal,
              transition: 'box-shadow 0.15s, transform 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = shadow.hover; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = shadow.normal; e.currentTarget.style.transform = ''; }}
          >
            {rbtn.reset.icon} {rbtn.reset.label}
          </button>
        ) : (
          <>
            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={!canRun}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: canRun ? rbtn.run.bg : rbtn.run.disabledBg,
                color: 'white', border: 'none', borderRadius: 6,
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontWeight: 500, fontSize: 13,
                boxShadow: canRun ? shadow.normal : 'none',
                transition: 'box-shadow 0.15s, transform 0.15s',
              }}
              onMouseEnter={(e) => { if (canRun) { e.currentTarget.style.boxShadow = shadow.hover; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = canRun ? shadow.normal : 'none'; e.currentTarget.style.transform = ''; }}
              title="Run workflow (F9)"
            >
              {rbtn.run.icon} {rbtn.run.label} <span style={{ fontSize: 10, opacity: 0.6 }}>F9</span>
            </button>

            {/* Debug button */}
            <button
              onClick={handleDebug}
              disabled={!canRun}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: canRun ? rbtn.debug.bg : rbtn.debug.disabledBg,
                color: 'white', border: 'none', borderRadius: 6,
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontWeight: 500, fontSize: 13,
                boxShadow: canRun ? shadow.normal : 'none',
                transition: 'box-shadow 0.15s, transform 0.15s',
              }}
              onMouseEnter={(e) => { if (canRun) { e.currentTarget.style.boxShadow = shadow.hover; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = canRun ? shadow.normal : 'none'; e.currentTarget.style.transform = ''; }}
              title="Debug workflow"
            >
              {rbtn.debug.icon} {rbtn.debug.label}
            </button>

            {/* Load current output into selected result */}
            <button
              onClick={handleLoadCurrentOutput}
              disabled={!canRun}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: canRun ? rbtn.loadCurrentOutput.bg : rbtn.loadCurrentOutput.disabledBg,
                color: 'white', border: 'none', borderRadius: 6,
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontWeight: 500, fontSize: 13,
                boxShadow: canRun ? shadow.normal : 'none',
                transition: 'box-shadow 0.15s, transform 0.15s',
              }}
              onMouseEnter={(e) => { if (canRun) { e.currentTarget.style.boxShadow = shadow.hover; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = canRun ? shadow.normal : 'none'; e.currentTarget.style.transform = ''; }}
              title={t('loadCurrentOutputHere') || rbtn.loadCurrentOutput.label}
            >
              {rbtn.loadCurrentOutput.icon} {t('loadCurrentOutputHere') || rbtn.loadCurrentOutput.label}
            </button>
          </>
        )}

        {/* Stop on failure checkbox */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, color: '#374151', cursor: 'pointer',
          whiteSpace: 'nowrap', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={stopOnFailure}
            onChange={(e) => setStopOnFailure(e.target.checked)}
            style={{ cursor: 'pointer', accentColor: '#dc2626' }}
          />
          {t('stopOnFailure') || 'Stop on failure'}
        </label>

        {/* Status badge */}
        {selectedResult && (
          <span style={{ padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, ...statusColor(selectedResult.status) }}>
            {statusLabel(selectedResult.status)}
            {isPending && <span style={{ marginLeft: 6, animation: 'pulse 1s infinite' }}>●</span>}
          </span>
        )}

        {selectedResult?.completedAt && !isPending && (
          <span style={{ fontSize: 12, color: '#374151' }}>
            {t('lastCompleted') || 'Completed'}: {formatDT(selectedResult.completedAt)}
          </span>
        )}

        {loading && <span style={{ color: '#6b7280', fontSize: 12 }}>{t('loading')}</span>}

        {/* Remove result button — far right */}
        {selectedResult && !workflowRunning && !isPending && (
          <button
            onClick={handleRemoveResult}
            style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
              background: '#dc2626', color: 'white', border: 'none', borderRadius: 6,
              cursor: 'pointer', fontWeight: 500, fontSize: 13,
              boxShadow: shadow.normal,
              transition: 'box-shadow 0.15s, transform 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = shadow.hover; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = shadow.normal; e.currentTarget.style.transform = ''; }}
            title="Remove this debug session"
          >
            🗑 Remove debug session
          </button>
        )}
      </div>

      {/* Main content area: optional progress panel on left + file browser */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>

        {/* Workflow progress panel (vertical, on the left) */}
        {showProgress && workflowState && workflowState.steps?.length > 0 && (
          <WorkflowProgressPane
            workflowState={workflowState}
            onClose={() => setShowProgress(false)}
            preRunMessages={preRunMessages}
          />
        )}

      {/* File browser with sub-tabs for opened files */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Sub-tab bar (only if files are open) */}
        {selectedResultId && openFiles.length > 0 && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', marginBottom: -1, zIndex: 1 }}>
            <button
              onClick={() => setActiveSubTab('browser')}
              style={{
                padding: '5px 10px', border: '1px solid #012345', borderBottom: 'none',
                borderRadius: '6px 6px 0 0', fontSize: 12,
                background: activeSubTab === 'browser' ? '#fff' : '#f3f4f6',
                fontWeight: activeSubTab === 'browser' ? 600 : 400,
                cursor: 'pointer', outline: 'none',
              }}
            >
              📁 File browser
            </button>
            {openFiles.map((file) => {
              const isActive = activeSubTab === `file:${file.path}`;
              return (
                <span key={file.path} style={{ display: 'inline-flex', alignItems: 'stretch', marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0 }}>
                  <button
                    onClick={() => setActiveSubTab(`file:${file.path}`)}
                    title={file.path}
                    style={{
                      padding: '5px 10px', border: '1px solid #012345', borderBottom: 'none', borderRight: 'none',
                      borderRadius: '6px 0 0 0', fontSize: 12,
                      background: isActive ? '#fff' : '#f3f4f6', fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', outline: 'none',
                    }}
                  >
                    📄 {file.name}
                  </button>
                  <button
                    onClick={() => handleFileClose(file.path)}
                    style={{
                      padding: '4px 6px', border: '1px solid #012345', borderBottom: 'none', borderLeft: 'none',
                      borderRadius: '0 6px 0 0', background: isActive ? '#fff' : '#f3f4f6',
                      cursor: 'pointer', color: '#9ca3af', fontSize: 12, display: 'flex', alignItems: 'center', outline: 'none',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; }}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, border: openFiles.length > 0 ? '1px solid #012345' : 'none', position: 'relative' }}>
          {/* File browser */}
          <div style={{ height: '100%', display: activeSubTab === 'browser' ? 'block' : 'none', padding: openFiles.length > 0 ? 6 : 0 }}>
            {selectedResultId && fileManagerApiPath ? (
              <FileManagerEditor
                apiBasePath={fileManagerApiPath}
                showUpload
                showDelete
                readOnly={false}
                showModificationDate
                title={`Result #${selectedResultId}`}
                refreshTrigger={refreshTrigger}
                pollingEnabled={pollingEnabled && activeSubTab === 'browser'}
                onFileDoubleClick={handleFileOpen}

                csvPreviewMaxRows={appConfig?.csvPreviewMaxRows}
                previewMaxFileSize={appConfig?.previewMaxFileSize}
                onAnalyze={onAnalyze ? (fileName) => onAnalyze({ labId: lab.id, apiPath: fileManagerApiPath, fileName }) : undefined}
                labOwnerId={lab.ownerId}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                {t('selectResultToView') || 'Select a result to view files'}
              </div>
            )}
          </div>

          {/* Open file editors */}
          {openFiles.map((file) => (
            <div
              key={file.path}
              style={{
                height: '100%',
                display: activeSubTab === `file:${file.path}` ? 'flex' : 'none',
                flexDirection: 'column', padding: 6,
              }}
            >
              {file.isImage ? (
                <ZoomableImage
                  src={`${fileManagerApiPath}/download?file=${encodeURIComponent(file.path)}&inline=1&token=${localStorage.getItem('authToken')}`}
                  alt={file.name}
                />
              ) : file.isPdf ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 6, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <embed
                    src={`${fileManagerApiPath}/download?file=${encodeURIComponent(file.path)}&inline=1&token=${localStorage.getItem('authToken')}`}
                    type="application/pdf" style={{ flex: 1, width: '100%' }}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <CodeEditor
                    value={file.content}
                    language={file.language}
                    theme={editorTheme}
                    readOnly
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }`}</style>
    </div>
  );
}
