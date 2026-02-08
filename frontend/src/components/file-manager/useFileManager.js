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
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [uploadTargetFolder, setUploadTargetFolder] = useState(null);
  const folderUploadRef = useRef(null);

  // flat file list (derived from tree)
  const files = useMemo(() => extractFiles(tree), [tree]);

  // ---- load files (keeps tree) ----
  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJSON(apiBasePath);
      setTree(data.items || []);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [apiBasePath]);

  useEffect(() => { loadFiles(); }, [loadFiles, refreshTrigger]);

  // Cleanup PDF blob on unmount
  useEffect(() => () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); }, [pdfBlobUrl]);

  // ---- load file content ----
  const loadFileContent = useCallback(async (file, forceLoad = false) => {
    if (!forceLoad && isEditing && fileContent !== originalContent && selectedFile && selectedFile !== file.path) {
      const msg = t('unsavedChangesConfirm') ||
        `Soubor "${selectedFile}" má neuložené změny. Chcete je uložit?\n\nUložit = OK, Zahodit = Cancel`;
      if (confirm(msg)) {
        try {
          const r = await fetch(`${apiBasePath}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ file: selectedFile, content: fileContent }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          toast.success(t('fileSaved') || 'Soubor uložen');
        } catch {
          toast.error(t('errorSavingFile') || 'Chyba při ukládání souboru');
          return;
        }
      }
    }

    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }

    setSelectedFile(file.path);
    setSelectedFileInfo(file);
    setIsEditing(false);
    onFileSelect?.(file);

    if (isImageFile(file.path)) { setFileContent(''); return; }

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
        toast.error(t('errorLoadingFileContent') || 'Chyba při načítání PDF');
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
      toast.error(t('errorLoadingFileContent') || 'Chyba při načítání obsahu souboru');
    } finally { setLoading(false); }
  }, [apiBasePath, t, onFileSelect, toast, pdfBlobUrl, isEditing, fileContent, originalContent, selectedFile]);

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
      toast.success(t('fileSaved') || 'Soubor uložen');
    } catch {
      toast.error(t('errorSavingFile') || 'Chyba při ukládání souboru');
    } finally { setLoading(false); }
  }, [selectedFile, fileContent, t, apiBasePath, readOnly, toast]);

  // ---- delete file ----
  const deleteFile = useCallback(async (filepath) => {
    if (!showDelete) return;
    if (!confirm(t('confirmDeleteFile') || `Opravdu smazat soubor "${filepath}"?`)) return;
    try {
      setLoading(true);
      await fetch(`${apiBasePath}?file=${encodeURIComponent(filepath)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (selectedFile === filepath) { setSelectedFile(null); setSelectedFileInfo(null); setFileContent(''); }
      await loadFiles();
      toast.success(t('fileDeleted') || 'Soubor smazán');
    } catch {
      toast.error(t('errorDeletingFile') || 'Chyba při mazání souboru');
    } finally { setLoading(false); }
  }, [selectedFile, loadFiles, t, apiBasePath, showDelete, toast]);

  // ---- download file ----
  const downloadFile = useCallback((filepath) => {
    const link = document.createElement('a');
    link.href = `${apiBasePath}/download?file=${encodeURIComponent(filepath)}`;
    link.download = filepath.split('/').pop();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [apiBasePath]);

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
      toast.success(`Soubor "${filePath}" vytvořen`);
    } catch {
      toast.error('Chyba při vytváření souboru');
    } finally { setLoading(false); }
  }, [apiBasePath, loadFiles, toast]);

  // ---- delete folder recursively ----
  const deleteFolderRecursive = useCallback(async (folder) => {
    if (!showDelete) return;
    if (!confirm(`Opravdu smazat celou složku "${folder}" a vše v ní?`)) return;
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
      toast.success(`Složka "${folder}" smazána`);
    } catch {
      toast.error('Chyba při mazání složky');
    } finally { setLoading(false); }
  }, [apiBasePath, showDelete, selectedFile, loadFiles, toast]);

  // ---- download folder as zip ----
  const downloadFolderZip = useCallback((folder) => {
    const link = document.createElement('a');
    link.href = `${apiBasePath}/folder/zip?path=${encodeURIComponent(folder)}`;
    link.download = `${folder.replace(/\//g, '_')}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [apiBasePath]);

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
      toast.success('Vloženo');
    } catch (e) {
      toast.error(`Chyba při vkládání: ${e.message}`);
    } finally { setLoading(false); }
  }, [apiBasePath, loadFiles, toast]);

  // ---- uploads ----
  const handleFileUpload = useCallback(async (event) => {
    if (!showUpload) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const folder = prompt(t('enterFolderPath') || 'Zadejte cestu ke složce (prázdné pro root):', '');
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
      toast.success(t('fileUploaded') || 'Soubor nahrán');
    } catch {
      toast.error(t('errorUploadingFile') || 'Chyba při nahrávání souboru');
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
      toast.success(`${t('fileUploadedToFolder') || 'Soubor nahrán do'} ${uploadTargetFolder}`);
    } catch {
      toast.error(t('errorUploadingFile') || 'Chyba při nahrávání souboru');
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
        toast.error(`${t('errorUploadingFile') || 'Chyba'}: ${file.name}`);
      }
    }
    await loadFiles();
    setLoading(false);
    setExpandedFolders((p) => ({ ...p, [targetFolder]: true }));
    toast.success(t('filesUploaded') || `Nahráno ${dropped.length} soubor(ů)`);
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
    pdfBlobUrl, isEditing, expandedFolders,
    dragOverFolder, folderUploadRef, apiBasePath,
    loadFiles, loadFileContent, saveFileContent, deleteFile, downloadFile,
    createNewFile, deleteFolderRecursive, downloadFolderZip,
    pasteInto,
    handleFileUpload, handleFolderUpload, triggerFolderUpload, handleDrop,
    toggleFolder, handleDragOver, handleDragLeave,
    setIsEditing, setFileContent, setDragOverFolder,
  };
}
