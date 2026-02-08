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
          return (
            <span key={file.path} style={{ display: 'inline-flex', alignItems: 'stretch', marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0 }}>
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
    </div>
  );
}

/**
 * Inline text file editor with toolbar + Monaco.
 * For Python files: uses DebugEditor with breakpoint gutter if debug session is available.
 */
function TextFileEditor({ file, editorTheme, onEditorThemeChange, onChange, onSave, debug, labId }) {
  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  const isPython = file.language === 'python';

  // Resolve absolute file path for breakpoints (DAP needs abs paths).
  // Derive from debug info or use a known pattern.
  let absPath = null;
  if (isPython && debug?.debugInfo?.scriptAbsolutePath) {
    // scriptAbsolutePath is e.g. /path/to/labs/X/scripts/analyzy/sum.py
    // scriptPath is the relative part e.g. analyzy/sum.py
    // So scriptsRoot = scriptAbsolutePath without the trailing scriptPath
    const sp = debug.debugInfo.scriptPath;
    const sap = debug.debugInfo.scriptAbsolutePath;
    if (sp && sap.endsWith(sp)) {
      const scriptsRoot = sap.slice(0, -sp.length);
      absPath = scriptsRoot + file.path;
    }
  }
  // Fallback: try a marker-based approach
  if (!absPath && isPython) {
    const marker = `/labs/${labId}/scripts/`;
    if (debug?.debugInfo?.scriptAbsolutePath?.includes(marker)) {
      const base = debug.debugInfo.scriptAbsolutePath;
      const idx = base.indexOf(marker);
      absPath = base.substring(0, idx) + marker + file.path;
    }
  }

  const breakpoints = (absPath && debug) ? debug.getBreakpoints(absPath) : new Set();
  const stoppedLine = (absPath && debug?.stoppedLocation?.file === absPath)
    ? debug.stoppedLocation.line
    : null;

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
          {isPython && absPath && (
            <span style={{
              fontSize: 10, color: '#888', fontFamily: 'monospace',
            }} title="Breakpoints can be set by clicking in the gutter">
              🔴 breakpoints ready
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
        {isPython && absPath && debug ? (
          <DebugEditor
            file={file}
            editorTheme={editorTheme}
            breakpoints={breakpoints}
            stoppedLine={stoppedLine}
            readOnly={false}
            onChange={(val) => onChange(val || '')}
            onToggleBreakpoint={(_filePath, line) => {
              debug.toggleBreakpoint(absPath, line);
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

