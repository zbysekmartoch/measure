/**
 * FileManagerEditor - Reusable file browser and Monaco editor component
 * Used in AnalysisDefinitionTab and DebugTab
 * 
 * Props:
 * - apiBasePath: Base API path for file operations (e.g., '/api/v1/scripts' or '/api/v1/results/{id}/files')
 * - showUpload: Whether to show upload functionality (default: true)
 * - showDelete: Whether to show delete functionality (default: true)
 * - readOnly: Whether files are read-only (default: false)
 * - showModificationDate: Whether to show file modification dates (default: true)
 * - onFileSelect: Callback when a file is selected
 * - title: Optional title for the file browser section
 */
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { fetchJSON } from '../lib/fetchJSON.js';
import Editor from '@monaco-editor/react';
import { useToast } from './Toast';

// Map file extensions to Monaco Editor languages
export const getLanguageFromFilename = (filename) => {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap = {
    'py': 'python',
    'python': 'python',
    'js': 'javascript',
    'jsx': 'javascript',
    'cjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'sql': 'sql',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'md': 'markdown',
    'markdown': 'markdown',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'sh': 'shell',
    'bash': 'shell',
    'txt': 'plaintext',
    'log': 'plaintext',
    'err': 'plaintext',
    'csv': 'plaintext',
  };
  return languageMap[ext] || 'plaintext';
};

// Check if file is an image
export const isImageFile = (filename) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

// Check if file is a PDF
export const isPdfFile = (filename) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext === 'pdf';
};

// Format file size
export const formatFileSize = (bytes) => {
  if (bytes === undefined || bytes === null) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Check if file is text-based by extension
export const isTextFile = (filename) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  const textExtensions = ['log', 'err', 'txt', 'json', 'xml', 'yaml', 'yml', 'md', 'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'sql', 'sh', 'bash', 'csv', 'ini', 'cfg', 'conf', 'properties'];
  return textExtensions.includes(ext);
};

export default function FileManagerEditor({
  apiBasePath = '/api/v1/scripts',
  showUpload = true,
  showDelete = true,
  readOnly = false,
  showModificationDate = true,
  onFileSelect,
  title,
  refreshTrigger = 0,
}) {
  const { t } = useLanguage();
  const toast = useToast();
  
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileInfo, setSelectedFileInfo] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState(''); // Track original content for detecting changes
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editorTheme, setEditorTheme] = useState(() => 
    localStorage.getItem('monacoTheme') || 'vs-dark'
  );
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({}); // Track expanded folders
  const [uploadTargetFolder, setUploadTargetFolder] = useState(null); // For folder-specific upload
  const folderUploadRef = useRef(null); // Ref for folder-specific upload input

  // Available Monaco Editor themes
  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  // Save theme to localStorage
  const handleThemeChange = useCallback((theme) => {
    setEditorTheme(theme);
    localStorage.setItem('monacoTheme', theme);
  }, []);

  // Open editor in new window
  const openInNewWindow = useCallback(() => {
    if (!selectedFile || !selectedFileInfo?.isText) return;
    
    const newWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!newWindow) {
      toast.error(t('popupBlocked') || 'Povolit vyskakovací okna pro tuto stránku');
      return;
    }
    
    // HTML content for new window with Monaco Editor
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>${selectedFile} - Editor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; }
    #container { height: 100vh; display: flex; flex-direction: column; }
    #toolbar { padding: 8px 12px; background: #1e1e1e; border-bottom: 1px solid #333; display: flex; gap: 12px; align-items: center; }
    #toolbar span { color: #ccc; font-size: 13px; }
    #toolbar select { padding: 4px 8px; border-radius: 4px; border: 1px solid #555; background: #333; color: #fff; }
    #toolbar button { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; }
    #toolbar button.save { background: #22c55e; color: #fff; }
    #toolbar button.close { background: #6b7280; color: #fff; }
    #editor { flex: 1; }
    .badge { background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
  </style>
</head>
<body>
  <div id="container">
    <div id="toolbar">
      <span>📄 ${selectedFile}</span>
      <span class="badge">${getLanguageFromFilename(selectedFile)}</span>
      <select id="themeSelect">
        <option value="vs">Light</option>
        <option value="vs-dark" selected>Dark</option>
        <option value="hc-black">High Contrast</option>
      </select>
      ${!readOnly ? '<button class="save" id="saveBtn">💾 Save</button>' : ''}
      <button class="close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="editor"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"><` + `/script>
  <script>
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      const editor = monaco.editor.create(document.getElementById('editor'), {
        value: ${JSON.stringify(fileContent)},
        language: '${getLanguageFromFilename(selectedFile)}',
        theme: 'vs-dark',
        fontSize: 13,
        minimap: { enabled: true },
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        readOnly: ${readOnly}
      });
      
      document.getElementById('themeSelect').addEventListener('change', (e) => {
        monaco.editor.setTheme(e.target.value);
      });
      
      ${!readOnly ? `
      document.getElementById('saveBtn').addEventListener('click', async () => {
        try {
          const response = await fetch('${apiBasePath}/content', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${localStorage.getItem('authToken')}'
            },
            body: JSON.stringify({
              file: '${selectedFile}',
              content: editor.getValue()
            })
          });
          if (!response.ok) throw new Error('Save failed');
          alert('Soubor uložen!');
        } catch (e) {
          alert('Chyba při ukládání: ' + e.message);
        }
      });
      ` : ''}
    });
  <` + `/script>
