/**
 * useFileManager.js — custom hook encapsulating all file-manager state & actions.
 *
 * Keeps the raw tree from the API (items with type:'directory' / type:'file' and children[]).
 * Also maintains a flat file list (extracted from the tree) for backward compat.
 *
 * Returns: { tree, files, loading, selectedFile, selectedFileInfo, fileContent, originalContent,
 *            pdfBlobUrl, isEditing, expandedFolders,
 *            loadFiles, loadFileContent, saveFileContent, deleteFile, downloadFile,
 *            createNewFile, deleteFolderRecursive, downloadFolderZip,
 *            handleFileUpload, handleFolderUpload, triggerFolderUpload, handleDrop,
 *            toggleFolder, handleDragOver, handleDragLeave,
 *            pasteInto,
 *            setIsEditing, setFileContent, setDragOverFolder, dragOverFolder,
 *            folderUploadRef, apiBasePath }
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '../../lib/fetchJSON.js';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../Toast';
import { extractFiles, isImageFile, isPdfFile, isTextFile } from './fileUtils.js';

export default function useFileManager({
  apiBasePath,
  showUpload = true,
  showDelete = true,
  readOnly = false,
  onFileSelect,
  refreshTrigger = 0,
}) {
  const { t } = useLanguage();
  const toast = useToast();

  const [tree, setTree] = useState([]);           // raw tree from API
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileInfo, setSelectedFileInfo] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [imageBlobUrl, setImageBlobUrl] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [uploadTargetFolder, setUploadTargetFolder] = useState(null);
  const folderUploadRef = useRef(null);

  // Track file modification times for change detection
  const prevMtimesRef = useRef(new Map());
  const [changedFiles, setChangedFiles] = useState(new Set());
  // Counter incremented each time the preview is auto-refreshed (drives flash animation)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  // flat file list (derived from tree)
  const files = useMemo(() => extractFiles(tree), [tree]);

  // ---- load files (keeps tree) ----
  const loadFiles = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchJSON(apiBasePath);
      const newItems = data.items || [];
      setTree(newItems);

      // Build a new mtime map and detect changed files
      const newMtimes = new Map();
      const collectMtimes = (nodes) => {
        for (const n of (nodes || [])) {
          if (n.type === 'file' && n.mtime) newMtimes.set(n.path, n.mtime);
          if (n.type === 'directory' && n.children) collectMtimes(n.children);
        }
      };
      collectMtimes(newItems);

      const prev = prevMtimesRef.current;
      if (prev.size > 0) {
        const changed = new Set();
        for (const [path, mtime] of newMtimes) {
          const prevMtime = prev.get(path);
          if (!prevMtime) {
            // New file
            changed.add(path);
          } else if (prevMtime !== mtime) {
            // Modified file
            changed.add(path);
          }
        }
        if (changed.size > 0) {
          setChangedFiles(changed);
          // Auto-clear highlights after 15 seconds
          setTimeout(() => setChangedFiles(new Set()), 15000);
        }
      }
      prevMtimesRef.current = newMtimes;
    } catch {
      setTree([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBasePath]);

  useEffect(() => { loadFiles(); }, [loadFiles, refreshTrigger]);

  // Auto-poll file list every 5 seconds to detect external changes (sync agent, scripts, etc.)
  useEffect(() => {
    const id = setInterval(() => { loadFiles(true); }, 5000);
    return () => clearInterval(id);
  }, [loadFiles]);

  // Cleanup PDF/image blob on unmount
  useEffect(() => () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
  }, [pdfBlobUrl, imageBlobUrl]);

  // ---- load file content ----
  const loadFileContent = useCallback(async (file, forceLoad = false) => {
    if (!forceLoad && isEditing && fileContent !== originalContent && selectedFile && selectedFile !== file.path) {
      const msg = t('unsavedChangesConfirm') ||
        `File "${selectedFile}" has unsaved changes. Do you want to save them?\n\nSave = OK, Discard = Cancel`;
      if (confirm(msg)) {
        try {
          const r = await fetch(`${apiBasePath}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ file: selectedFile, content: fileContent }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          toast.success(t('fileSaved') || 'File saved');
        } catch {
          toast.error(t('errorSavingFile') || 'Error saving file');
          return;
        }
      }
    }

    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
    if (imageBlobUrl) { URL.revokeObjectURL(imageBlobUrl); setImageBlobUrl(null); }

    setSelectedFile(file.path);
    setSelectedFileInfo(file);
    setIsEditing(false);
    onFileSelect?.(file);

    if (isImageFile(file.path)) {
      try {
        setLoading(true);
        const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        });
        if (!r.ok) throw new Error();
        setImageBlobUrl(URL.createObjectURL(await r.blob()));
        setFileContent('');
      } catch {
        toast.error(t('errorLoadingFileContent') || 'Error loading image');
      } finally { setLoading(false); }
      return;
    }

    if (isPdfFile(file.path)) {
      try {
        setLoading(true);
        const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        });
        if (!r.ok) throw new Error();
        setPdfBlobUrl(URL.createObjectURL(await r.blob()));
        setFileContent('');
      } catch {
        toast.error(t('errorLoadingFileContent') || 'Error loading PDF');
      } finally { setLoading(false); }
      return;
    }

    if (!file.isText && !isTextFile(file.path)) { setFileContent(''); return; }

    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/content?file=${encodeURIComponent(file.path)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setFileContent(data.content || '');
      setOriginalContent(data.content || '');
    } catch {
      toast.error(t('errorLoadingFileContent') || 'Error loading file content');
    } finally { setLoading(false); }
  }, [apiBasePath, t, onFileSelect, toast, pdfBlobUrl, imageBlobUrl, isEditing, fileContent, originalContent, selectedFile]);

  // Auto-reload selected file content when it was modified externally (e.g. after workflow, sync agent)
  useEffect(() => {
    if (changedFiles.size === 0) return;

    // Show toast for all changed files
    const names = [...changedFiles].map(p => p.split('/').pop());
    const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    toast.success(`${t('filesChanged') || 'Files changed'}: ${label}`);

    // Update selectedFileInfo (mtime, size) from the fresh tree
    if (selectedFile && selectedFileInfo && changedFiles.has(selectedFile)) {
      const findInTree = (nodes, target) => {
        for (const n of (nodes || [])) {
          if (n.type === 'file' && n.path === target) return n;
          if (n.type === 'directory' && n.children) {
            const found = findInTree(n.children, target);
            if (found) return found;
          }
        }
        return null;
      };
      const updated = findInTree(tree, selectedFile);
      if (updated) setSelectedFileInfo(updated);
    }

    if (!selectedFile || !selectedFileInfo) return;
    if (!changedFiles.has(selectedFile)) return;
    if (isEditing) return; // don't overwrite user edits

    // Trigger preview flash animation
    setPreviewRefreshKey(k => k + 1);

    // Re-fetch the file content based on file type
    const authHeaders = { Authorization: `Bearer ${localStorage.getItem('authToken')}` };

    if (isTextFile(selectedFile) || selectedFileInfo.isText) {
      fetch(`${apiBasePath}/content?file=${encodeURIComponent(selectedFile)}`, { headers: authHeaders })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(data => {
          setFileContent(data.content || '');
          setOriginalContent(data.content || '');
        })
        .catch(() => { /* ignore */ });
    } else if (isImageFile(selectedFile)) {
      fetch(`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`, { headers: authHeaders })
        .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
        .then(blob => {
          if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
          setImageBlobUrl(URL.createObjectURL(blob));
        })
        .catch(() => { /* ignore */ });
    } else if (isPdfFile(selectedFile)) {
      fetch(`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`, { headers: authHeaders })
        .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
        .then(blob => {
          if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
          setPdfBlobUrl(URL.createObjectURL(blob));
        })
        .catch(() => { /* ignore */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedFiles]);

  // ---- save ----
  const saveFileContent = useCallback(async () => {
    if (!selectedFile || readOnly) return;
    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ file: selectedFile, content: fileContent }),
      });
      if (!r.ok) throw new Error();
      setOriginalContent(fileContent);
      toast.success(t('fileSaved') || 'File saved');
    } catch {
      toast.error(t('errorSavingFile') || 'Error saving file');
    } finally { setLoading(false); }
  }, [selectedFile, fileContent, t, apiBasePath, readOnly, toast]);

  // ---- delete file ----
  const deleteFile = useCallback(async (filepath) => {
    if (!showDelete) return;
    if (!confirm(t('confirmDeleteFile') || `Are you sure you want to delete file "${filepath}"?`)) return;
    try {
      setLoading(true);
      await fetch(`${apiBasePath}?file=${encodeURIComponent(filepath)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (selectedFile === filepath) { setSelectedFile(null); setSelectedFileInfo(null); setFileContent(''); }
      await loadFiles();
      toast.success(t('fileDeleted') || 'File deleted');
    } catch {
      toast.error(t('errorDeletingFile') || 'Error deleting file');
    } finally { setLoading(false); }
  }, [selectedFile, loadFiles, t, apiBasePath, showDelete, toast]);

  // ---- download file ----
  const downloadFile = useCallback(async (filepath) => {
    try {
      const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(filepath)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filepath.split('/').pop();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('errorDownloadingFile') || 'Error downloading file');
    }
  }, [apiBasePath, toast, t]);

  // ---- create new empty file ----
  const createNewFile = useCallback(async (filePath) => {
    if (!filePath?.trim()) return;
    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ file: filePath.trim(), content: '' }),
      });
      if (!r.ok) {
        const formData = new FormData();
        const parts = filePath.trim().split('/');
        const name = parts.pop();
        const folder = parts.join('/');
        if (folder) formData.append('targetPath', folder);
        formData.append('file', new Blob([''], { type: 'text/plain' }), name);
        await fetch(`${apiBasePath}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
          body: formData,
        });
      }
      await loadFiles();
      toast.success(`File "${filePath}" created`);
    } catch {
      toast.error('Error creating file');
    } finally { setLoading(false); }
  }, [apiBasePath, loadFiles, toast]);

  // ---- create new folder ----
  const createNewFolder = useCallback(async (folderPath) => {
    if (!folderPath?.trim()) return;
    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ path: folderPath.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      await loadFiles();
      setExpandedFolders((p) => ({ ...p, [folderPath.trim()]: true }));
      toast.success(`Folder "${folderPath}" created`);
    } catch (e) {
      toast.error(`Error creating folder: ${e.message}`);
    } finally { setLoading(false); }
  }, [apiBasePath, loadFiles, toast]);

  // ---- rename (file or folder) ----
  const renameItem = useCallback(async (oldPath, newPath) => {
    if (!oldPath?.trim() || !newPath?.trim()) return;
    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ oldPath: oldPath.trim(), newPath: newPath.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      // Update selected file reference if it was the renamed item
      if (selectedFile === oldPath) {
        setSelectedFile(newPath.trim());
      } else if (selectedFile?.startsWith(oldPath + '/')) {
        setSelectedFile(selectedFile.replace(oldPath, newPath.trim()));
      }
      await loadFiles();
      toast.success(`Renamed "${oldPath}" → "${newPath}"`);
    } catch (e) {
      toast.error(`Error renaming: ${e.message}`);
    } finally { setLoading(false); }
  }, [apiBasePath, selectedFile, loadFiles, toast]);

  // ---- delete folder recursively ----
  const deleteFolderRecursive = useCallback(async (folder) => {
    if (!showDelete) return;
    if (!confirm(`Are you sure you want to delete folder "${folder}" and all its contents?`)) return;
    try {
      setLoading(true);
      await fetch(`${apiBasePath}/folder?path=${encodeURIComponent(folder)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (selectedFile?.startsWith(folder + '/') || selectedFile === folder) {
        setSelectedFile(null); setSelectedFileInfo(null); setFileContent('');
      }
      await loadFiles();
      toast.success(`Folder "${folder}" deleted`);
    } catch {
      toast.error('Error deleting folder');
    } finally { setLoading(false); }
  }, [apiBasePath, showDelete, selectedFile, loadFiles, toast]);

  // ---- download folder as zip ----
  const downloadFolderZip = useCallback(async (folder) => {
    try {
      const r = await fetch(`${apiBasePath}/folder/zip?path=${encodeURIComponent(folder)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folder.replace(/\//g, '_') || 'root'}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('errorDownloadingFolder') || 'Error downloading folder');
    }
  }, [apiBasePath, toast, t]);

  // ---- paste (from global clipboard) ----
  const pasteInto = useCallback(async (targetFolder, clipboardItem) => {
    if (!clipboardItem) return;
    try {
      setLoading(true);
      const r = await fetch('/api/v1/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({
          sourceApi: clipboardItem.apiBasePath,
          sourcePath: clipboardItem.path,
          targetApi: apiBasePath,
          targetFolder: targetFolder || '',
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      await loadFiles();
      if (targetFolder) setExpandedFolders((p) => ({ ...p, [targetFolder]: true }));
      toast.success('Pasted');
    } catch (e) {
      toast.error(`Error pasting: ${e.message}`);
    } finally { setLoading(false); }
  }, [apiBasePath, loadFiles, toast]);

  // ---- uploads ----
  const handleFileUpload = useCallback(async (event) => {
    if (!showUpload) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const folder = prompt(t('enterFolderPath') || 'Enter folder path (empty for root):', '');
    if (folder === null) return;
    const formData = new FormData();
    if (folder) formData.append('targetPath', folder);
    formData.append('file', file);
    try {
      setLoading(true);
      await fetch(`${apiBasePath}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: formData,
      });
      await loadFiles();
      toast.success(t('fileUploaded') || 'File uploaded');
    } catch {
      toast.error(t('errorUploadingFile') || 'Error uploading file');
    } finally { setLoading(false); }
  }, [loadFiles, t, apiBasePath, showUpload, toast]);

  const handleFolderUpload = useCallback(async (event) => {
    if (!showUpload) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !uploadTargetFolder) return;
    const formData = new FormData();
    if (uploadTargetFolder !== '.') formData.append('targetPath', uploadTargetFolder);
    formData.append('file', file);
    try {
      setLoading(true);
      await fetch(`${apiBasePath}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: formData,
      });
      await loadFiles();
      setExpandedFolders((p) => ({ ...p, [uploadTargetFolder]: true }));
      toast.success(`${t('fileUploadedToFolder') || 'File uploaded to'} ${uploadTargetFolder}`);
    } catch {
      toast.error(t('errorUploadingFile') || 'Error uploading file');
    } finally { setLoading(false); setUploadTargetFolder(null); }
  }, [loadFiles, t, apiBasePath, showUpload, uploadTargetFolder, toast]);

  const triggerFolderUpload = useCallback((folder) => {
    setUploadTargetFolder(folder);
    setTimeout(() => folderUploadRef.current?.click(), 0);
  }, []);

  const handleDrop = useCallback(async (e, targetFolder) => {
    if (!showUpload) return;
    e.preventDefault(); e.stopPropagation(); setDragOverFolder(null);
    const dropped = e.dataTransfer?.files;
    if (!dropped?.length) return;
    for (const file of dropped) {
      const formData = new FormData();
      if (targetFolder && targetFolder !== '.') formData.append('targetPath', targetFolder);
      formData.append('file', file);
      try {
        setLoading(true);
        await fetch(`${apiBasePath}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
          body: formData,
        });
      } catch {
        toast.error(`${t('errorUploadingFile') || 'Error'}: ${file.name}`);
      }
    }
    await loadFiles();
    setLoading(false);
    setExpandedFolders((p) => ({ ...p, [targetFolder]: true }));
    toast.success(t('filesUploaded') || `Uploaded ${dropped.length} file(s)`);
  }, [loadFiles, t, apiBasePath, showUpload, toast]);

  // ---- folder toggle ----
  const toggleFolder = useCallback((folder) => {
    setExpandedFolders((p) => ({ ...p, [folder]: !p[folder] }));
  }, []);

  const handleDragOver = useCallback((e, folder) => {
    if (!showUpload) return;
    e.preventDefault(); e.stopPropagation(); setDragOverFolder(folder);
  }, [showUpload]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragOverFolder(null);
  }, []);

  return {
    tree, files, loading, selectedFile, selectedFileInfo, fileContent, originalContent,
    pdfBlobUrl, imageBlobUrl, isEditing, expandedFolders, changedFiles, previewRefreshKey,
    dragOverFolder, folderUploadRef, apiBasePath,
    loadFiles, loadFileContent, saveFileContent, deleteFile, downloadFile,
    createNewFile, createNewFolder, renameItem, deleteFolderRecursive, downloadFolderZip,
    pasteInto,
    handleFileUpload, handleFolderUpload, triggerFolderUpload, handleDrop,
    toggleFolder, handleDragOver, handleDragLeave,
    setIsEditing, setFileContent, setDragOverFolder,
  };
}
