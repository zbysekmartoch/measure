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
import React, { useCallback, useState } from 'react';
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
  title,
  refreshTrigger = 0,
}) {
  const [showPreview, setShowPreview] = useState(true);
  const [editorTheme, setEditorTheme] = useState(() => localStorage.getItem('monacoTheme') || 'vs-dark');

  const fm = useFileManager({ apiBasePath, showUpload, showDelete, readOnly, onFileSelect, refreshTrigger });

  const handleThemeChange = useCallback((theme) => {
    setEditorTheme(theme);
    localStorage.setItem('monacoTheme', theme);
  }, []);

  // Open editor in new popup window
  const openInNewWindow = useCallback(() => {
    if (!fm.selectedFile || !fm.selectedFileInfo?.isText) return;
    const w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) return;
    const html = `<!DOCTYPE html><html><head><title>${fm.selectedFile} - Editor</title>
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
${!readOnly ? `document.getElementById('sv').addEventListener('click',async()=>{try{const r=await fetch('${apiBasePath}/content',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer ${localStorage.getItem('authToken')}'},body:JSON.stringify({file:'${fm.selectedFile}',content:ed.getValue()})});if(!r.ok)throw 0;alert('Uloženo!');}catch{alert('Chyba při ukládání');}});` : ''}});<` + `/script></body></html>`;
    w.document.write(html);
    w.document.close();
  }, [fm.selectedFile, fm.selectedFileInfo, fm.fileContent, apiBasePath, readOnly]);

  return (
    <div style={{ height: '100%', display: 'flex', gap: 12 }}>
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
        onDeleteFolder={fm.deleteFolderRecursive}
        onDownloadFolderZip={fm.downloadFolderZip}
        onPasteInto={fm.pasteInto}
        onDebugWorkflow={onDebugWorkflow}
      />

      {showPreview && (
        <FilePreviewPane
          selectedFile={fm.selectedFile}
          selectedFileInfo={fm.selectedFileInfo}
          fileContent={fm.fileContent}
          pdfBlobUrl={fm.pdfBlobUrl}
          isEditing={fm.isEditing}
          loading={fm.loading}
          readOnly={readOnly}
          editorTheme={editorTheme}
          showDelete={showDelete}
          apiBasePath={apiBasePath}
          onEdit={() => fm.setIsEditing(true)}
          onSave={fm.saveFileContent}
          onCancel={() => { fm.setIsEditing(false); fm.loadFileContent(fm.selectedFileInfo); }}
          onContentChange={fm.setFileContent}
          onThemeChange={handleThemeChange}
          onOpenInNewWindow={openInNewWindow}
          onDownloadFile={fm.downloadFile}
          onDeleteFile={fm.deleteFile}
        />
      )}
    </div>
  );
}
