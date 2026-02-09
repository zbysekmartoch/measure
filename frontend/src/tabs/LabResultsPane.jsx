/**
 * LabResultsPane — "Results" sub-tab of a lab workspace.
 *
 * Shows:
 *   1. A result selector dropdown (subfolders of lab's results/)
 *   2. "Run debug" button — starts workflow via debugpy
 *   3. FileManagerEditor rooted in the selected result subfolder
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
import { useToast } from '../components/Toast';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { appConfig } from '../lib/appConfig.js';

export default function LabResultsPane({ lab, debug, debugVisible = false, runDebugRef }) {
  const { t } = useLanguage();
  const toast = useToast();

  const [results, setResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading] = useState(false);
  const [debugRunning, setDebugRunning] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const pollIntervalRef = useRef(null);

  // ---- Load result list ----
  const loadResults = useCallback(async () => {
    try {
      const data = await fetchJSON(`/api/v1/labs/${lab.id}/results`);
      setResults(data.items || []);
    } catch {
      setResults([]);
    }
  }, [lab.id]);

  useEffect(() => { loadResults(); }, [loadResults]);

  // ---- Select result ----
  const handleSelect = useCallback((e) => {
    const id = e.target.value;
    setSelectedResultId(id);
    if (!id) { setSelectedResult(null); return; }
    const item = results.find((r) => r.id === id);
    setSelectedResult(item || null);
    setRefreshTrigger((p) => p + 1);
  }, [results]);

  // ---- Polling for running results ----
  const isPending = selectedResult?.status === 'pending' || selectedResult?.status === 'running';

  useEffect(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
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
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch { /* ignore */ }
    }, appConfig.RESULT_LOG_POLL_INTERVAL_MS || 3000);

    return () => { if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } };
  }, [selectedResultId, isPending, lab.id]);

  // ---- Run debug workflow ----
  const handleRunDebug = useCallback(async () => {
    if (!selectedResult) return;
    try {
      setDebugRunning(true);
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugVisible }),
      });
      toast.success(t('debugAnalysisStarted') || 'Debug workflow spuštěn');

      // Refresh results list immediately
      loadResults();

      // Poll backend until debug session is ready, then auto-attach
      if (debug && debugVisible) {
        const maxAttempts = 20;
        const interval = 500; // ms
        let attached = false;
        for (let attempt = 0; attempt < maxAttempts && !attached; attempt++) {
          await new Promise(r => setTimeout(r, interval));
          try {
            const info = await debug.pollStatus();
            if (info?.active && info?.status === 'waiting_for_client') {
              await debug.attach();
              attached = true;
            }
          } catch { /* retry */ }
        }
        if (!attached) {
          console.warn('[LabResultsPane] Could not auto-attach debugger after', maxAttempts, 'attempts');
        }
      }
    } catch (err) {
      toast.error(`${t('errorStartingDebugAnalysis') || 'Chyba'}: ${err.message || err}`);
    } finally {
      setDebugRunning(false);
    }
  }, [selectedResult, lab.id, t, toast, loadResults, debug, debugVisible]);

  // ---- Reset (abort) a running/pending result ----
  const handleReset = useCallback(async () => {
    if (!selectedResult) return;
    try {
      // Stop debug session if active
      if (debug) {
        try { await debug.detach(); } catch { /* ignore */ }
      }
      // Update progress.json to aborted
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      toast.success('Výsledek resetován');
      loadResults();
    } catch (err) {
      toast.error(`Reset failed: ${err.message || err}`);
    }
  }, [selectedResult, lab.id, toast, loadResults, debug]);

  // Expose handleRunDebug for F9 keyboard shortcut (via ref from parent)
  useEffect(() => {
    if (runDebugRef) runDebugRef.current = handleRunDebug;
    return () => { if (runDebugRef) runDebugRef.current = null; };
  }, [handleRunDebug, runDebugRef]);

  // ---- Formatting helpers ----
  const formatDT = (s) => {
    if (!s) return '-';
    try { return new Date(s).toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
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
    const map = { completed: 'Dokončeno', running: 'Běží', failed: 'Chyba', pending: 'Čeká', ready: 'Připraveno', aborted: 'Přerušeno', unknown: '?' };
    return t(`status_${status}`) || map[status] || status;
  };

  // ---- API path for file manager ----
  const fileManagerApiPath = useMemo(() => {
    if (!selectedResultId) return null;
    return `/api/v1/labs/${lab.id}/results/${selectedResultId}/files`;
  }, [lab.id, selectedResultId]);

  const canRun = selectedResult && !debugRunning && !isPending;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Top bar: selector + run debug + status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
        background: '#f2f8f0', border: '1px solid #e2e8f0', borderRadius: 8, flexWrap: 'wrap',
      }}>
        {/* Result picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>
            {t('selectResult') || 'Výsledek'}:
          </label>
          <select
            value={selectedResultId}
            onChange={handleSelect}
            onFocus={loadResults}
            style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, minWidth: 320, background: 'white', fontSize: 13 }}
          >
            <option value="">— {t('selectResultPlaceholder') || 'Vyberte výsledek'} —</option>
            {results.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} ({statusLabel(r.status)}) — {formatDT(r.createdAt)}
              </option>
            ))}
          </select>
        </div>

        {/* Run Debug / Reset */}
        {isPending ? (
          <button
            onClick={handleReset}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: '#92400e',
              color: 'white', border: 'none', borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500, fontSize: 13,
            }}
          >
            ⏹ Reset
          </button>
        ) : (
          <button
            onClick={handleRunDebug}
            disabled={!canRun}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: canRun ? '#b82b2b' : '#9ca3af',
              color: 'white', border: 'none', borderRadius: 6,
              cursor: canRun ? 'pointer' : 'not-allowed',
              fontWeight: 500, fontSize: 13,
            }}
          >
            {debugRunning ? '⏳' : debugVisible ? '🛠' : '▶'} {debugVisible ? 'Debug' : 'Run'} <span style={{fontSize:10,opacity:0.6}}>F9</span>
          </button>
        )}

        {/* Status badge */}
        {selectedResult && (
          <span style={{ padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500, ...statusColor(selectedResult.status) }}>
            {statusLabel(selectedResult.status)}
            {isPending && <span style={{ marginLeft: 6, animation: 'pulse 1s infinite' }}>●</span>}
          </span>
        )}

        {selectedResult?.completedAt && !isPending && (
          <span style={{ fontSize: 12, color: '#374151' }}>
            {t('lastCompleted') || 'Dokončeno'}: {formatDT(selectedResult.completedAt)}
          </span>
        )}

        {loading && <span style={{ color: '#6b7280', fontSize: 12 }}>{t('loading')}</span>}
      </div>

      {/* File browser */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {selectedResultId && fileManagerApiPath ? (
          <FileManagerEditor
            apiBasePath={fileManagerApiPath}
            showUpload
            showDelete
            readOnly={false}
            showModificationDate
            title={`Výsledek #${selectedResultId}`}
            refreshTrigger={refreshTrigger}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            {t('selectResultToView') || 'Vyberte výsledek pro zobrazení souborů'}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }`}</style>
    </div>
  );
}
