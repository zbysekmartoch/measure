/**
 * Debug Tab Component
 * For debugging analyses - allows modifying result files and re-running analysis in debug mode
 * 
 * Features:
 * - Select a result from dropdown
 * - View/edit files in result folder
 * - Run analysis in debug mode (re-run with existing resultId)
 * - Status indicator and last completion time
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { appConfig } from '../lib/appConfig.js';
import { useToast } from '../components/Toast';

export default function DebugTab() {
  const { t } = useLanguage();
  const toast = useToast();

  // Results list for dropdown
  const [results, setResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [debugRunning, setDebugRunning] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [splitPosition, setSplitPosition] = useState(50); // Splitter position in %
  
  // Polling for status updates
  const pollIntervalRef = useRef(null);
  const containerRef = useRef(null);

  // Splitter drag handler
  const handleSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    const container = containerRef.current?.parentElement;
    if (!container) return;

    const startX = e.clientX;
    const startWidth = splitPosition;
    const containerRect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerRect.width) * 100;
      const newPosition = Math.min(80, Math.max(20, startWidth + deltaPercent));
      setSplitPosition(newPosition);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [splitPosition]);

  // Load results list
  const loadResults = useCallback(async () => {
    try {
      const d = await fetchJSON('/api/v1/results');
      setResults(d.items || []);
    } catch (error) {
      console.error('Error loading results:', error);
      setResults([]);
    }
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Load result detail when selection changes
  const loadResultDetail = useCallback(async (resultId) => {
    if (!resultId) {
      setSelectedResult(null);
      return;
    }

    try {
      setLoading(true);
      const detail = await fetchJSON(`/api/v1/results/${resultId}`);
      setSelectedResult(detail);
      setRefreshTrigger(prev => prev + 1); // Trigger file manager refresh
    } catch (error) {
      console.error('Error loading result detail:', error);
      setSelectedResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle result selection
  const handleResultSelect = useCallback((e) => {
    const resultId = e.target.value;
    setSelectedResultId(resultId);
    loadResultDetail(resultId);
  }, [loadResultDetail]);

  // Check if result is pending (needs polling)
  const isPending = selectedResult?.status === 'pending' || selectedResult?.status === 'running';

  // Polling effect for pending results
  useEffect(() => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Start polling if result is pending
    if (selectedResultId && isPending) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const detail = await fetchJSON(`/api/v1/results/${selectedResultId}`);
          setSelectedResult(detail);
          
          // If no longer pending, refresh file list and stop polling
          if (detail.status !== 'pending' && detail.status !== 'running') {
            setRefreshTrigger(prev => prev + 1);
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        } catch (error) {
          console.error('Error polling result status:', error);
        }
      }, appConfig.RESULT_LOG_POLL_INTERVAL_MS || 3000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [selectedResultId, isPending]);

  // Run analysis in debug mode
  const handleRunDebug = useCallback(async () => {
    if (!selectedResult?.id) return;
/*
    const confirmMsg = t('confirmRunDebug') || `Spustit analýzu "${selectedResult.analysisName}" v debug režimu?`;
    if (!confirm(confirmMsg)) return;
*/
    try {
      setDebugRunning(true);
      
      // POST to debug endpoint with resultId
      await fetchJSON(`/api/v1/results/${selectedResult.id}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultId: selectedResult.id,
          debugMode: true
        })
      });
      
      toast.success(t('debugAnalysisStarted') || 'Analýza byla spuštěna v debug režimu.');
      
      // Refresh result detail to get new status
      await loadResultDetail(selectedResult.id);
      
    } catch (error) {
      console.error('Error starting debug analysis:', error);
      toast.error((t('errorStartingDebugAnalysis') || 'Chyba při spuštění debug analýzy') + ': ' + (error.message || error));
    } finally {
      setDebugRunning(false);
    }
  }, [selectedResult, t, loadResultDetail, toast]);

  // Function for localized status display
  const getStatusDisplay = (status) => {
    const statusMap = {
      'completed': t('statusCompleted'),
      'running': t('statusRunning'),
      'failed': t('statusFailed'),
      'pending': t('statusPending'),
    };
    return statusMap[status] || status;
  };

  // Function for status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return { background: '#dcfce7', color: '#166534' };
      case 'running':
        return { background: '#dbeafe', color: '#1d4ed8' };
      case 'failed':
        return { background: '#fee2e2', color: '#991b1b' };
      case 'pending':
        return { background: '#fef3c7', color: '#92400e' };
      default:
        return { background: '#f3f4f6', color: '#374151' };
    }
  };

  // Format datetime
  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  // Format elapsed time (ms to human readable)
  const formatElapsedTime = (ms) => {
    if (!ms && ms !== 0) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // API path for file manager - result files
  const fileManagerApiPath = useMemo(() => {
    if (!selectedResultId) return null;
    return `/api/v1/results/${selectedResultId}/files`;
  }, [selectedResultId]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Top bar: Result selector, Run Debug button, Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 16px',
        background: '#f2f8f0',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        flexWrap: 'wrap'
      }}>
        {/* Result selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontWeight: 500, color: '#374151' }}>
            {t('selectResult') || 'Vyberte výsledek'}:
          </label>
          <select
            value={selectedResultId}
            onChange={handleResultSelect}
            onFocus={loadResults}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              minWidth: 350,
              background: 'white',
              fontSize: 14
            }}
          >
            <option value="">{t('selectResultPlaceholder') || '— Vyberte výsledek —'}</option>
            {results.map(result => (
              <option key={result.id} value={result.id}>
                #{result.id} - {result.analysisName} ({getStatusDisplay(result.status)}) - {formatDateTime(result.created_at)}
              </option>
            ))}
          </select>
        </div>

        {/* Run Debug button */}
        <button
          className="btn btn-primary"
          onClick={handleRunDebug}
          disabled={!selectedResult || debugRunning || isPending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: selectedResult && !debugRunning && !isPending ? '#b82b2b' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: selectedResult && !debugRunning && !isPending ? 'pointer' : 'not-allowed',
            fontWeight: 500
          }}
        >
          {debugRunning ? '⏳' : '↻'} {t('runAndDebug') || 'Run and Debug'}
        </button>

        {/* Status indicator */}
        {selectedResult && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#111111', fontSize: 13 }}>{t('status')}:</span>
              <span style={{
                padding: '4px 12px',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                ...getStatusColor(selectedResult.status)
              }}>
                {getStatusDisplay(selectedResult.status)}
                {isPending && (
                  <span style={{ marginLeft: 6, animation: 'pulse 1s infinite' }}>●</span>
                )}
              </span>
            </div>

            {/* Progress info for running analyses */}
            {selectedResult.progress && isPending && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                padding: '6px 12px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 6,
                fontSize: 12
              }}>
                <span style={{ fontWeight: 600, color: '#1d4ed8' }}>
                  {t('step') || 'Krok'} {selectedResult.progress.currentStep}/{selectedResult.progress.totalSteps}
                </span>
                <span style={{ color: '#374151' }}>
                  {selectedResult.progress.currentStepName}
                </span>
                <span style={{ color: '#6b7280' }}>
                  ⏱ {t('stepTime') || 'Krok'}: {formatElapsedTime(selectedResult.progress.stepElapsedMs)}
                </span>
                <span style={{ color: '#6b7280' }}>
                  ⏱ {t('totalTime') || 'Celkem'}: {formatElapsedTime(selectedResult.progress.analysisElapsedMs)}
                </span>
              </div>
            )}

            {!isPending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#000000', fontSize: 13 }}>
                  {t('lastCompleted') || 'Poslední dokončení'}:
                </span>
                <span style={{ fontSize: 13, color: '#000000' }}>
                  {formatDateTime(selectedResult.completed_at)}
                </span>
              </div>
            )}
          </div>
        )}

        {loading && (
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            {t('loading')}
          </span>
        )}
      </div>

      {/* File Managers with Editor - Result files and Scripts side by side with splitter */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* Result files folder - LEFT  */}
        <div style={{ 
          width: `calc(${splitPosition}% - 6px)`,
          minWidth: 200,
          display: 'flex',
          flexDirection: 'column',
          border: selectedResultId ? '2px solid #333a44' : '1px solid #e5e7eb',
          borderRadius: 6,
          overflow: 'hidden'
        }}>
          <div style={{
            background: selectedResultId 
              ? 'linear-gradient(135deg, #2400f1 0%, #2400ee 100%)' 
              : '#f3f4f6',
            color: selectedResultId ? 'white' : '#6b7280',
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            📁 {t('resultFiles') || 'Soubory výsledku'}{selectedResult ? `: ${selectedResult.analysisName}` : ''}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {selectedResultId && fileManagerApiPath ? (
              <FileManagerEditor
                apiBasePath={fileManagerApiPath}
                showUpload={true}
                showDelete={true}
                readOnly={false}
                showModificationDate={true}
                title=""
                refreshTrigger={refreshTrigger}
              />
            ) : (
              <div style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: 14,
                background: '#fff'
              }}>
                {t('selectResultToDebug') || 'Vyberte výsledek pro zobrazení souborů a ladění'}
              </div>
            )}
          </div>
        </div>

        {/* Splitter */}
        <div
          style={{
            width: 12,
            cursor: 'col-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            flexShrink: 0
          }}
          onMouseDown={handleSplitterMouseDown}
        >
          <div style={{
            width: 4,
            height: 40,
            background: '#d1d5db',
            borderRadius: 2,
            transition: 'background 0.15s'
          }} />
        </div>

        {/* Scripts folder - RIGHT (dark gray) */}
        <div style={{ 
          flex: 1,
          minWidth: 200,
          display: 'flex',
          flexDirection: 'column',
          border: '2px solid #333a44',
          borderRadius: 6,
          overflow: 'hidden'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #7a2b2b 0%, #8a0505 100%)',
            color: 'white',
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            📜 {t('scripts') || 'Skripty'}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <FileManagerEditor
              apiBasePath="/api/v1/scripts"
              showUpload={true}
              showDelete={true}
              readOnly={false}
              showModificationDate={true}
              title=""
              refreshTrigger={0}
            />
          </div>
        </div>
      </div>

      {/* CSS for pulse animation */}
      <style>{`
@keyframes pulse {
  0%, 100% {   
    box-shadow: inset #ff000000 0 0 8px 4px;
  }
  50% {
    box-shadow: inset #ff0000 0 0 8px 4px;
  }
}
      `}</style>
    </div>
  );
}
