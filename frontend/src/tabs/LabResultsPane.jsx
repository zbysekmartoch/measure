/**
 * LabResultsPane — "Results" sub-tab of a lab workspace.
 *
 * Shows:
 *   1. A result selector dropdown (subfolders of lab's results/)
 *   2. "Re-run & debug" button
 *   3. FileManagerEditor rooted in the selected result subfolder
 *
 * Props:
 *   lab – lab metadata { id, name, … }
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../components/Toast';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { appConfig } from '../lib/appConfig.js';

export default function LabResultsPane({ lab }) {
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

  // ---- Re-run & debug ----
  const handleRerun = useCallback(async () => {
    if (!selectedResult) return;
    try {
      setDebugRunning(true);
      await fetchJSON(`/api/v1/labs/${lab.id}/results/${selectedResult.id}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugMode: true }),
      });
      toast.success(t('debugAnalysisStarted') || 'Analýza spuštěna v debug režimu');
      await loadResults();
      const data = await fetchJSON(`/api/v1/labs/${lab.id}/results`);
      const updated = (data.items || []).find((r) => r.id === selectedResult.id);
      if (updated) setSelectedResult(updated);
    } catch (err) {
      toast.error(`${t('errorStartingDebugAnalysis') || 'Chyba'}: ${err.message || err}`);
    } finally {
      setDebugRunning(false);
    }
  }, [selectedResult, lab.id, t, toast, loadResults]);

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
      default:          return { background: '#f3f4f6', color: '#374151' };
    }
  };

  const statusLabel = (status) => {
    const map = { completed: 'Dokončeno', running: 'Běží', failed: 'Chyba', pending: 'Čeká', unknown: '?' };
    return t(`status_${status}`) || map[status] || status;
  };

  // ---- API path for file manager ----
  const fileManagerApiPath = useMemo(() => {
    if (!selectedResultId) return null;
    return `/api/v1/labs/${lab.id}/results/${selectedResultId}/files`;
  }, [lab.id, selectedResultId]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Top bar: selector + re-run button + status */}
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

        {/* Re-run & debug */}
        <button
          onClick={handleRerun}
          disabled={!selectedResult || debugRunning || isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px',
            background: selectedResult && !debugRunning && !isPending ? '#b82b2b' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: 6,
            cursor: selectedResult && !debugRunning && !isPending ? 'pointer' : 'not-allowed',
            fontWeight: 500, fontSize: 13,
          }}
        >
          {debugRunning ? '⏳' : '↻'} {t('runAndDebug') || 'Znovu spustit a ladit'}
        </button>

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

      {/* File browser for the selected result */}
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
