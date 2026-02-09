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
import React, { useCallback, useState } from 'react';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import SqlEditorTab from './SqlEditorTab.jsx';
import Editor from '@monaco-editor/react';
import DebugEditor from '../debug/DebugEditor.jsx';
import { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile } from '../components/file-manager/fileUtils.js';
import { useToast } from '../components/Toast';

export default function LabScriptsPane({ lab, debug }) {
  const toast = useToast();
  const apiBasePath = `/api/v1/labs/${lab.id}/scripts`;

  const [activeTab, setActiveTab] = useState('browser');
  const [openFiles, setOpenFiles] = useState([]);
  const [editorTheme, setEditorTheme] = useState(() =>
    localStorage.getItem('monacoTheme') || 'vs-dark'
  );

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
    // Otherwise, open it
    fetch(`${apiBasePath}/content?file=${encodeURIComponent(stoppedRelPath)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
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
      })
      .catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stoppedRelPath, debug?.status]);

  // ---- Debug workflow: create result run and notify user ----
  const handleDebugWorkflow = useCallback(async (workflowFile) => {
    try {
      const res = await fetch(`/api/v1/labs/${lab.id}/scripts/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ workflowFile }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      toast.success(`Debug run #${data.resultId} vytvořen pro ${workflowFile}`);
    } catch (e) {
      toast.error(`Chyba debug: ${e.message}`);
    }
  }, [lab.id, toast]);

  // Open file as a tab (or switch to existing)
  const handleFileOpen = useCallback((file) => {
    const filePath = file.path;
    if (openFiles.find((f) => f.path === filePath)) {
      setActiveTab(`file:${filePath}`);
      return;
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    const isSql = ext === 'sql';
    const isImg = isImageFile(filePath);
    const isPd = isPdfFile(filePath);
    const isTxt = file.isText || isTextFile(filePath);

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
        .catch(() => toast.error(`Failed to load ${filePath}`));
    } else if (isImg || isPd) {
      setOpenFiles((prev) => [...prev, {
        path: filePath, name: file.name, content: '', originalContent: '',
        language: 'plaintext', isSql: false, isImage: isImg, isPdf: isPd, isText: false, dirty: false,
      }]);
      setActiveTab(`file:${filePath}`);
    }
  }, [openFiles, apiBasePath, toast]);

  const handleFileClose = useCallback((filePath) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (file?.dirty && !confirm(`File "${file.name}" has unsaved changes. Close anyway?`)) return;
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    setActiveTab((prev) => (prev === `file:${filePath}` ? 'browser' : prev));
  }, [openFiles]);

  const updateFileContent = useCallback((filePath, newContent) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath
          ? { ...f, content: newContent, dirty: newContent !== f.originalContent }
          : f,
      ),
    );
  }, []);

  const saveFile = useCallback(async (filePath) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (!file) return;
    try {
      const res = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ file: filePath, content: file.content }),
      });
      if (!res.ok) throw new Error();
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, originalContent: f.content, dirty: false } : f)),
      );
      toast.success(`${file.name} saved`);
    } catch {
      toast.error(`Failed to save ${file.name}`);
    }
  }, [openFiles, apiBasePath, toast]);

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
          const icon = file.isSql ? '🧮' : file.isImage ? '🖼️' : file.isPdf ? '📕' : '📄';
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
        <div style={{ height: '100%', display: activeTab === 'browser' ? 'block' : 'none', padding: 6 }}>
          <FileManagerEditor
            apiBasePath={apiBasePath}
            showUpload showDelete
            readOnly={false}
            showModificationDate
            title={`${lab.name} — scripts`}
            refreshTrigger={0}
            onFileDoubleClick={handleFileOpen}
            onDebugWorkflow={handleDebugWorkflow}
          />
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
              />
            ) : file.isImage ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 8 }}>
                <img
                  src={`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`}
                  alt={file.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                />
              </div>
            ) : file.isPdf ? (
              <embed
                src={`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`}
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
function TextFileEditor({ file, editorTheme, onEditorThemeChange, onChange, onSave, debug, labId }) {
  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  const isPython = file.language === 'python';

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
          {isPython && debug && (
            <span style={{
              fontSize: 10, color: breakpoints.size > 0 ? '#dc2626' : '#888', fontFamily: 'monospace',
            }} title="Klikněte do okraje editoru pro nastavení breakpointů">
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
        <button className="btn btn-add" onClick={onSave} disabled={!file.dirty} style={{ fontSize: 12, padding: '4px 10px' }}>
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
            readOnly={false}
            onChange={(val) => onChange(val || '')}
            onToggleBreakpoint={(_filePath, line) => {
              debug.toggleBreakpoint(file.path, line);
            }}
            onBreakpointsMoved={(_filePath, newLines) => {
              debug.updateBreakpointPositions(file.path, newLines);
            }}
          />
        ) : (
          <Editor
            height="100%"
            language={file.language}
            value={file.content}
            onChange={(val) => onChange(val || '')}
            theme={editorTheme}
            options={{ minimap: { enabled: true }, fontSize: 13, wordWrap: 'on', automaticLayout: true, tabSize: 2, readOnly: false }}
          />
        )}
      </div>
    </>
  );
}

