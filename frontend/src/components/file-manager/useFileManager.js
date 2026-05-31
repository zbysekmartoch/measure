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
import { useToast } from '../Toast';
import { useDialog } from '../Dialog.jsx';
import { extractFiles, isImageFile, isPdfFile, isTextFile } from './fileUtils.js';

export default function useFileManager({
  apiBasePath,
  showUpload = true,
  showDelete = true,
  readOnly = false,
  onFileSelect,
  refreshTrigger = 0,
  previewMaxFileSize,
  pollingEnabled = true,
}) {
  const toast = useToast();
  const dialog = useDialog();

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
  const changedFilesClearTimeoutRef = useRef(null);
  const mtimeScopeRef = useRef(apiBasePath);
  const activeApiBasePathRef = useRef(apiBasePath);
  const loadFilesRequestIdRef = useRef(0);
  // Counter incremented each time the preview is auto-refreshed (drives flash animation)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  // ── File locking state ──────────────────────────────────────────────────────
  // fileLocks: { [filePath]: { userId, userEmail, userName, lockedAt, isMe } }
  const [fileLocks, setFileLocks] = useState({});
  // lockRequests: pending requests from others asking me to release
  const [lockRequests, setLockRequests] = useState([]);
  // heartbeat ref for refreshing lock TTL
  const lockHeartbeatRef = useRef(null);
  // Guards against out-of-order preview responses when rapidly switching files
  const previewRequestIdRef = useRef(0);
  const previewAbortRef = useRef(null);
  const autoRefreshRequestIdRef = useRef(0);
  const autoRefreshAbortRef = useRef(null);

  const clearPreviewBlobs = useCallback(() => {
    setPdfBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  /** Check if a file is readonly (path contains "readonly") */
  const isReadonlyFile = useCallback((filePath) => {
    return filePath && /readonly/i.test(filePath);
  }, []);

  /** Fetch all locks for our apiBasePath. */
  const loadLocks = useCallback(async () => {
    try {
      const data = await fetchJSON(`/api/v1/locks/list?apiBasePath=${encodeURIComponent(apiBasePath)}`);
      setFileLocks(data.locks || {});
    } catch { /* ignore */ }
  }, [apiBasePath]);

  /** Fetch lock requests directed at me. */
  const loadLockRequests = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/v1/locks/requests');
      setLockRequests(data.requests || []);
    } catch { /* ignore */ }
  }, []);

  /** Acquire exclusive lock on a file. Returns true on success. */
  const acquireFileLock = useCallback(async (filePath) => {
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
      await loadLocks();
      return true;
    } catch {
      toast.error('Error acquiring file lock');
      return false;
    }
  }, [apiBasePath, loadLocks, toast]);

  /** Release my lock on a file. */
  const releaseFileLock = useCallback(async (filePath) => {
    try {
      await fetch('/api/v1/locks/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, file: filePath }),
      });
      await loadLocks();
      return true;
    } catch {
      return false;
    }
  }, [apiBasePath, loadLocks]);

  /** Send a request to the lock holder asking them to release. */
  const requestFileLock = useCallback(async (filePath) => {
    try {
      const res = await fetch('/api/v1/locks/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, file: filePath }),
      });
      if (res.ok) {
        toast.success('Lock request sent');
      }
    } catch {
      toast.error('Error requesting lock');
    }
  }, [apiBasePath, toast]);

  /** Dismiss a lock request (I decline or handled it). */
  const dismissLockReq = useCallback(async (requestId) => {
    try {
      await fetch(`/api/v1/locks/requests/${requestId}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      await loadLockRequests();
    } catch { /* ignore */ }
  }, [loadLockRequests]);

  /** Refresh (heartbeat) the lock I hold while editing. */
  const refreshMyLock = useCallback(async (filePath) => {
    try {
      await fetch('/api/v1/locks/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ apiBasePath, file: filePath }),
      });
    } catch { /* ignore */ }
  }, [apiBasePath]);

  // Poll locks every 15 seconds
  useEffect(() => {
    if (!pollingEnabled) return;
    loadLocks();
    const id = setInterval(loadLocks, 15_000);
    return () => clearInterval(id);
  }, [loadLocks, pollingEnabled]);

  // Track latest scope so stale async responses (from previous apiBasePath) can be ignored.
  useEffect(() => {
    activeApiBasePathRef.current = apiBasePath;
  }, [apiBasePath]);

  // Cleanup deferred highlight clearing when unmounting.
  useEffect(() => () => {
    if (changedFilesClearTimeoutRef.current) {
      clearTimeout(changedFilesClearTimeoutRef.current);
    }
  }, []);

  // Heartbeat: while editing, periodically refresh the lock
  useEffect(() => {
    if (isEditing && selectedFile) {
      lockHeartbeatRef.current = setInterval(() => refreshMyLock(selectedFile), 60_000);
    }
    return () => { if (lockHeartbeatRef.current) clearInterval(lockHeartbeatRef.current); };
  }, [isEditing, selectedFile, refreshMyLock]);

  // flat file list (derived from tree)
  const files = useMemo(() => extractFiles(tree), [tree]);

  // ---- load files (keeps tree) ----
  const loadFiles = useCallback(async (silent = false) => {
    const requestId = ++loadFilesRequestIdRef.current;
    try {
      if (!silent) setLoading(true);
      const data = await fetchJSON(apiBasePath);
      if (requestId !== loadFilesRequestIdRef.current) return;
      if (activeApiBasePathRef.current !== apiBasePath) return;

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
      const isScopeChanged = mtimeScopeRef.current !== apiBasePath;

      if (isScopeChanged) {
        // Switched to a different file-root (e.g. another debug session):
        // treat current snapshot as baseline, not as "external file changes".
        mtimeScopeRef.current = apiBasePath;
        if (changedFilesClearTimeoutRef.current) {
          clearTimeout(changedFilesClearTimeoutRef.current);
          changedFilesClearTimeoutRef.current = null;
        }
        setChangedFiles(new Set());
      } else if (prev.size > 0) {
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
          if (changedFilesClearTimeoutRef.current) {
            clearTimeout(changedFilesClearTimeoutRef.current);
          }
          // Auto-clear highlights after 15 seconds
          changedFilesClearTimeoutRef.current = setTimeout(() => {
            setChangedFiles(new Set());
            changedFilesClearTimeoutRef.current = null;
          }, 15000);
        }
      }
      prevMtimesRef.current = newMtimes;
    } catch {
      if (activeApiBasePathRef.current === apiBasePath) {
        setTree([]);
      }
    } finally {
      if (!silent && requestId === loadFilesRequestIdRef.current && activeApiBasePathRef.current === apiBasePath) {
        setLoading(false);
      }
    }
  }, [apiBasePath]);

  useEffect(() => {
    if (!pollingEnabled) return;
    loadFiles();
  }, [loadFiles, refreshTrigger, pollingEnabled]);

  // Auto-poll file list every 15 seconds to detect external changes (sync agent, scripts, etc.)
  useEffect(() => {
    if (!pollingEnabled) return;
    const id = setInterval(() => { loadFiles(true); }, 15_000);
    return () => clearInterval(id);
  }, [loadFiles, pollingEnabled]);

  // Cleanup PDF/image blob on unmount
  useEffect(() => () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
  }, [pdfBlobUrl, imageBlobUrl]);

  // Abort in-flight preview refreshes on unmount
  useEffect(() => () => {
    previewAbortRef.current?.abort();
    autoRefreshAbortRef.current?.abort();
  }, []);

  // ---- load file content ----
  const loadFileContent = useCallback(async (file, forceLoad = false) => {
    if (!file?.path) return;

    const requestId = ++previewRequestIdRef.current;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const isCurrentRequest = () => previewRequestIdRef.current === requestId;

    if (!forceLoad && isEditing && fileContent !== originalContent && selectedFile && selectedFile !== file.path) {
      const shouldSave = await dialog.confirm({
        title: 'Unsaved changes',
        message: `File "${selectedFile}" has unsaved changes. Do you want to save them?`,
        confirmText: 'Save',
        cancelText: 'Discard',
        tone: 'warning',
      });

      if (shouldSave) {
        try {
          const r = await fetch(`${apiBasePath}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            body: JSON.stringify({ file: selectedFile, content: fileContent }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          toast.success('File saved');
        } catch {
          toast.error('Error saving file');
          return;
        }
      }
    }

    // Release lock on previous file when switching
    if (isEditing && selectedFile && selectedFile !== file.path) {
      releaseFileLock(selectedFile);
    }

    clearPreviewBlobs();

    setSelectedFile(file.path);
    setSelectedFileInfo(file);
    setFileContent('');
    setOriginalContent('');
    setIsEditing(false);
    onFileSelect?.(file);
    setLoading(true);

    if (isImageFile(file.path)) {
      try {
        const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
          signal: controller.signal,
        });
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        if (!isCurrentRequest()) return;
        setImageBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setFileContent('');
      } catch (e) {
        if (e?.name !== 'AbortError' && isCurrentRequest()) {
          toast.error('Error loading image');
        }
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
      return;
    }

    if (isPdfFile(file.path)) {
      try {
        const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(file.path)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
          signal: controller.signal,
        });
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        if (!isCurrentRequest()) return;
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setFileContent('');
      } catch (e) {
        if (e?.name !== 'AbortError' && isCurrentRequest()) {
          toast.error('Error loading PDF');
        }
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
      return;
    }

    if (!file.isText && !isTextFile(file.path)) {
      if (isCurrentRequest()) setLoading(false);
      return;
    }

    // Skip fetching content for files exceeding preview size limit
    if (previewMaxFileSize && file.size > previewMaxFileSize) {
      if (isCurrentRequest()) {
        setFileContent('');
        setOriginalContent('');
        setLoading(false);
      }
      return;
    }

    try {
      const r = await fetch(`${apiBasePath}/content?file=${encodeURIComponent(file.path)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        signal: controller.signal,
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!isCurrentRequest()) return;
      setFileContent(data.content || '');
      setOriginalContent(data.content || '');
    } catch (e) {
      if (e?.name !== 'AbortError' && isCurrentRequest()) {
        toast.error('Error loading file content');
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [
    apiBasePath,
    onFileSelect,
    toast,
    dialog,
    isEditing,
    fileContent,
    originalContent,
    selectedFile,
    releaseFileLock,
    previewMaxFileSize,
    clearPreviewBlobs,
  ]);

  // Auto-reload selected file content when it was modified externally (e.g. after workflow, sync agent)
  useEffect(() => {
    if (changedFiles.size === 0) return;

    // Show toast for all changed files
    const names = [...changedFiles].map(p => p.split('/').pop());
    const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    toast.success(`Files changed: ${label}`);

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
    const requestId = ++autoRefreshRequestIdRef.current;
    autoRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    autoRefreshAbortRef.current = controller;
    const isCurrentRequest = () => autoRefreshRequestIdRef.current === requestId;
    const authHeaders = { Authorization: `Bearer ${localStorage.getItem('authToken')}` };

    const refreshPreview = async () => {
      try {
        if (isTextFile(selectedFile) || selectedFileInfo.isText) {
          const r = await fetch(`${apiBasePath}/content?file=${encodeURIComponent(selectedFile)}`, {
            headers: authHeaders,
            signal: controller.signal,
          });
          if (!r.ok) throw new Error();
          const data = await r.json();
          if (!isCurrentRequest()) return;
          setFileContent(data.content || '');
          setOriginalContent(data.content || '');
          return;
        }

        if (isImageFile(selectedFile)) {
          const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`, {
            headers: authHeaders,
            signal: controller.signal,
          });
          if (!r.ok) throw new Error();
          const blob = await r.blob();
          if (!isCurrentRequest()) return;
          setImageBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          return;
        }

        if (isPdfFile(selectedFile)) {
          const r = await fetch(`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`, {
            headers: authHeaders,
            signal: controller.signal,
          });
          if (!r.ok) throw new Error();
          const blob = await r.blob();
          if (!isCurrentRequest()) return;
          setPdfBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          // Ignore transient refresh errors; user can still manually reload/open file.
        }
      }
    };

    refreshPreview();

    return () => {
      controller.abort();
    };
  }, [changedFiles, selectedFile, selectedFileInfo, isEditing, tree, apiBasePath, toast]);

  // ---- save ----
  const saveFileContent = useCallback(async () => {
    if (!selectedFile || readOnly) return;
    if (isReadonlyFile(selectedFile)) {
      toast.error('This file is read-only');
      return;
    }
    // Keep Save behavior consistent with tab editors: only save when dirty.
    if (fileContent === originalContent) return;
    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ file: selectedFile, content: fileContent }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data.error === 'readonly') {
          toast.error('This file is read-only');
          return;
        }
        throw new Error();
      }
      setOriginalContent(fileContent);
      toast.success('File saved');
    } catch {
      toast.error('Error saving file');
    } finally { setLoading(false); }
  }, [selectedFile, fileContent, originalContent, apiBasePath, readOnly, toast, isReadonlyFile]);

  // ---- delete file ----
  const deleteFile = useCallback(async (filepath) => {
    if (!showDelete) return;
    const shouldDelete = await dialog.confirm({
      title: 'Delete file',
      message: `Are you sure you want to delete file "${filepath}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      tone: 'danger',
    });
    if (!shouldDelete) return;
    try {
      setLoading(true);
      await fetch(`${apiBasePath}?file=${encodeURIComponent(filepath)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (selectedFile === filepath) { setSelectedFile(null); setSelectedFileInfo(null); setFileContent(''); }
      await loadFiles();
      toast.success('File deleted');
    } catch {
      toast.error('Error deleting file');
    } finally { setLoading(false); }
  }, [selectedFile, loadFiles, apiBasePath, showDelete, toast, dialog]);

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
      toast.error('Error downloading file');
    }
  }, [apiBasePath, toast]);

  const isUnpackableArchive = useCallback((filepath) => {
    return /\.(zip|gz|gzip|tgz)$/i.test(filepath || '');
  }, []);

  // ---- unpack ZIP/GZIP archive in place ----
  const unpackArchive = useCallback(async (filepath) => {
    if (!filepath || readOnly) return;
    if (!isUnpackableArchive(filepath)) {
      toast.error('Only ZIP/GZIP archives can be unpacked');
      return;
    }

    const shouldUnpack = await dialog.confirm({
      title: 'Unpack archive',
      message: `Unpack "${filepath}" here? Existing files may be overwritten.`,
      confirmText: 'Unpack',
      cancelText: 'Cancel',
      tone: 'warning',
    });
    if (!shouldUnpack) return;

    try {
      setLoading(true);
      const r = await fetch(`${apiBasePath}/unpack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({ file: filepath }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }

      await loadFiles();

      const extractedCount = Number.isFinite(data.extractedCount) ? data.extractedCount : 0;
      const skippedUnsafeCount = Number.isFinite(data.skippedUnsafeCount) ? data.skippedUnsafeCount : 0;
      const skippedSuffix = skippedUnsafeCount > 0 ? `, skipped ${skippedUnsafeCount} unsafe entr${skippedUnsafeCount === 1 ? 'y' : 'ies'}` : '';
      toast.success(`Unpacked ${extractedCount} item${extractedCount === 1 ? '' : 's'}${skippedSuffix}`);
    } catch (e) {
      toast.error(`Error unpacking archive: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, dialog, isUnpackableArchive, loadFiles, readOnly, toast]);

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
    const shouldDelete = await dialog.confirm({
      title: 'Delete folder',
      message: `Are you sure you want to delete folder "${folder}" and all its contents?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      tone: 'danger',
    });
    if (!shouldDelete) return;
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
  }, [apiBasePath, showDelete, selectedFile, loadFiles, toast, dialog]);

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
      toast.error('Error downloading folder');
    }
  }, [apiBasePath, toast]);

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
    const folder = await dialog.prompt({
      title: 'Upload destination',
      message: 'Enter folder path (empty for root):',
      defaultValue: '',
      placeholder: 'folder/subfolder',
      confirmText: 'Upload',
      cancelText: 'Cancel',
    });
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
      toast.success('File uploaded');
    } catch {
      toast.error('Error uploading file');
    } finally { setLoading(false); }
  }, [loadFiles, apiBasePath, showUpload, toast, dialog]);

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
      toast.success(`File uploaded to ${uploadTargetFolder}`);
    } catch {
      toast.error('Error uploading file');
    } finally { setLoading(false); setUploadTargetFolder(null); }
  }, [loadFiles, apiBasePath, showUpload, uploadTargetFolder, toast]);

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
        toast.error(`Error: ${file.name}`);
      }
    }
    await loadFiles();
    setLoading(false);
    setExpandedFolders((p) => ({ ...p, [targetFolder]: true }));
    toast.success(`Uploaded ${dropped.length} file(s)`);
  }, [loadFiles, apiBasePath, showUpload, toast]);

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
    unpackArchive,
    createNewFile, createNewFolder, renameItem, deleteFolderRecursive, downloadFolderZip,
    pasteInto,
    handleFileUpload, handleFolderUpload, triggerFolderUpload, handleDrop,
    toggleFolder, handleDragOver, handleDragLeave,
    setIsEditing, setFileContent, setDragOverFolder,
    // File locking
    fileLocks, lockRequests, isReadonlyFile,
    acquireFileLock, releaseFileLock, requestFileLock, dismissLockReq, loadLocks,
  };
}
