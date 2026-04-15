/**
 * FileManagerEditor — index barrel for the decomposed file-manager module.
 * Re-exports everything so existing `import … from './FileManagerEditor.jsx'` still works.
 */
export { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile, formatFileSize, formatModifiedDate, fileIcon, extractFiles, groupFilesByFolder } from './file-manager/fileUtils.js';
export { default as useFileManager } from './file-manager/useFileManager.js';
export { default as FileBrowserPane } from './file-manager/FileBrowserPane.jsx';
export { default as FilePreviewPane } from './file-manager/FilePreviewPane.jsx';
export { useFileClipboard, FileClipboardProvider } from './file-manager/ClipboardContext.jsx';

/**
 * Default export — drop-in replacement for the old 1254-line monolith.
 * Composes FileBrowserPane + FilePreviewPane + useFileManager hook.
 */
import React, { useCallback, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import useFileManager from './file-manager/useFileManager.js';
import FileBrowserPane from './file-manager/FileBrowserPane.jsx';
import FilePreviewPane from './file-manager/FilePreviewPane.jsx';
import { getLanguageFromFilename } from './file-manager/fileUtils.js';


export default function FileManagerEditor({
  apiBasePath = '/api/v1/scripts',
  showUpload = true,
  showDelete = true,
  readOnly = false,
  showModificationDate = true,
  onFileSelect,
  onFileDoubleClick,
  onDebugWorkflow,
  onRunWorkflow,
  title,
  refreshTrigger = 0,
  onPublish,
  specialFolders,
  onAnalyze,
  csvPreviewMaxRows,
  labOwnerId,
}) {
  const { user } = useAuth();
  const [showPreview, setShowPreview] = useState(true);
  const [editorTheme, setEditorTheme] = useState(() => localStorage.getItem('monacoTheme') || 'vs-dark');
  const [splitterWidth, setSplitterWidth] = useState(380);
  const containerRef = useRef(null);

  const fm = useFileManager({ apiBasePath, showUpload, showDelete, readOnly, onFileSelect, refreshTrigger });

  const handleThemeChange = useCallback((theme) => {
    setEditorTheme(theme);
    localStorage.setItem('monacoTheme', theme);
  }, []);

  // Open editor in new popup window
  const openInNewWindow = useCallback(() => {
    if (!fm.selectedFile || !fm.selectedFileInfo?.isText) return;
    const faviconEl = document.querySelector('link[rel="icon"]');
    const faviconHref = faviconEl ? new URL(faviconEl.href, location.origin).href : '';
    const faviconTag = faviconHref ? `<link rel="icon" href="${faviconHref}">` : '';
    const w = window.open('', '_blank', 'popup,width=1200,height=800');
    if (!w) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fm.selectedFile} - Editor</title>${faviconTag}
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif}
#c{height:100vh;display:flex;flex-direction:column}
#t{padding:8px 12px;background:#1e1e1e;border-bottom:1px solid #333;display:flex;gap:12px;align-items:center}
#t span{color:#ccc;font-size:13px}#t select{padding:4px 8px;border-radius:4px;border:1px solid #555;background:#333;color:#fff}
#t button{padding:6px 12px;border-radius:4px;border:none;cursor:pointer;font-size:12px}
#t button.s{background:#22c55e;color:#fff}#t button.x{background:#6b7280;color:#fff}#e{flex:1}
.b{background:rgba(255,255,255,.1);padding:2px 8px;border-radius:4px;font-size:11px;text-transform:uppercase}</style></head>
<body><div id="c"><div id="t"><span>📄 ${fm.selectedFile}</span><span class="b">${getLanguageFromFilename(fm.selectedFile)}</span>
<select id="ts"><option value="vs">Light</option><option value="vs-dark" selected>Dark</option><option value="hc-black">High Contrast</option></select>
${!readOnly ? '<button class="s" id="sv">💾 Save</button>' : ''}
<button class="x" onclick="window.close()">✕ Close</button></div><div id="e"></div></div>
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"><` + `/script>
<script>require.config({paths:{vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'}});
require(['vs/editor/editor.main'],function(){const ed=monaco.editor.create(document.getElementById('e'),{
value:${JSON.stringify(fm.fileContent)},language:'${getLanguageFromFilename(fm.selectedFile)}',
theme:'vs-dark',fontSize:13,minimap:{enabled:true},automaticLayout:true,wordWrap:'on',tabSize:2,readOnly:${readOnly}});
document.getElementById('ts').addEventListener('change',e=>monaco.editor.setTheme(e.target.value));
${!readOnly ? `document.getElementById('sv').addEventListener('click',async()=>{try{const r=await fetch('${apiBasePath}/content',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${localStorage.getItem('authToken')}'},body:JSON.stringify({file:'${fm.selectedFile}',content:ed.getValue()})});if(!r.ok)throw 0;alert('Saved!');}catch{alert('Error saving');}});` : ''}});<` + `/script></body></html>`;
    w.document.write(html);
    w.document.close();
  }, [fm.selectedFile, fm.selectedFileInfo, fm.fileContent, apiBasePath, readOnly]);

  // ---- Splitter drag handling ----
  const onSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const doc = container.ownerDocument;
    const startX = e.clientX;
    const startWidth = splitterWidth;

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      setSplitterWidth(Math.max(200, Math.min(container.offsetWidth - 200, startWidth + delta)));
    };

    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.body.style.userSelect = '';
      doc.body.style.cursor = '';
    };

    doc.body.style.userSelect = 'none';
    doc.body.style.cursor = 'col-resize';
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }, [splitterWidth]);

  // Handle edit with lock acquisition
  const handleEdit = useCallback(async () => {
    if (!fm.selectedFile) return;
    if (fm.isReadonlyFile(fm.selectedFile)) return;
    const locked = await fm.acquireFileLock(fm.selectedFile);
    if (locked) {
      fm.setIsEditing(true);
    }
  }, [fm]);

  // Auto-edit: first keystroke in Monaco triggers lock acquisition
  const autoEditPendingRef = useRef(false);
  const handleContentChange = useCallback((newContent) => {
    fm.setFileContent(newContent);
    // Only trigger auto-edit when content actually differs from original
    // (model.setValue during file switch fires onChange with the same content)
    if (!fm.isEditing && !autoEditPendingRef.current && newContent !== fm.originalContent) {
      autoEditPendingRef.current = true;
      handleEdit().finally(() => { autoEditPendingRef.current = false; });
    }
  }, [fm, handleEdit]);

  // Handle cancel — release lock and reload
  const handleCancelEdit = useCallback(async () => {
    if (fm.selectedFile) {
      await fm.releaseFileLock(fm.selectedFile);
    }
    fm.setIsEditing(false);
    fm.loadFileContent(fm.selectedFileInfo);
  }, [fm]);

  // Unlock a single file (own lock or lab-owner force)
  const handleUnlockFile = useCallback(async (filePath) => {
    await fm.releaseFileLock(filePath);
    // If it was the currently-editing file, exit editing mode
    if (fm.selectedFile === filePath && fm.isEditing) {
      fm.setIsEditing(false);
      fm.loadFileContent(fm.selectedFileInfo);
    }
  }, [fm]);

  // Unlock all locked files in a folder (prefix match)
  const handleUnlockFolder = useCallback(async (folderPath) => {
    try {
      await fetch('/api/v1/locks/release-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, folder: folderPath }),
      });
      await fm.loadLocks();
    } catch { /* ignore */ }
  }, [apiBasePath, fm]);

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', position: 'relative' }}>
      <FileBrowserPane
        title={title}
        loading={fm.loading}
        tree={fm.tree}
        files={fm.files}
        expandedFolders={fm.expandedFolders}
        selectedFile={fm.selectedFile}
        dragOverFolder={fm.dragOverFolder}
        showPreview={showPreview}
        showUpload={showUpload}
        showDelete={showDelete}
        showModificationDate={showModificationDate}
        folderUploadRef={fm.folderUploadRef}
        apiBasePath={apiBasePath}
        onRefresh={fm.loadFiles}
        onTogglePreview={() => setShowPreview((p) => !p)}
        onUpload={fm.handleFileUpload}
        onFolderUpload={fm.handleFolderUpload}
        onTriggerFolderUpload={fm.triggerFolderUpload}
        onDrop={fm.handleDrop}
        onDragOver={fm.handleDragOver}
        onDragLeave={fm.handleDragLeave}
        onToggleFolder={fm.toggleFolder}
        onFileClick={(file) => fm.loadFileContent(file)}
        onFileDoubleClick={onFileDoubleClick}
        onCreateNewFile={fm.createNewFile}
        onCreateNewFolder={fm.createNewFolder}
        onDeleteFolder={fm.deleteFolderRecursive}
        onDownloadFolderZip={fm.downloadFolderZip}
        onPasteInto={fm.pasteInto}
        onDebugWorkflow={onDebugWorkflow}
        onRunWorkflow={onRunWorkflow}
        onRename={fm.renameItem}
        changedFiles={fm.changedFiles}
        onPublish={onPublish}
        specialFolders={specialFolders}
        overrideWidth={showPreview ? splitterWidth : undefined}
        fileLocks={fm.fileLocks}
        isReadonlyFile={fm.isReadonlyFile}
        onRequestLock={fm.requestFileLock}
        onUnlockFile={handleUnlockFile}
        onUnlockFolder={handleUnlockFolder}
        labOwnerId={labOwnerId}
        currentUserId={user?.id}
      />

      {showPreview && (
        <div
          onMouseDown={onSplitterMouseDown}
          style={{
            width: 6, cursor: 'col-resize', flexShrink: 0,
            background: '#e5e7eb', borderRadius: 3,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#93c5fd'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#e5e7eb'; }}
        />
      )}

      {showPreview && (
        <FilePreviewPane
          selectedFile={fm.selectedFile}
          selectedFileInfo={fm.selectedFileInfo}
          fileContent={fm.fileContent}
          pdfBlobUrl={fm.pdfBlobUrl}
          imageBlobUrl={fm.imageBlobUrl}
          isEditing={fm.isEditing}
          loading={fm.loading}
          readOnly={readOnly}
          editorTheme={editorTheme}
          showDelete={showDelete}
          previewRefreshKey={fm.previewRefreshKey}
          onEdit={handleEdit}
          onSave={fm.saveFileContent}
          onCancel={handleCancelEdit}
          onContentChange={handleContentChange}
          onThemeChange={handleThemeChange}
          onOpenInNewWindow={openInNewWindow}
          onDownloadFile={fm.downloadFile}
          onDeleteFile={fm.deleteFile}
          onAnalyze={onAnalyze}
          csvPreviewMaxRows={csvPreviewMaxRows}
          fileLocks={fm.fileLocks}
          isReadonlyFile={fm.isReadonlyFile}
          onReleaseLock={fm.releaseFileLock}
          onRequestLock={fm.requestFileLock}
        />
      )}
    </div>
  );
}
