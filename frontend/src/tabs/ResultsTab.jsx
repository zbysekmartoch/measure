/**
 * Results Tab Component
 * Displays analysis results in a dual-panel layout.
 * Left panel shows list of results, right panel shows details of selected result.
 * Supports result deletion, file downloads, status display, and live log streaming.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';
import { defaultColDef, commonGridProps, getGridContainerStyle } from '../lib/gridConfig.js';
import { appConfig } from '../lib/appConfig.js';
import { useToast } from '../components/Toast';

/**
 * LogViewer Component
 * Displays log with error highlighting and auto-scroll for pending results
 */
function LogViewer({ log, status, isPending }) {
  const logRef = useRef(null);

  // Auto-scroll to bottom when log updates and status is pending
  useEffect(() => {
    if (isPending && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, isPending]);

  // Highlight "error" occurrences with red background
  const renderLogWithHighlights = (text) => {
    if (!text) return null;
    
    const parts = text.split(/(error)/gi);
    return parts.map((part, index) => {
      if (part.toLowerCase() === 'error') {
        return (
          <span key={index} style={{ backgroundColor: '#dc2626', padding: '0 2px' }}>
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const isFailed = status === 'failed';

  return (
    <pre
      ref={logRef}
      style={{
        margin: 0,
        padding: 12,
        background: '#000',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: 13,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        border: isFailed ? '2px solid #dc2626' : '1px solid #374151',
        borderRadius: 6,
        height: '100%',
        overflow: 'auto',
        animation: isPending ? 'pulse 2s ease-in-out infinite' : 'none',
        boxSizing: 'border-box',
      }}
    >
      {renderLogWithHighlights(log) || <span style={{ color: '#6b7280' }}>No log available</span>}
    </pre>
  );
}

export default function ResultsTab() {
  const { t } = useLanguage();
  const toast = useToast();

  // Left grid: results
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(null);
  const [log, setLog] = useState('');
  const leftRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Check if current result is pending (needs polling)
  const isPending = active?.status === 'pending' || active?.status === 'running';

  // Load results list
  const loadResults = async () => {
    try {
      const d = await fetchJSON('/api/v1/results');
      console.debug('LIST /results ->', d);
      setRows(d.items || []);
    } catch {
      setRows([]);
    }
  };

  // Fetch log for a result
  // Endpoint: GET /api/v1/results/:id/log
  // Returns: plain text log content
  const fetchLog = useCallback(async (resultId) => {
    try {
      const response = await fetch(`/api/v1/results/${resultId}/log`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      if (response.ok) {
        const text = await response.text();
        setLog(text);
      }
    } catch (error) {
      console.error('Error fetching log:', error);
    }
  }, []);

  // Fetch result detail (status update)
  const fetchResultDetail = useCallback(async (resultId) => {
    try {
      const detail = await fetchJSON(`/api/v1/results/${resultId}`);
      setActive(prev => {
        // Only update if this is still the active result
        if (prev?.id === resultId) {
          return detail;
        }
        return prev;
      });
      // Also update in the list
      setRows(prev => prev.map(row => row.id === resultId ? { ...row, status: detail.status } : row));
    } catch (error) {
      console.error('Error fetching result detail:', error);
    }
  }, []);

  // Polling effect for pending results
  useEffect(() => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Start polling if result is pending and shown in detail
    if (active?.id && isPending) {
      // Initial fetch
      fetchLog(active.id);
      
      // Set up polling interval
      pollIntervalRef.current = setInterval(() => {
        fetchLog(active.id);
        fetchResultDetail(active.id);
      }, appConfig.RESULT_LOG_POLL_INTERVAL_MS);
    }

    // Cleanup on unmount or when active changes
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [active?.id, isPending, fetchLog, fetchResultDetail]);

  useEffect(() => {
    loadResults();
  }, []);

  // Delete selected results
  const handleDelete = async () => {
    const selectedNodes = leftRef.current?.api?.getSelectedNodes();
    if (!selectedNodes || selectedNodes.length === 0) {
      toast.warning(t('noResultsSelected') || 'No results selected');
      return;
    }

    const selectedIds = selectedNodes.map(node => node.data.id);
    const confirmMessage = selectedIds.length === 1
      ? (t('confirmDeleteResult') || 'Really delete result?')
      : (t('confirmDeleteResults') || `Really delete ${selectedIds.length} results?`);

    if (!confirm(confirmMessage)) return;

    try {
      // Delete all selected results
      await Promise.all(
        selectedIds.map(id =>
          fetch(`/api/v1/results/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
          })
        )
      );

      // If active result was deleted, clear detail view
      if (active && selectedIds.includes(active.id)) {
        setActive(null);
      }

      // Reload results list
      await loadResults();
      toast.success(t('resultsDeleted') || 'Results deleted');
    } catch (error) {
      console.error('Error deleting results:', error);
      toast.error(t('errorDeletingResults') || 'Error deleting results');
    }
  };

  // Row click -> fetch detail and log
  const onRowClicked = async (e) => {
    const id = e.data.id;
    try {
      const detail = await fetchJSON(`/api/v1/results/${id}`);
      console.debug('DETAIL /results/:id ->', detail);
      setActive(detail);
      setLog(''); // Reset log, will be fetched by polling effect or immediately
      // Fetch log for non-pending results immediately
      if (detail.status !== 'pending' && detail.status !== 'running') {
        fetchLog(id);
      }
    } catch {
      setActive(null);
      setLog('');
    }
  };
  
  // Redraw rows when active result changes to update row styling
  useEffect(() => {
    if (leftRef.current?.api) {
      leftRef.current.api.redrawRows();
    }
  }, [active]);

  // Left grid columns
  const cols = useMemo(() => ([
    { headerName: t('id'), field: 'id', width: 90 },
    { headerName: t('analysisName'), field: 'analysisName', flex: 1, minWidth: 220 },
    { headerName: t('status'), field: 'status', width: 120 },
    { headerName: t('created'), field: 'created_at', width: 170 },
  ]), [t]);

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

  return (
    <div style={{ height: 'calc(100% - 20px)' , display: 'flex', gap: 12 }}>
      {/* LEFT: results list */}
      <section
        style={{
          width: 600, minWidth: 500, height: '100%',
          border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, 
          overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column'
        }}
      >
        {/* Action buttons */}
        <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
          <button
            onClick={loadResults}
            title={t('refresh') || 'Obnovit'}
            style={{
              padding: '6px 12px',
              background: '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500
            }}
          >
            ↻ {t('refresh') || 'Obnovit'}
          </button>
          <button
            className="btn btn-delete"
            onClick={handleDelete}
            title={t('deleteSelectedResults') || 'Delete selected results'}
          >
            🗑 {t('deleteSelected') || 'Delete selected'}
          </button>
        </div>

        <div className="ag-theme-quartz" style={getGridContainerStyle({ flex: 1 })}>
          <AgGridReact
            {...commonGridProps}
            ref={leftRef}
            rowData={rows}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            rowSelection={{ mode: 'multiRow' }}
            onRowClicked={onRowClicked}
            getRowClass={(params) => params.data?.id === active?.id ? 'ag-row-active' : ''}
            tooltipShowDelay={300}
          />
        </div>
      </section>

      {/* RIGHT: result detail */}
      <section
        style={{
          flex: 1, minWidth: 0, minHeight: 0, height: '100%',
          border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, 
          background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column'
        }}
      >
        {!active && <div style={{ color: '#6b7280' }}>{t('selectResult')}</div>}
        
        {active && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 18, flexShrink: 0 }}>
              {t('analysisResultTitle')}: {active.analysisName}
            </h2>
            
            {/* Two-column layout */}
            <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Left column: Status, downloads, info */}
              <div style={{ width: 350, minWidth: 280, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                    {t('status')}
                  </label>
                  <div style={{ 
                    padding: '4px 12px',
                    ...getStatusColor(active.status),
                    borderRadius: 0,
                    display: 'inline-block'
                  }}>
                    {getStatusDisplay(active.status)}
                    {isPending && (
                      <span style={{ marginLeft: 6, animation: 'pulse 1s infinite' }}>●</span>
                    )}
                  </div>
                </div>

                {/* Progress info for running analyses */}
                {active.progress && isPending && (
                  <div style={{ 
                    padding: '12px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 6,
                    fontSize: 13
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, color: '#1d4ed8' }}>
                        {t('step') || 'Krok'} {active.progress.currentStep}/{active.progress.totalSteps}
                      </span>
                      <span style={{ color: '#374151', fontFamily: 'monospace', fontSize: 12 }}>
                        {active.progress.currentStepName}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ 
                      height: 6, 
                      background: '#dbeafe', 
                      borderRadius: 3, 
                      overflow: 'hidden',
                      marginBottom: 8
                    }}>
                      <div style={{ 
                        height: '100%', 
                        width: `${(active.progress.currentStep / active.progress.totalSteps) * 100}%`,
                        background: '#3b82f6',
                        borderRadius: 3,
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 12 }}>
                      <span>⏱ {t('stepTime') || 'Krok'}: {formatElapsedTime(active.progress.stepElapsedMs)}</span>
                      <span>⏱ {t('totalTime') || 'Celkem'}: {formatElapsedTime(active.progress.analysisElapsedMs)}</span>
                    </div>
                  </div>
                )}

                {/* Download link */}
                <div>
                  <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                    {t('downloadResult')}
                  </label>
                  <a 
                    href={`/api/v1/results-public/${active.id}/files/result.zip`}
                    download
                    style={{
                      display: 'inline-block',
                      padding: '8px 16px',
                      background: '#3b82f6',
                      color: '#fff',
                      textDecoration: 'none',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  >
                    📦 {t('downloadZip')}
                  </a>
                </div>

                {/* List of individual files to download */}
                {active.files && active.files.length > 0 && (
                  <div>
                    <label style={{ color: '#4b5563', display: 'block', marginBottom: 8 }}>
                      {t('resultFiles') || 'Result files'}
                    </label>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: 12,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6
                    }}>
                      {active.files.map((file, index) => (
                        <a
                          key={index}
                          href={file.downloadUrl || `/api/v1/results/${active.id}/files/${encodeURIComponent(file.name)}`}
                          download={file.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            background: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            textDecoration: 'none',
                            color: '#374151',
                            transition: 'all 0.2s'
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.background = '#f1f5f9';
                            e.currentTarget.style.borderColor = '#3b82f6';
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.background = '#fff';
                            e.currentTarget.style.borderColor = '#e2e8f0';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>
                              {file.extension === '.docx' ? '📄' : 
                               file.extension === '.pdf' ? '📑' : 
                               file.extension === '.xlsx' ? '📊' : 
                               file.extension === '.png' || file.extension === '.jpg' ? '🖼️' : 
                               '📎'}
                            </span>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>
                                {file.name}
                              </div>
                              <div style={{ fontSize: 12, color: '#6b7280' }}>
                                {file.size ? `${(file.size / 1024).toFixed(1)} KB` : ''} 
                                {file.mtime ? ` • ${new Date(file.mtime).toLocaleString()}` : ''}
                              </div>
                            </div>
                          </div>
                          <span style={{ color: '#3b82f6', fontSize: 20 }}>⬇</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {active.output && (
                  <div>
                    <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                      {t('output')}
                    </label>
                    <pre style={{ 
                      margin: 0,
                      padding: 12,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      whiteSpace: 'pre-wrap'
                    }}>
                      {active.output}
                    </pre>
                  </div>
                )}

                {active.report && (
                  <div>
                    <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                      {t('report')}
                    </label>
                    <div style={{
                      padding: 12,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6
                    }}>
                      {active.report}
                    </div>
                  </div>
                )}

                {/* Additional result information */}
                {active.created_at && (
                  <div>
                    <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                      {t('created')}
                    </label>
                    <div style={{ color: '#6b7280' }}>
                      {new Date(active.created_at).toLocaleString()}
                    </div>
                  </div>
                )}

                {active.completed_at && (
                  <div>
                    <label style={{ color: '#4b5563', display: 'block', marginBottom: 4 }}>
                      {t('completed')}
                    </label>
                    <div style={{ color: '#6b7280' }}>
                      {new Date(active.completed_at).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Log viewer */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ color: '#4b5563' }}>
                    {t('log') || 'Log'}
                    {isPending && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>
                        ({t('liveUpdating') || 'live updating...'})
                      </span>
                    )}
                  </label>
                  <button
                    className="btn"
                    onClick={() => {
                      const newWindow = window.open('', '_blank', 'width=900,height=700');
                      if (newWindow) {
                        newWindow.document.write(`
                          <!DOCTYPE html>
                          <html>
                          <head>
                            <title>Log - ${active.analysisName}</title>
                            <style>
                              body { margin: 0; padding: 16px; background: #000; color: #fff; font-family: monospace; font-size: 13px; }
                              pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
                              .error { background-color: #dc2626; padding: 0 2px; }
                            </style>
                          </head>
                          <body>
                            <pre>${log ? log.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/(error)/gi, '<span class="error">$1</span>') : 'No log available'}</pre>
                          </body>
                          </html>
                        `);
                        newWindow.document.close();
                      }
                    }}
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    title={t('openInNewWindow') || 'Open in new window'}
                  >
                    🗗 {t('newWindow') || 'New window'}
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <LogViewer log={log} status={active.status} isPending={isPending} />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}