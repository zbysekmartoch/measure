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
import { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile } from '../components/file-manager/fileUtils.js';
import Editor from '@monaco-editor/react';
import { appConfig } from '../lib/appConfig.js';
import { shadow, resultButtons as rbtn } from '../lib/uiConfig.js';

export default function LabResultsPane({ lab, debug, debugVisible = false, runDebugRef }) {
  const { t } = useLanguage();
  const toast = useToast();

  const [results, setResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading] = useState(false);
  const [debugRunning, setDebugRunning] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ---- Open file tabs (sub-tabs within Results) ----
  const [activeSubTab, setActiveSubTab] = useState('browser');
  const [openFiles, setOpenFiles] = useState([]);
  const [editorTheme] = useState(() => localStorage.getItem('monacoTheme') || 'vs-dark');

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
      toast.success(t('debugAnalysisStarted') || 'Debug workflow started');

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
      toast.error(`${t('errorStartingDebugAnalysis') || 'Error'}: ${err.message || err}`);
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
      toast.success('Result reset');
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
            {t('selectResult') || 'Result'}:
          </label>
          <select
            value={selectedResultId}
            onChange={handleSelect}
            onFocus={loadResults}
            style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, minWidth: 320, background: 'white', fontSize: 13 }}
          >
            <option value="">— {t('selectResultPlaceholder') || 'Select a result'} —</option>
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
          <button
            onClick={handleRunDebug}
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
          >
            {debugRunning ? rbtn.loading.icon : debugVisible ? rbtn.debug.icon : rbtn.run.icon} {debugVisible ? rbtn.debug.label : rbtn.run.label} <span style={{fontSize:10,opacity:0.6}}>F9</span>
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
            {t('lastCompleted') || 'Completed'}: {formatDT(selectedResult.completedAt)}
          </span>
        )}

        {loading && <span style={{ color: '#6b7280', fontSize: 12 }}>{t('loading')}</span>}
      </div>

      {/* File browser with sub-tabs for opened files */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
              📁 Browser
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
                onFileDoubleClick={handleFileOpen}
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
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                  <img
                    src={`${fileManagerApiPath}/download?file=${encodeURIComponent(file.path)}&token=${localStorage.getItem('authToken')}`}
                    alt={file.name}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
              ) : file.isPdf ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 6, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <embed
                    src={`${fileManagerApiPath}/download?file=${encodeURIComponent(file.path)}&token=${localStorage.getItem('authToken')}`}
                    type="application/pdf" style={{ flex: 1, width: '100%' }}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <Editor
                    height="100%"
                    language={file.language}
                    value={file.content}
                    theme={editorTheme}
                    options={{ readOnly: true, minimap: { enabled: true }, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }`}</style>
    </div>
  );
}
