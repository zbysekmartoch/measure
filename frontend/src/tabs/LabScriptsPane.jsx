/**
 * LabScriptsPane — "Scripts" sub-tab of a lab workspace.
 *
 * Contains:
 *   - A sub-tab bar: "📁 File browser" + one tab per opened file
 *   - Content area: FileManagerEditor (browser) or inline file editors
 *   - Breakpoint support in Python files (via DebugEditor) when debug is provided
 *
 * Props:
 *   lab   – lab metadata { id, name, … }
 *   debug – debug session object from useDebugSession() (optional, from LabWorkspaceTab)
 */
import React, { useCallback, useEffect, useState, useRef } from 'react';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import SqlEditorTab from './SqlEditorTab.jsx';
import CodeEditor from '../components/CodeEditor.jsx';
import DebugEditor from '../debug/DebugEditor.jsx';
import { getLanguageFromFilename, isImageFile, isOfficeEditableFile, isPdfFile, isTextFile, openOfficeEditor } from '../components/file-manager/fileUtils.js';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog.jsx';
import ZoomableImage from '../components/ZoomableImage.jsx';
import { fileLocking as lockCfg } from '../lib/uiConfig.js';
import { setDirtyCount, removeDirtyCount } from '../lib/dirtyRegistry.js';
import { fetchJSON } from '../lib/fetchJSON.js';
import WorkflowProgressPane from '../components/WorkflowProgressPane.jsx';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents.js';

function normalizeBackupIgnoredFolders(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('\0')) continue;
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) continue;
    const safePath = parts.join('/');
    if (seen.has(safePath)) continue;
    seen.add(safePath);
    out.push(safePath);
  }

  return out;
}

function toLabBackupFolderPath(folderPath) {
  const normalized = String(folderPath || '').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  return `scripts/${normalized}`;
}