</body>
</html>
    `;
    
    newWindow.document.write(htmlContent);
    newWindow.document.close();
  }, [selectedFile, selectedFileInfo, fileContent, t, apiBasePath, readOnly, toast]);

  // Recursive function to extract all files from the tree
  const extractFiles = useCallback((items) => {
    const filesList = [];
    
    const traverse = (nodes) => {
      if (!nodes) return;
      
      for (const node of nodes) {
        if (node.type === 'file') {
          filesList.push(node);
        }
        if (node.type === 'directory' && node.children) {
          traverse(node.children);
        }
      }
    };
    
    traverse(items);
    return filesList;
  }, []);

  // Load file list
  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJSON(apiBasePath);
      
      const filesList = extractFiles(data.items || []);
      setFiles(filesList);
    } catch (error) {
      console.error('Error loading files:', error);
      // Don't show alert for initial load failure - might be empty
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, extractFiles]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles, refreshTrigger]);

  // Cleanup PDF blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  // Load file content
  const loadFileContent = useCallback(async (file, forceLoad = false) => {
    // Check for unsaved changes before switching files (only if not in new window and editing)
    if (!forceLoad && isEditing && fileContent !== originalContent && selectedFile && selectedFile !== file.path) {
      const confirmMessage = t('unsavedChangesConfirm') || 
        `Soubor "${selectedFile}" má neuložené změny. Chcete je uložit?\n\nUložit = OK, Zahodit = Cancel`;
      
      if (confirm(confirmMessage)) {
        // User wants to save - save first, then switch
        try {
          const response = await fetch(`${apiBasePath}/content`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
              file: selectedFile,
              content: fileContent
            })
          });
          
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success(t('fileSaved') || 'Soubor uložen');
        } catch (error) {
          console.error('Error saving file:', error);
          toast.error(t('errorSavingFile') || 'Chyba při ukládání souboru');
          // Don't switch file if save failed
          return;
        }
      }
      // User chose to discard or save succeeded - continue with switching
    }
    
    // Clean up previous PDF blob URL
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    
    // Save selected file info
    setSelectedFile(file.path);
    setSelectedFileInfo(file);
    setIsEditing(false);
    
    // Notify parent
    if (onFileSelect) {
      onFileSelect(file);
    }
    
    // For images, don't load content - just display the image
    if (isImageFile(file.path)) {
      setFileContent('');
      return;
    }
    
    // For PDFs, fetch as blob and create object URL
    if (isPdfFile(file.path)) {
      try {
        setLoading(true);
        const response = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
        setFileContent('');
      } catch (error) {
        console.error('Error loading PDF:', error);
        toast.error(t('errorLoadingFileContent') || 'Chyba při načítání PDF');
      } finally {
        setLoading(false);
      }
      return;
    }
    
    // Check if file is text-based
    if (!file.isText && !isTextFile(file.path)) {
      setFileContent('');
      return;
    }
    
    try {
      setLoading(true);
      const response = await fetch(`${apiBasePath}/content?file=${encodeURIComponent(file.path)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      setFileContent(data.content || '');
      setOriginalContent(data.content || ''); // Track original for change detection
    } catch (error) {
      console.error('Error loading file content:', error);
      toast.error(t('errorLoadingFileContent') || 'Chyba při načítání obsahu souboru');
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, t, onFileSelect, toast, pdfBlobUrl, isEditing, fileContent, originalContent, selectedFile]);

  // Save file content
  const saveFileContent = useCallback(async () => {
    if (!selectedFile || readOnly) return;
    
    try {
      setLoading(true);
      const response = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          file: selectedFile,
          content: fileContent
        })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      setIsEditing(false);
      setOriginalContent(fileContent); // Update original content after successful save
      toast.success(t('fileSaved') || 'Soubor uložen');
    } catch (error) {
      console.error('Error saving file:', error);
      toast.error(t('errorSavingFile') || 'Chyba při ukládání souboru');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, fileContent, t, apiBasePath, readOnly, toast]);

  // Delete file
  const deleteFile = useCallback(async (filepath) => {
    if (!showDelete) return;
    if (!confirm(t('confirmDeleteFile') || `Opravdu smazat soubor "${filepath}"?`)) return;
    
    try {
      setLoading(true);
      await fetch(`${apiBasePath}?file=${encodeURIComponent(filepath)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      if (selectedFile === filepath) {
        setSelectedFile(null);
        setSelectedFileInfo(null);
        setFileContent('');
      }
      
      await loadFiles();
      toast.success(t('fileDeleted') || 'Soubor smazán');
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error(t('errorDeletingFile') || 'Chyba při mazání souboru');
    } finally {
      setLoading(false);
    }
  }, [selectedFile, loadFiles, t, apiBasePath, showDelete, toast]);

  // Download file
  const downloadFile = useCallback((filepath) => {
    const url = `${apiBasePath}/download?file=${encodeURIComponent(filepath)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filepath.split('/').pop();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [apiBasePath]);

  // Upload file (global - asks for folder)
  const handleFileUpload = useCallback(async (event) => {
    if (!showUpload) return;
    const file = event.target.files?.[0];
    // Reset the input value so the same file can be uploaded again
    event.target.value = '';
    
    if (!file) return;

    const formData = new FormData();
    
    // Optionally ask for path/folder
    const folder = prompt(t('enterFolderPath') || 'Zadejte cestu ke složce (např. workflows/ nebo prázdné pro root):', '');
    if (folder === null) return; // Cancelled
    
    if (folder) {
      formData.append('targetPath', folder);
    }

    formData.append('file', file);
    try {
      setLoading(true);
      await fetch(`${apiBasePath}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: formData
      });
      
      await loadFiles();
      toast.success(t('fileUploaded') || 'Soubor nahrán');
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error(t('errorUploadingFile') || 'Chyba při nahrávání souboru');
    } finally {
      setLoading(false);
    }
  }, [loadFiles, t, apiBasePath, showUpload, toast]);

  // Upload file to specific folder (no prompt needed)
  const handleFolderUpload = useCallback(async (event) => {
    if (!showUpload) return;
    const file = event.target.files?.[0];
    // Reset the input value so the same file can be uploaded again
    event.target.value = '';
    
    if (!file || !uploadTargetFolder) return;

    const formData = new FormData();
    
    // Use the target folder (unless it's root)
    if (uploadTargetFolder !== 'root') {
      formData.append('targetPath', uploadTargetFolder);
    }

    formData.append('file', file);
    try {
      setLoading(true);
      await fetch(`${apiBasePath}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: formData
      });
      
      await loadFiles();
      // Expand the folder where we uploaded
      setExpandedFolders(prev => ({ ...prev, [uploadTargetFolder]: true }));
      toast.success((t('fileUploadedToFolder') || 'Soubor nahrán do') + ` ${uploadTargetFolder}`);
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error(t('errorUploadingFile') || 'Chyba při nahrávání souboru');
    } finally {
      setLoading(false);
      setUploadTargetFolder(null);
    }
  }, [loadFiles, t, apiBasePath, showUpload, uploadTargetFolder, toast]);

  // Trigger folder-specific upload
  const triggerFolderUpload = useCallback((folder) => {
    setUploadTargetFolder(folder);
    // Use setTimeout to ensure state is set before click
    setTimeout(() => {
      folderUploadRef.current?.click();
    }, 0);
  }, []);

  // Drag & Drop upload to folder
  const handleDrop = useCallback(async (e, targetFolder) => {
    if (!showUpload) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    
    const droppedFiles = e.dataTransfer?.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    
    for (const file of droppedFiles) {
      const formData = new FormData();
      // Set target folder
      if (targetFolder && targetFolder !== 'root') {
        formData.append('targetPath', targetFolder);
      }
      
      formData.append('file', file);
      
      try {
        setLoading(true);
        await fetch(`${apiBasePath}/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          },
          body: formData
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        toast.error((t('errorUploadingFile') || 'Chyba při nahrávání souboru') + `: ${file.name}`);
      }
    }
    
    await loadFiles();
    setLoading(false);
    // Expand the folder where we uploaded
    setExpandedFolders(prev => ({ ...prev, [targetFolder]: true }));
    toast.success(t('filesUploaded') || `Nahráno ${droppedFiles.length} soubor(ů)`);
  }, [loadFiles, t, apiBasePath, showUpload, toast]);

  // Toggle folder expansion
  const toggleFolder = useCallback((folder) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folder]: !prev[folder]
    }));
  }, []);

  const handleDragOver = useCallback((e, folder) => {
    if (!showUpload) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(folder);
  }, [showUpload]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
  }, []);

  // Format modification date
  const formatModifiedDate = useCallback((dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('cs-CZ', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }, []);

  // Determine language for Monaco Editor based on file extension
  const editorLanguage = useMemo(() => {
    return getLanguageFromFilename(selectedFile);
  }, [selectedFile]);

  // Monaco Editor settings
  const editorOptions = useMemo(() => ({
    minimap: { enabled: true },
    fontSize: 13,
    fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    formatOnPaste: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    readOnly: readOnly || !isEditing,
  }), [isEditing, readOnly]);

  // Group files by folders
  const groupedFiles = files.reduce((acc, file) => {
    const parts = file.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(file);
    return acc;
  }, {});

  // Preview panel visibility
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div style={{ height: '100%', display: 'flex', gap: 12 }}>
      {/* LEFT: File browser */}
      <section
        style={{
          width: showPreview ? 380 : '100%', 
          minWidth: 320, 
          height: '100%',
          border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, overflow: 'auto', background: '#fff',
          flex: showPreview ? 'none' : 1
        }}
      >
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {title || t('files') || 'Soubory'}
          </h3>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={loadFiles}
              disabled={loading}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                background: '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              title={t('refresh') || 'Obnovit'}
            >
              ↻
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                background: showPreview ? '#6b7280' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
              title={showPreview ? (t('hidePreview') || 'Skrýt náhled') : (t('showPreview') || 'Zobrazit náhled')}
            >
              {showPreview ? '◀' : '▶'} {showPreview ? (t('hidePreview') || 'Skrýt') : (t('showPreview') || 'Náhled')}
            </button>
            {showUpload && (
              <>
                <button
                  className="btn btn-add"
                  onClick={() => document.getElementById('file-upload-input-' + apiBasePath.replace(/\//g, '-'))?.click()}
                  disabled={loading}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  + {t('upload') || 'Nahrát'}
                </button>
                <input
                  id={'file-upload-input-' + apiBasePath.replace(/\//g, '-')}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </>
            )}
          </div>
        </div>

        {loading && <div style={{ color: '#6b7280', fontSize: 13 }}>{t('loading')}</div>}

        {/* Hidden input for folder-specific upload */}
        {showUpload && (
          <input
            ref={folderUploadRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFolderUpload}
          />
        )}

        {Object.entries(groupedFiles).map(([folder, folderFiles]) => {
          const isExpanded = expandedFolders[folder] ?? false; // Default collapsed
          
          return (
            <div 
              key={folder} 
              style={{ marginBottom: 8 }}
              onDrop={(e) => handleDrop(e, folder)}
              onDragOver={(e) => handleDragOver(e, folder)}
              onDragLeave={handleDragLeave}
            >
              {/* Folder header */}
              <div style={{ 
                fontSize: 12, 
                fontWeight: 600, 
                color: '#374151', 
                padding: '6px 8px',
                borderBottom: '1px solid #e5e7eb',
                background: dragOverFolder === folder ? '#dbeafe' : '#f9fafb',
                borderRadius: 6,
                transition: 'background 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none'
              }}
              onClick={() => toggleFolder(folder)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ 
                    display: 'inline-block', 
                    transition: 'transform 0.2s',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                  }}>
                    ▶
                  </span>
                  📁 {folder}
                  <span style={{ 
                    fontSize: 10, 
                    color: '#6b7280',
                    background: '#e5e7eb',
                    padding: '1px 5px',
                    borderRadius: 8
                  }}>
                    {folderFiles.length}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {dragOverFolder === folder && showUpload && (
                    <span style={{ color: '#3b82f6', fontSize: 11 }}>
                      ⬆ {t('dropToUpload') || 'Přetáhněte'}
                    </span>
                  )}
                  {showUpload && (
                    <button
                      onClick={(e) => { e.stopPropagation(); triggerFolderUpload(folder); }}
                      disabled={loading}
                      style={{ 
                        fontSize: 10, 
                        padding: '2px 6px',
                        background: '#22c55e',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: loading ? 'not-allowed' : 'pointer'
                      }}
                      title={t('uploadHere') || 'Nahrát sem'}
                    >
                      + {t('uploadHere') || 'Nahrát sem'}
                    </button>
                  )}
                </div>
              </div>
              
              {/* Folder contents (collapsible) */}
              {isExpanded && folderFiles.map(file => (
                <div
                  key={file.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    paddingLeft: 24, // Indent for tree structure
                    borderRadius: 6,
                    background: selectedFile === file.path ? '#dbeafe' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: 2,
                    fontSize: 13,
                    opacity:1
                  }}
                  onClick={() => loadFileContent(file)}
                >
                  <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isImageFile(file.name) ? '🖼️' : isPdfFile(file.name) ? '📕' : (file.isText || isTextFile(file.name)) ? '📄' : '📦'} {file.name}
                    </div>
                    {showModificationDate && (file.mtime || file.size !== undefined) && (
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, display: 'flex', gap: 8 }}>
                        {file.size !== undefined && (
                          <span>📊 {formatFileSize(file.size)}</span>
                        )}
                        {file.mtime && (
                          <span>🕒 {formatModifiedDate(file.mtime)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-edit"
                      onClick={(e) => { e.stopPropagation(); downloadFile(file.path); }}
                      style={{ padding: '2px 6px', fontSize: 11 }}
                      title={t('download') || 'Stáhnout'}
                    >
                      ⬇
                    </button>
                    {showDelete && (
                      <button
                        className="btn btn-delete"
                        onClick={(e) => { e.stopPropagation(); deleteFile(file.path); }}
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        title={t('delete') || 'Smazat'}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {files.length === 0 && !loading && (
          <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
            {t('noFiles') || 'Žádné soubory'}
          </div>
        )}
      </section>

      {/* RIGHT: File editor - conditionally visible */}
      {showPreview && (
        <section
          style={{
            flex: 1, minWidth: 0, height: '100%',
            border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'flex', flexDirection: 'column'
          }}
        >
          {selectedFile && selectedFileInfo ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                    {selectedFile}
                  </div>
                  {(selectedFileInfo.size !== undefined || selectedFileInfo.mtime) && (
                    <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 8 }}>
                      {selectedFileInfo.size !== undefined && (
                        <span>📊 {formatFileSize(selectedFileInfo.size)}</span>
                    )}
                    {selectedFileInfo.mtime && (
                      <span>🕒 {formatModifiedDate(selectedFileInfo.mtime)}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(selectedFileInfo.isText || isTextFile(selectedFile)) && !readOnly && isEditing ? (
                  <>
                    <button
                      className="btn btn-add"
                      onClick={saveFileContent}
                      disabled={loading}
                    >
                      {t('save') || 'Uložit'}
                    </button>
                    <button
                      className="btn btn-cancel"
                      onClick={() => { setIsEditing(false); loadFileContent(selectedFileInfo); }}
                      disabled={loading}
                    >
                      {t('cancel') || 'Zrušit'}
                    </button>
                  </>
                ) : (selectedFileInfo.isText || isTextFile(selectedFile)) && !readOnly ? (
                  <button
                    className="btn btn-edit"
                    onClick={() => setIsEditing(true)}
                    disabled={loading}
                  >
                    {t('edit') || 'Upravit'}
                  </button>
                ) : null}
              </div>
            </div>

            {isImageFile(selectedFile) ? (
              /* Image preview */
              <div style={{ 
                flex: 1, 
                border: '1px solid #e5e7eb', 
                borderRadius: 6, 
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f8fafc',
                padding: 16
              }}>
                <img 
                  src={`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`}
                  alt={selectedFile}
                  style={{ 
                    maxWidth: '100%', 
                    maxHeight: '100%', 
                    objectFit: 'contain',
                    borderRadius: 4,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }}
                />
                <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => downloadFile(selectedFile)}
                    style={{
                      padding: '8px 16px',
                      background: '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    ⬇ {t('download') || 'Stáhnout'}
                  </button>
                  {showDelete && (
                    <button
                      onClick={() => deleteFile(selectedFile)}
                      style={{
                        padding: '8px 16px',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 13
                      }}
                    >
                      🗑 {t('delete') || 'Smazat'}
                    </button>
                  )}
                </div>
              </div>
            ) : isPdfFile(selectedFile) ? (
              /* PDF preview */
              <div style={{ 
                flex: 1, 
                border: '1px solid #e5e7eb', 
                borderRadius: 6, 
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                background: '#f8fafc'
              }}>
                {pdfBlobUrl ? (
                  <embed
                    src={pdfBlobUrl}
                    type="application/pdf"
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 400
                    }}
                  />
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
                    {t('loading') || 'Načítání...'}
                  </div>
                )}
                <div style={{ padding: 12, display: 'flex', gap: 12, justifyContent: 'center', borderTop: '1px solid #e5e7eb' }}>
                  <button
                    onClick={() => downloadFile(selectedFile)}
                    style={{
                      padding: '8px 16px',
                      background: '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    ⬇ {t('download') || 'Stáhnout'}
                  </button>
                  <button
                    onClick={() => pdfBlobUrl && window.open(pdfBlobUrl, '_blank')}
                    disabled={!pdfBlobUrl}
                    style={{
                      padding: '8px 16px',
                      background: pdfBlobUrl ? '#6b7280' : '#d1d5db',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: pdfBlobUrl ? 'pointer' : 'not-allowed',
                      fontSize: 13
                    }}
                  >
                    🔗 {t('openInNewTab') || 'Otevřít v nové záložce'}
                  </button>
                  {showDelete && (
                    <button
                      onClick={() => deleteFile(selectedFile)}
                      style={{
                        padding: '8px 16px',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 13
                      }}
                    >
                      🗑 {t('delete') || 'Smazat'}
                    </button>
                  )}
                </div>
              </div>
            ) : (selectedFileInfo.isText || isTextFile(selectedFile)) ? (
              <div style={{ 
                flex: 1, 
                border: '1px solid #e5e7eb', 
                borderRadius: 6, 
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column'
              }}>
                {/* Editor toolbar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: editorTheme === 'vs' ? '#f5f5f5' : '#1e1e1e',
                  borderBottom: `1px solid ${editorTheme === 'vs' ? '#e5e7eb' : '#333'}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Language indicator */}
                    <span style={{
                      background: 'rgba(59, 130, 246, 0.2)',
                      color: editorTheme === 'vs' ? '#1d4ed8' : '#60a5fa',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      textTransform: 'uppercase'
                    }}>
                      {editorLanguage}
                    </span>
                    
                    {readOnly && (
                      <span style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#dc2626',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        textTransform: 'uppercase'
                      }}>
                        {t('readOnly') || 'Pouze pro čtení'}
                      </span>
                    )}
                    
                    {/* Theme selector */}
                    <select
                      value={editorTheme}
                      onChange={(e) => handleThemeChange(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: `1px solid ${editorTheme === 'vs' ? '#d1d5db' : '#555'}`,
                        background: editorTheme === 'vs' ? '#fff' : '#333',
                        color: editorTheme === 'vs' ? '#374151' : '#e5e7eb',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      {availableThemes.map(theme => (
                        <option key={theme.value} value={theme.value}>
                          🎨 {theme.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Open in new window button */}
                  <button
                    onClick={openInNewWindow}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      color: editorTheme === 'vs' ? '#374151' : '#e5e7eb',
                      border: `1px solid ${editorTheme === 'vs' ? '#d1d5db' : '#555'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    title={'Open in new window'}
                  >
                    ↗ {t('newWindow') || 'New window'}
                  </button>
                </div>
                
                {/* Monaco Editor */}
                <div style={{ flex: 1 }}>
                  <Editor
                    height="100%"
                    language={editorLanguage}
                    value={fileContent}
                    onChange={(value) => setFileContent(value || '')}
                    options={editorOptions}
                    theme={editorTheme}
                    loading={
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        height: '100%',
                        color: '#6b7280'
                      }}>
                        {t('loading') || 'Načítání editoru...'}
                      </div>
                    }
                  />
                </div>
              </div>
            ) : (
              <div style={{ 
                flex: 1,
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center',
                color: '#6b7280',
                gap: 16
              }}>
                <div style={{ fontSize: 64 }}>📦</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {t('binaryFile') || 'Binární soubor'}
                </div>
                <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
                  {t('binaryFileDescription') || 'Tento soubor je binární a nelze jej zobrazit. Můžete jej stáhnout nebo smazat.'}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button
                    onClick={() => downloadFile(selectedFile)}
                    style={{
                      padding: '8px 16px',
                      background: '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    ⬇ {t('download') || 'Stáhnout'}
                  </button>
                  {showDelete && (
                    <button
                      onClick={() => deleteFile(selectedFile)}
                      style={{
                        padding: '8px 16px',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 13
                      }}
                    >
                      🗑 {t('delete') || 'Smazat'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            color: '#6b7280',
            fontSize: 14
          }}>
            {t('selectFileToView') || 'Vyberte soubor pro zobrazení'}
          </div>
        )}
        </section>
      )}
    </div>
  );
}
