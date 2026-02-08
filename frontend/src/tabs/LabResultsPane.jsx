/**
 * LabResultsPane — "Results" sub-tab of a lab workspace.
 *
 * Shows:
 *   1. A result selector dropdown (subfolders of lab's results/)
 *   2. "Run debug" button — starts workflow via debugpy
 *   3. FileManagerEditor rooted in the selected result subfolder
 *   4. Debug panel (toolbar, call stack, variables) when debugging
 *   5. Debug editor with breakpoints for script files
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
import { useDebugSession } from '../debug/useDebugSession.js';
import DebugPanel from '../debug/DebugPanel.jsx';
import DebugEditor from '../debug/DebugEditor.jsx';
import { getLanguageFromFilename } from '../components/file-manager/fileUtils.js';

export default function LabResultsPane({ lab }) {
  const { t } = useLanguage();
  const toast = useToast();

  const [results, setResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading] = useState(false);
  const [debugRunning, setDebugRunning] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [editorTheme] = useState(() => localStorage.getItem('monacoTheme') || 'vs-dark');

  // ---- Debug-editor: open a script file for breakpoint editing ----
  const [debugFile, setDebugFile] = useState(null); // { path, absPath, content, language }

  const pollIntervalRef = useRef(null);

  // ---- Debug session hook ----
  const debug = useDebugSession({ labId: lab.id });

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
        body: JSON.stringify({ debugMode: true }),
      });
      toast.success(t('debugAnalysisStarted') || 'Debug workflow spuštěn');
      setShowDebugPanel(true);

      // Give backend a moment to start the debug session, then poll
      setTimeout(async () => {
        const info = await debug.pollStatus();
        if (info?.active) {
          // Auto-attach
          await debug.attach();
        }
      }, 2000);

      await loadResults();
    } catch (err) {
      toast.error(`${t('errorStartingDebugAnalysis') || 'Chyba'}: ${err.message || err}`);
    } finally {
      setDebugRunning(false);
    }
  }, [selectedResult, lab.id, t, toast, loadResults, debug]);

  // ---- Open script file in debug editor (for breakpoints) ----
  const handleOpenScriptForDebug = useCallback(async (relPath) => {
    try {
      const res = await fetchJSON(`/api/v1/labs/${lab.id}/scripts/content?file=${encodeURIComponent(relPath)}`);
      // We need the absolute path for DAP breakpoints. Get from debug status.
      const info = await debug.pollStatus();
      // The scriptAbsolutePath from debug status gives us the lab scripts root
      // Construct abs path: labScriptsRoot + relPath
      let absPath = relPath;
      if (info?.scriptAbsolutePath) {
        // The abs path is for the running script; derive root
        const scriptDir = info.scriptAbsolutePath.substring(0, info.scriptAbsolutePath.lastIndexOf('/'));
        absPath = scriptDir + '/' + relPath;
      }

      setDebugFile({
        path: relPath,
        absPath,
        content: res.content || '',
        language: getLanguageFromFilename(relPath),
        name: relPath.split('/').pop(),
      });
    } catch (err) {
      toast.error(`Failed to load ${relPath}: ${err.message}`);
    }
  }, [lab.id, debug, toast]);

  // ---- When debug session stops, open the stopped file ----
  useEffect(() => {
    if (debug.stoppedLocation?.file) {
      // Try to load the file content for display
      const absFile = debug.stoppedLocation.file;
      // We need to figure out the relative path within scripts
      // The absFile is an absolute path like /path/to/labs/X/scripts/some/script.py
      const scriptsMarker = `/labs/${lab.id}/scripts/`;
      const idx = absFile.indexOf(scriptsMarker);
      if (idx !== -1) {
        const relPath = absFile.substring(idx + scriptsMarker.length);
        // Load the file if not already loaded or different
        if (!debugFile || debugFile.path !== relPath) {
          fetchJSON(`/api/v1/labs/${lab.id}/scripts/content?file=${encodeURIComponent(relPath)}`)
            .then(res => {
              setDebugFile({
                path: relPath,
                absPath: absFile,
                content: res.content || '',
                language: getLanguageFromFilename(relPath),
                name: relPath.split('/').pop(),
              });
            })
            .catch(() => {});
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debug.stoppedLocation, lab.id]);

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

  // ---- Breakpoints for the currently open debug file ----
  const currentBreakpoints = debugFile ? debug.getBreakpoints(debugFile.absPath) : new Set();
  const currentStoppedLine = (debug.stoppedLocation && debugFile && debug.stoppedLocation.file === debugFile.absPath)
    ? debug.stoppedLocation.line
    : null;

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

        {/* Run Debug */}
        <button
          onClick={handleRunDebug}
          disabled={!selectedResult || debugRunning || isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            background: selectedResult && !debugRunning && !isPending ? '#b82b2b' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: 6,
            cursor: selectedResult && !debugRunning && !isPending ? 'pointer' : 'not-allowed',
            fontWeight: 500, fontSize: 13,
          }}
        >
          {debugRunning ? '⏳' : '🐛'} {t('runDebug') || 'Spustit debug'}
        </button>

        {/* Toggle debug panel */}
        <button
          onClick={() => setShowDebugPanel(p => !p)}
          style={{
            padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6,
            background: showDebugPanel ? '#1e1e1e' : '#f3f4f6',
            color: showDebugPanel ? '#fff' : '#374151',
            cursor: 'pointer', fontSize: 13, fontWeight: 500,
          }}
        >
          🐛 {showDebugPanel ? 'Skrýt debugger' : 'Zobrazit debugger'}
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

      {/* Main content area: file browser (+ debug editor) | debug panel */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>
        {/* Left: file browser + debug editor */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Debug editor (when a file is open for breakpoints) */}
          {debugFile && showDebugPanel && (
            <div style={{ flex: '0 0 45%', minHeight: 150, display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 10px', background: '#252526', color: '#ccc', fontSize: 12,
              }}>
                <span>
                  🐛 {debugFile.name}
                  {currentStoppedLine && <span style={{ color: '#ffcc00', marginLeft: 8 }}>⏸ line {currentStoppedLine}</span>}
                </span>
                <button
                  onClick={() => setDebugFile(null)}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}
                >×</button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <DebugEditor
                  file={debugFile}
                  editorTheme={editorTheme}
                  breakpoints={currentBreakpoints}
                  stoppedLine={currentStoppedLine}
                  readOnly={true}
                  onToggleBreakpoint={(filePath, line) => {
                    // Use absolute path for DAP
                    debug.toggleBreakpoint(debugFile.absPath, line);
                  }}
                />
              </div>
            </div>
          )}

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
        </div>

        {/* Right: debug panel */}
        {showDebugPanel && (
          <div style={{ width: 360, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <DebugPanel
              status={debug.status}
              debugInfo={debug.debugInfo}
              callStack={debug.callStack}
              variables={debug.variables}
              selectedFrameId={debug.selectedFrameId}
              stoppedLocation={debug.stoppedLocation}
              output={debug.output}
              error={debug.error}
              onAttach={debug.attach}
              onDetach={debug.detach}
              onContinue={debug.doContinue}
              onNext={debug.doNext}
              onStepIn={debug.doStepIn}
              onStepOut={debug.doStepOut}
              onSelectFrame={debug.selectFrame}
              onExpandVariable={debug.expandVariable}
            />

            {/* Quick: open script for breakpoints */}
            {selectedResult?.currentStepName && (
              <button
                onClick={() => handleOpenScriptForDebug(selectedResult.currentStepName)}
                style={{
                  padding: '6px 10px', background: '#252526', color: '#569cd6',
                  border: '1px solid #333', borderRadius: 4, cursor: 'pointer',
                  fontSize: 11, fontFamily: 'monospace',
                }}
              >
                📄 Open {selectedResult.currentStepName} for breakpoints
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }`}</style>
    </div>
  );
}