export default function LabScriptsPane({ lab, debug, appConfig, onAnalyze, onLabUpdate, saveAllRef, pollingEnabled = true }) {
  const toast = useToast();
  const dialog = useDialog();
  const apiBasePath = `/api/v1/labs/${lab.id}/scripts`;

  const [activeTab, setActiveTab] = useState('browser');
  const [openFiles, setOpenFiles] = useState([]);
  const [editorTheme, setEditorTheme] = useState(() =>
    localStorage.getItem('monacoTheme') || 'vs-dark'
  );
  const [backupIgnoredFolders, setBackupIgnoredFolders] = useState(() =>
    normalizeBackupIgnoredFolders(lab.backupIgnoredFolders || [])
  );
  const [sharedFolders, setSharedFolders] = useState(lab.sharedFolders || []);

  useEffect(() => {
    setBackupIgnoredFolders(normalizeBackupIgnoredFolders(lab.backupIgnoredFolders || []));
  }, [lab.backupIgnoredFolders]);

  useEffect(() => {
    setSharedFolders(lab.sharedFolders || []);
  }, [lab.sharedFolders]);

  // ── File locking for tab-based editing ────────────────────────────────────
  // tabLocks: { [filePath]: { userId, userEmail, userName, isMe, locked } }
  const [tabLocks, setTabLocks] = useState({});
  const lockHeartbeatRef = useRef(null);

  const isReadonlyFile = useCallback((filePath) => filePath && /readonly/i.test(filePath), []);

  /** Load lock status for all currently open text files. */
  const loadTabLocks = useCallback(async () => {
    if (openFiles.length === 0) { setTabLocks({}); return; }
    try {
      const data = await fetchJSON(`/api/v1/locks/list?apiBasePath=${encodeURIComponent(apiBasePath)}`);
      setTabLocks(data.locks || {});
    } catch { /* ignore */ }
  }, [apiBasePath, openFiles.length]);

  // Poll locks every 15 seconds while tabs are open
  useEffect(() => {
    if (!pollingEnabled || openFiles.length === 0) return;
    loadTabLocks();
    const id = setInterval(loadTabLocks, 15_000);
    return () => clearInterval(id);
  }, [loadTabLocks, openFiles.length, pollingEnabled]);

  // Heartbeat: refresh locks every 60s for files I have open
  useEffect(() => {
    const editableFiles = openFiles.filter(f => f.isText && !isReadonlyFile(f.path));
    if (editableFiles.length === 0) return;
    lockHeartbeatRef.current = setInterval(() => {
      editableFiles.forEach(f => {
        fetch('/api/v1/locks/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
          body: JSON.stringify({ apiBasePath, file: f.path }),
        }).catch(() => {});
      });
    }, 60_000);
    return () => { if (lockHeartbeatRef.current) clearInterval(lockHeartbeatRef.current); };
  }, [openFiles, apiBasePath, isReadonlyFile]);

  /** Acquire lock for a file. Returns true on success. */
  const acquireTabLock = useCallback(async (filePath) => {
    if (isReadonlyFile(filePath)) {
      toast.error('This file is read-only');
      return false;
    }
    try {
      const res = await fetch('/api/v1/locks/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, file: filePath }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'locked') {
          toast.error(`File is locked by ${data.lock?.userName || data.lock?.userEmail || 'another user'}`);
        } else if (data.error === 'readonly') {
          toast.error('This file is read-only');
        }
        return false;
      }
      await loadTabLocks();
      return true;
    } catch {
      toast.error('Error acquiring file lock');
      return false;
    }
  }, [apiBasePath, isReadonlyFile, loadTabLocks, toast]);

  /** Release lock for a file. */
  const releaseTabLock = useCallback(async (filePath) => {
    try {
      await fetch('/api/v1/locks/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, file: filePath }),
      });
      await loadTabLocks();
    } catch { /* ignore */ }
  }, [apiBasePath, loadTabLocks]);

  // Sync dirty file count to the global registry
  useEffect(() => {
    const dirtyCount = openFiles.filter((f) => f.dirty).length;
    setDirtyCount(`lab:${lab.id}`, dirtyCount);
  }, [openFiles, lab.id]);

  // Keep a ref to openFiles so the unmount cleanup always sees the latest list
  // without re-running the effect (which would release locks on every keystroke).
  const openFilesRef = useRef(openFiles);
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);

  // Cleanup on unmount only (empty deps)
  useEffect(() => {
    return () => {
      removeDirtyCount(`lab:${lab.id}`);
      // Release all locks held by open tabs
      openFilesRef.current.forEach(f => {
        if (f.isText && !(/readonly/i.test(f.path))) {
          fetch('/api/v1/locks/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ apiBasePath, file: f.path }),
          }).catch(() => {});
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Determine which file the debugger is stopped in (relative path) ----
  const stoppedRelPath = (() => {
    if (!debug?.stoppedLocation?.file) return null;
    const marker = `/labs/${lab.id}/scripts/`;
    const idx = debug.stoppedLocation.file.indexOf(marker);
    if (idx !== -1) return debug.stoppedLocation.file.substring(idx + marker.length);
    return null;
  })();

  // Auto-open and switch to the file where debugger stopped
  useEffect(() => {
    if (!stoppedRelPath || debug?.status !== 'stopped') return;
    const tabKey = `file:${stoppedRelPath}`;
    // If file is already open, just switch to it
    if (openFiles.find(f => f.path === stoppedRelPath)) {
      setActiveTab(tabKey);
      return;
    }
    // Otherwise, acquire lock and open it
    (async () => {
      if (!isReadonlyFile(stoppedRelPath)) {
        await acquireTabLock(stoppedRelPath);
        // Even if lock fails, still open file (user can view but editing will be blocked)
      }
      try {
        const r = await fetch(`${apiBasePath}/content?file=${encodeURIComponent(stoppedRelPath)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        });
        if (!r.ok) throw new Error();
        const data = await r.json();
        const name = stoppedRelPath.split('/').pop();
        setOpenFiles(prev => {
          if (prev.find(f => f.path === stoppedRelPath)) return prev;
          return [...prev, {
            path: stoppedRelPath, name,
            content: data.content || '', originalContent: data.content || '',
            language: getLanguageFromFilename(stoppedRelPath),
            isSql: false, isImage: false, isPdf: false, isText: true, dirty: false,
          }];
        });
        setActiveTab(tabKey);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stoppedRelPath, debug?.status]);

  const saveFile = useCallback(async (filePath) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (!file) return;
    if (isReadonlyFile(filePath)) {
      toast.error('This file is read-only');
      return;
    }
    try {
      const res = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ file: filePath, content: file.content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'readonly') {
          toast.error('This file is read-only');
          return;
        }
        throw new Error();
      }
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, originalContent: f.content, dirty: false } : f)),
      );
      toast.success(`${file.name} saved`);
    } catch {
      toast.error(`Failed to save ${file.name}`);
    }
  }, [openFiles, apiBasePath, toast, isReadonlyFile]);

  // ---- Expose save-all-dirty-files for parent (used by LabResultsPane before Run/Debug) ----
  const saveAllDirtyFiles = useCallback(async () => {
    const dirtyFiles = openFiles.filter((f) => f.dirty);
    const saved = [];
    for (const f of dirtyFiles) {
      await saveFile(f.path);
      saved.push(f.path);
    }
    return saved;
  }, [openFiles, saveFile]);

  useEffect(() => {
    if (saveAllRef) saveAllRef.current = saveAllDirtyFiles;
    return () => { if (saveAllRef) saveAllRef.current = null; };
  }, [saveAllRef, saveAllDirtyFiles]);

  // ---- Workflow progress state (for "run workflow" from Scripts tab) ----
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [sseKey, setSseKey] = useState(0);
  const [preRunMessages, setPreRunMessages] = useState([]);
  const [stopOnFailure, setStopOnFailure] = useState(true);

  // SSE subscription for live workflow progress (virtual resultId "_output")
  const { workflowState } = useWorkflowEvents(lab.id, '_output', showProgress || workflowRunning, sseKey);

  // Auto-show/hide progress based on workflow state
  useEffect(() => {
    if (!workflowState) return;
    const st = workflowState.status;
    if (st === 'running') {
      setShowProgress(true);
      setWorkflowRunning(true);
    } else if (st === 'completed' || st === 'failed' || st === 'aborted' || st === 'idle') {
      setWorkflowRunning(false);
      if (st === 'idle' && (!workflowState.steps || workflowState.steps.length === 0)) {
        setShowProgress(false);
      }
    }
  }, [workflowState]);

  // ---- Run workflow: save dirty files, start workflow to Outputs, show progress ----
  const handleRunWorkflow = useCallback(async (workflowFile) => {
    try {
      // Auto-save all dirty open files before running
      const dirtyFiles = openFiles.filter((f) => f.dirty);
      if (dirtyFiles.length > 0) {
        const saved = [];
        for (const f of dirtyFiles) {
          await saveFile(f.path);
          saved.push(f.path);
        }
        setPreRunMessages(saved.map(f => ({ type: 'saved', text: `${f} saved` })));
        toast.info(`Auto-saved ${dirtyFiles.length} file${dirtyFiles.length > 1 ? 's' : ''}`);
      } else {
        setPreRunMessages([]);
      }

      setWorkflowRunning(true);
      setShowProgress(true);

      const res = await fetch(`/api/v1/labs/${lab.id}/scripts/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ workflowFile, stopOnFailure }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      setSseKey(k => k + 1);
      toast.success('Workflow started');
    } catch (e) {
      toast.error(`Run workflow error: ${e.message}`);
      setWorkflowRunning(false);
    }
  }, [lab.id, toast, openFiles, saveFile, stopOnFailure]);

  // ---- Debug workflow: save dirty files, create result run, notify user ----
  const handleDebugWorkflow = useCallback(async (workflowFile) => {
    try {
      // Auto-save all dirty open files before running
      const dirtyFiles = openFiles.filter((f) => f.dirty);
      if (dirtyFiles.length > 0) {
        for (const f of dirtyFiles) {
          await saveFile(f.path);
        }
        toast.info(`Auto-saved ${dirtyFiles.length} file${dirtyFiles.length > 1 ? 's' : ''}`);
      }

      const res = await fetch(`/api/v1/labs/${lab.id}/scripts/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ workflowFile }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      toast.success(`Debug session #${data.resultId} prepared for ${workflowFile}`);
    } catch (e) {
      toast.error(`Create new debugging session error: ${e.message}`);
    }
  }, [lab.id, toast, openFiles, saveFile]);

  const handleToggleBackupIgnoreFolder = useCallback(async (folderPath, shouldIgnore) => {
    const labRelativePath = toLabBackupFolderPath(folderPath);
    if (!labRelativePath) return;

    const current = normalizeBackupIgnoredFolders(backupIgnoredFolders);
    const next = shouldIgnore
      ? Array.from(new Set([...current, labRelativePath]))
      : current.filter((p) => p !== labRelativePath);

    try {
      const updated = await fetchJSON(`/api/v1/labs/${lab.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupIgnoredFolders: next }),
      });

      const normalizedUpdated = normalizeBackupIgnoredFolders(updated?.backupIgnoredFolders || next);
      setBackupIgnoredFolders(normalizedUpdated);
      onLabUpdate?.(updated);

      if (shouldIgnore) {
        toast.success(`Folder "${folderPath}" excluded from backup`);
      } else {
        toast.success(`Folder "${folderPath}" included in backup`);
      }
    } catch (e) {
      toast.error(`Failed to update backup exclusions: ${e.message || e}`);
    }
  }, [backupIgnoredFolders, lab.id, onLabUpdate, toast]);

  // Open file as a tab (or switch to existing)
  const handleFileOpen = useCallback(async (file) => {
    const filePath = file.path;
    if (openFiles.find((f) => f.path === filePath)) {
      setActiveTab(`file:${filePath}`);
      return;
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    const isSql = ext === 'sql';
    const isImg = isImageFile(filePath);
    const isPd = isPdfFile(filePath);
    const isOffice = isOfficeEditableFile(filePath);
    const isTxt = file.isText || isTextFile(filePath);

    if (isOffice) {
      openOfficeEditor(apiBasePath, filePath, isReadonlyFile(filePath) ? 'view' : 'edit');
      return;
    }

    // Acquire lock for editable text files before opening
    if ((isTxt || isSql) && !isReadonlyFile(filePath)) {
      const locked = await acquireTabLock(filePath);
      if (!locked) return; // couldn't acquire lock — don't open
    }

    if (isTxt || isSql) {
      fetch(`${apiBasePath}/content?file=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      })
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((data) => {
          setOpenFiles((prev) => [...prev, {
            path: filePath, name: file.name,
            content: data.content || '', originalContent: data.content || '',
            language: getLanguageFromFilename(filePath),
            isSql, isImage: false, isPdf: false, isText: true, dirty: false,
          }]);
          setActiveTab(`file:${filePath}`);
        })
        .catch(() => {
          releaseTabLock(filePath);
          toast.error(`Failed to load ${filePath}`);
        });
    } else if (isImg || isPd) {
      setOpenFiles((prev) => [...prev, {
        path: filePath, name: file.name, content: '', originalContent: '',
        language: 'plaintext', isSql: false, isImage: isImg, isPdf: isPd, isText: false, dirty: false,
      }]);
      setActiveTab(`file:${filePath}`);
    }
  }, [openFiles, apiBasePath, toast, acquireTabLock, releaseTabLock, isReadonlyFile]);

  const handleFileClose = useCallback(async (filePath) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (file?.dirty) {
      const shouldClose = await dialog.confirm({
        title: 'Unsaved changes',
        message: `File "${file.name}" has unsaved changes. Close anyway?`,
        confirmText: 'Close',
        cancelText: 'Cancel',
        tone: 'warning',
      });
      if (!shouldClose) return;
    }
    // Release lock when closing tab
    if (file?.isText && !isReadonlyFile(filePath)) {
      releaseTabLock(filePath);
    }
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    setActiveTab((prev) => (prev === `file:${filePath}` ? 'browser' : prev));
  }, [openFiles, releaseTabLock, isReadonlyFile, dialog]);

  const updateFileContent = useCallback((filePath, newContent) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath
          ? { ...f, content: newContent, dirty: newContent !== f.originalContent }
          : f,
      ),
    );
  }, []);

  const tabStyle = (isActive) => ({
    padding: '6px 10px',
    border: '1px solid #012345',
    borderBottom: 'none',
    marginBottom: isActive ? -1 : 0,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
    background: isActive ? '#fff' : '#f3f4f6',
    fontWeight: isActive ? 600 : 400,
    color: '#111827',
    zIndex: isActive ? 1 : 0,
    cursor: 'pointer', fontSize: 13,
    outline: 'none',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* File tab bar */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('browser')} style={tabStyle(activeTab === 'browser')}>
          📁 File browser
        </button>

        {openFiles.map((file) => {
          const isActive = activeTab === `file:${file.path}`;
          const lock = tabLocks[file.path];
          const lockedByMe = lock && lock.isMe;
          const lockedByOther = lock && !lock.isMe;
          const rdonly = isReadonlyFile(file.path);
          const icon = rdonly ? lockCfg.readonlyIcon
            : lockedByMe ? lockCfg.crownIcon
            : lockedByOther ? lockCfg.lockIcon
            : file.isSql ? '🧮' : file.isImage ? '🖼️' : file.isPdf ? '📕' : '📄';
          const shouldBlink = !isActive && debug?.status === 'stopped' && stoppedRelPath === file.path;
          return (
            <span key={file.path} style={{
              display: 'inline-flex', alignItems: 'stretch',
              marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0,
              animation: shouldBlink ? 'tabBlink 0.8s ease-in-out infinite' : 'none',
              borderRadius: '6px 6px 0 0',
            }}>
              <button
                onClick={() => setActiveTab(`file:${file.path}`)}
                title={file.path}
                style={{
                  padding: '6px 10px', border: '1px solid #012345', borderBottom: 'none', borderRight: 'none',
                  borderRadius: '6px 0 0 0', background: isActive ? '#fff' : '#f3f4f6',
                  fontWeight: isActive ? 600 : 400, color: '#111827', cursor: 'pointer', fontSize: 13,
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {icon} {file.name}{file.dirty ? ' •' : ''}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleFileClose(file.path); }}
                title="Close file"
                style={{
                  padding: '4px 6px', border: '1px solid #012345', borderBottom: 'none', borderLeft: 'none',
                  borderRadius: '0 6px 0 0', background: isActive ? '#fff' : '#f3f4f6',
                  cursor: 'pointer', color: '#9ca3af', fontSize: 12, display: 'flex', alignItems: 'center',
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

      {/* Content area */}
      <div style={{ border: '1px solid #012345', background: '#fff', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* File browser */}
        <div style={{ height: '100%', display: activeTab === 'browser' ? 'flex' : 'none', flexDirection: 'column', padding: 6 }}>

          {/* Stop on failure + progress controls */}
          {(showProgress || workflowRunning) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
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
                Stop on failure
              </label>
              {workflowRunning && (
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>
                  ● Running…
                </span>
              )}
            </div>
          )}

          {/* Main content: progress pane + file browser */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>
            {showProgress && workflowState && workflowState.steps?.length > 0 && (
              <WorkflowProgressPane
                workflowState={workflowState}
                onClose={() => setShowProgress(false)}
                preRunMessages={preRunMessages}
              />
            )}

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <FileManagerEditor
                apiBasePath={apiBasePath}
                showUpload showDelete
                readOnly={false}
                showModificationDate
                title={`${lab.name} — scripts`}
                refreshTrigger={0}
                pollingEnabled={pollingEnabled && activeTab === 'browser'}
                onFileDoubleClick={handleFileOpen}
                onDebugWorkflow={handleDebugWorkflow}
                onRunWorkflow={handleRunWorkflow}
                specialFolders={appConfig?.outputsFolderName ? [appConfig.outputsFolderName] : ['Outputs']}
                csvPreviewMaxRows={appConfig?.csvPreviewMaxRows}
                previewMaxFileSize={appConfig?.previewMaxFileSize}
                onAnalyze={onAnalyze ? (fileName) => onAnalyze({ labId: lab.id, apiPath: apiBasePath, fileName }) : undefined}
                labOwnerId={lab.ownerId}
                backupIgnoredFolders={backupIgnoredFolders}
                onToggleBackupIgnoreFolder={handleToggleBackupIgnoreFolder}
                sharedFolders={sharedFolders}
                onFolderShareUpdate={(updated) => {
                  setSharedFolders(updated.sharedFolders || []);
                  onLabUpdate?.(updated);
                }}
              />
            </div>
          </div>
        </div>

        {/* Open file editors */}
        {openFiles.map((file) => (
          <div
            key={file.path}
            style={{
              height: '100%',
              display: activeTab === `file:${file.path}` ? 'flex' : 'none',
              flexDirection: 'column', padding: 6,
            }}
          >
            {file.isSql ? (
              <SqlEditorTab
                initialSql={file.content}
                onSqlChange={(val) => updateFileContent(file.path, val)}
                extraButtons={
                  <button className="btn btn-add" onClick={() => saveFile(file.path)} disabled={!file.dirty} style={{ fontSize: 12 }}>
                    💾 Save{file.dirty ? ' •' : ''}
                  </button>
                }
              />
            ) : file.isText ? (
              <TextFileEditor
                file={file}
                editorTheme={editorTheme}
                onEditorThemeChange={(t) => { setEditorTheme(t); localStorage.setItem('monacoTheme', t); }}
                onChange={(val) => updateFileContent(file.path, val)}
                onSave={() => saveFile(file.path)}
                debug={debug}
                labId={lab.id}
                lockInfo={tabLocks[file.path]}
                isReadonly={isReadonlyFile(file.path)}
              />
            ) : file.isImage ? (
              <ZoomableImage
                src={`${apiBasePath}/download?file=${encodeURIComponent(file.path)}&inline=1&token=${localStorage.getItem('authToken')}`}
                alt={file.name}
              />
            ) : file.isPdf ? (
              <embed
                src={`${apiBasePath}/download?file=${encodeURIComponent(file.path)}&inline=1&token=${localStorage.getItem('authToken')}`}
                type="application/pdf"
                style={{ flex: 1, width: '100%', borderRadius: 8 }}
              />
            ) : null}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes tabBlink {
          0%, 100% { background: #fef3c7; }
          50% { background: #fbbf24; }
        }
      `}</style>
    </div>
  );
}

/**
 * Inline text file editor with toolbar + Monaco.
 * For Python files: always uses DebugEditor with breakpoint gutter.
 * Breakpoints are stored using relative paths (within lab scripts folder).
 */
function TextFileEditor({ file, editorTheme, onEditorThemeChange, onChange, onSave, debug, labId, lockInfo, isReadonly }) {
  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  const isPython = file.language === 'python';
  const lockedByMe = lockInfo && lockInfo.isMe;
  const lockedByOther = lockInfo && !lockInfo.isMe;
  const editorReadOnly = isReadonly || lockedByOther;

  // Breakpoints use relative paths (file.path is relative within scripts/)
  const breakpoints = (isPython && debug) ? debug.getBreakpoints(file.path) : new Set();

  // Stopped line: check if the debug session is stopped on this file
  // The stoppedLocation.file from DAP is an absolute path — resolve to relative
  let stoppedLine = null;
  if (isPython && debug?.stoppedLocation?.file) {
    const stoppedFile = debug.stoppedLocation.file;
    // Try to match: stoppedFile ends with /scripts/<file.path>
    const marker = `/labs/${labId}/scripts/`;
    const idx = stoppedFile.indexOf(marker);
    if (idx !== -1) {
      const relPath = stoppedFile.substring(idx + marker.length);
      if (relPath === file.path) {
        stoppedLine = debug.stoppedLocation.line;
      }
    }
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px',
        background: editorTheme === 'vs' ? '#f5f5f5' : '#1e1e1e',
        borderBottom: `1px solid ${editorTheme === 'vs' ? '#e5e7eb' : '#333'}`,
        borderRadius: '6px 6px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: 'rgba(59,130,246,0.2)', color: editorTheme === 'vs' ? '#1d4ed8' : '#60a5fa',
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
          }}>{file.language}</span>
          {isReadonly && (
            <span style={{ background: 'rgba(239,68,68,0.2)', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
              {lockCfg.readonlyIcon} Read only
            </span>
          )}
          {lockedByMe && (
            <span style={{ background: 'rgba(245,158,11,0.2)', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
              {lockCfg.crownIcon} Exclusive
            </span>
          )}
          {lockedByOther && (
            <span style={{ background: 'rgba(239,68,68,0.2)', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
              {lockCfg.lockIcon} {lockInfo.userName || lockInfo.userEmail || 'Locked'}
            </span>
          )}
          {isPython && debug && (
            <span style={{
              fontSize: 10, color: breakpoints.size > 0 ? '#dc2626' : '#888', fontFamily: 'monospace',
            }} title="Click in the editor gutter to set breakpoints">
              🔴 {breakpoints.size > 0 ? `${breakpoints.size} breakpoint${breakpoints.size > 1 ? 's' : ''}` : 'breakpoints'}
            </span>
          )}
          <select
            value={editorTheme}
            onChange={(e) => onEditorThemeChange(e.target.value)}
            style={{
              padding: '3px 6px', borderRadius: 4, fontSize: 11,
              border: `1px solid ${editorTheme === 'vs' ? '#d1d5db' : '#555'}`,
              background: editorTheme === 'vs' ? '#fff' : '#333',
              color: editorTheme === 'vs' ? '#374151' : '#e5e7eb',
            }}
          >
            {availableThemes.map((t) => <option key={t.value} value={t.value}>🎨 {t.label}</option>)}
          </select>
        </div>
        <button className="btn btn-add" onClick={onSave} disabled={!file.dirty || editorReadOnly} style={{ fontSize: 12, padding: '4px 10px' }}>
          💾 Save{file.dirty ? ' •' : ''}
        </button>
      </div>
      <div style={{ flex: 1, borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {isPython && debug ? (
          <DebugEditor
            file={file}
            editorTheme={editorTheme}
            breakpoints={breakpoints}
            stoppedLine={stoppedLine}
            readOnly={editorReadOnly}
            onChange={(val) => onChange(val || '')}
            onSave={editorReadOnly ? undefined : onSave}
            onToggleBreakpoint={(_filePath, line) => {
              debug.toggleBreakpoint(file.path, line);
            }}
            onBreakpointsMoved={(_filePath, newLines) => {
              debug.updateBreakpointPositions(file.path, newLines);
            }}
          />
        ) : (
          <CodeEditor
            value={file.content}
            language={file.language}
            theme={editorTheme}
            readOnly={editorReadOnly}
            onChange={editorReadOnly ? undefined : (val) => onChange(val || '')}
            onSave={editorReadOnly ? undefined : onSave}
          />
        )}
      </div>
    </>
  );
}

