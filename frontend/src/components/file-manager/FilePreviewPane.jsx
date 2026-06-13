/**
 * FilePreviewPane — right column of FileManagerEditor.
 * Shows: filename, size, mtime, Edit / Save / Cancel + Download / Delete buttons,
 * then the actual preview (Monaco editor, image, PDF, or binary placeholder).
 */
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeEditor from '../CodeEditor.jsx';
import { getLanguageFromFilename, isImageFile, isPdfFile, isOfficeEditableFile, isTextFile, formatFileSize, formatModifiedDate, isMarkdownFile, openOfficeEditor } from './fileUtils.js';
import { filePreviewButtons as fpBtn, fileItemButtons as fiBtn, shadow, fileLocking as lockCfg } from '../../lib/uiConfig.js';

/* ── tiny action button for folder panel ────────────────────────────────────── */
const FBtn = ({ title, onClick, bg = '#6b7280', children, disabled }) => (
  <button
    title={title}
    onClick={onClick}
    disabled={disabled}
    style={{
      fontSize: 11, padding: '4px 10px', background: disabled ? '#d1d5db' : bg, color: 'white',
      border: 'none', borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
      whiteSpace: 'nowrap', boxShadow: disabled ? 'none' : shadow.small,
    }}
  >{children}</button>
);

/* ── Folder detail panel ─────────────────────────────────────────────────────── */
function FolderDetailPanel({
  folder, isFolderBackupIgnored, folderSharedWith, users, isLabOwner, loading,
  onNewFile, onNewFolder, onCopy, onUpload, onDownloadZip,
  onRename, onDelete, onCreateSync, onToggleBackup, onShare, onPrompt,
}) {
  const [pendingShareIds, setPendingShareIds] = useState(null);

  // Reset pending edits when folder changes
  useEffect(() => {
    setPendingShareIds(null);
  }, [folder?.path]);

  const currentSharedWith = pendingShareIds ?? (folderSharedWith || []);

  const toggleUser = useCallback((userId) => {
    const cur = pendingShareIds ?? (folderSharedWith || []);
    const id = String(userId);
    if (cur.map(String).includes(id)) {
      setPendingShareIds(cur.filter(x => String(x) !== id));
    } else {
      setPendingShareIds([...cur, id]);
    }
  }, [pendingShareIds, folderSharedWith]);

  const handleSaveShare = useCallback(() => {
    onShare?.(folder.path, currentSharedWith.map(String));
    setPendingShareIds(null);
  }, [onShare, folder?.path, currentSharedWith]);

  const isRoot = folder?.isRoot;

  return (
    <section style={{
      flex: 1, minWidth: 0, height: '100%', border: '1px solid #e5e7eb',
      borderRadius: 12, padding: 16, background: '#fff',
      display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{isRoot ? '📂' : '📁'}</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{folder.name}</div>
          {folder.path && <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{folder.path}</div>}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {onNewFile && (
          <FBtn title={fiBtn.newFile.label} bg={fiBtn.newFile.bg} disabled={loading} onClick={async () => {
            const name = await onPrompt?.({ title: 'Create file', message: 'New file name:', placeholder: 'file.txt', confirmText: 'Create', cancelText: 'Cancel' });
            if (name) onNewFile((isRoot ? '' : folder.path + '/') + name);
          }}>{fiBtn.newFile.icon} New File</FBtn>
        )}
        {onNewFolder && (
          <FBtn title={fiBtn.newFolder.label} bg={fiBtn.newFolder.bg} disabled={loading} onClick={async () => {
            const name = await onPrompt?.({ title: 'Create folder', message: 'New folder name:', placeholder: 'new-folder', confirmText: 'Create', cancelText: 'Cancel' });
            if (name) onNewFolder((isRoot ? '' : folder.path + '/') + name);
          }}>{fiBtn.newFolder.icon} New Folder</FBtn>
        )}
        {onCopy && folder.path && (
          <FBtn title={fiBtn.copyFolder.label} bg={fiBtn.copyFolder.bg} onClick={() => onCopy(folder.path)}>{fiBtn.copyFolder.icon} Copy</FBtn>
        )}
        {onUpload && (
          <FBtn title={fiBtn.uploadHere.label} bg={fiBtn.uploadHere.bg} disabled={loading} onClick={() => onUpload(isRoot ? '.' : folder.path)}>{fiBtn.uploadHere.icon} Upload</FBtn>
        )}
        <FBtn title={fiBtn.downloadZip.label} bg={fiBtn.downloadZip.bg} disabled={loading} onClick={() => onDownloadZip?.(isRoot ? '.' : folder.path)}>{fiBtn.downloadZip.icon} Download ZIP</FBtn>
        {!isRoot && onRename && (
          <FBtn title={fiBtn.renameFolder.label} bg={fiBtn.renameFolder.bg} disabled={loading} onClick={async () => {
            const newName = await onPrompt?.({ title: 'Rename folder', message: 'New name:', defaultValue: folder.name, confirmText: 'Rename', cancelText: 'Cancel' });
            if (newName && newName !== folder.name) {
              const parts = folder.path.split('/');
              parts[parts.length - 1] = newName;
              onRename(folder.path, parts.join('/'));
            }
          }}>{fiBtn.renameFolder.icon} Rename</FBtn>
        )}
        {!isRoot && onDelete && (
          <FBtn title={fiBtn.deleteFolder.label} bg={fiBtn.deleteFolder.bg} disabled={loading} onClick={() => onDelete(folder.path)}>{fiBtn.deleteFolder.icon} Delete</FBtn>
        )}
        {!isRoot && onCreateSync && (
          <FBtn title={fiBtn.createSync.label} bg={fiBtn.createSync.bg} disabled={loading} onClick={() => onCreateSync(folder.path)}>{fiBtn.createSync.icon} Sync Config</FBtn>
        )}
        {!isRoot && onToggleBackup && (
          <FBtn
            title={isFolderBackupIgnored ? 'Include in backup' : 'Exclude from backup'}
            bg={isFolderBackupIgnored ? '#0f766e' : '#92400e'}
            disabled={loading}
            onClick={() => onToggleBackup(folder.path, !isFolderBackupIgnored)}
          >{isFolderBackupIgnored ? 'B+ Include' : 'B- Exclude'}</FBtn>
        )}
      </div>

      {/* Share panel — always visible for lab owners (non-root folders only) */}
      {!isRoot && isLabOwner && onShare && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#111827' }}>Share outside the lab with users</div>
          {(!users || users.length === 0) ? (
            <div style={{ color: '#9ca3af', fontSize: 12 }}>No other users.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {users.map(u => {
                const checked = currentSharedWith.map(String).includes(String(u.id));
                return (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '3px 0' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleUser(u.id)} />
                    <span>{u.firstName} {u.lastName}</span>
                    <span style={{ color: '#9ca3af', fontSize: 11 }}>{u.email}</span>
                  </label>
                );
              })}
            </div>
          )}
          {pendingShareIds !== null && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <FBtn bg="#059669" onClick={handleSaveShare}>Save</FBtn>
              <FBtn bg="#6b7280" onClick={() => setPendingShareIds(null)}>Cancel</FBtn>
            </div>
          )}
          {currentSharedWith.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
              Shared with {currentSharedWith.length} user{currentSharedWith.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function FilePreviewPane({
  selectedFile,
  selectedFileInfo,
  apiBasePath,
  fileContent,
  pdfBlobUrl,
  imageBlobUrl,
  isEditing,
  isDirty = false,
  loading,
  readOnly,
  editorTheme,
  showDelete,
  previewRefreshKey = 0,
  // Folder selection (when a folder is clicked in the browser pane)
  selectedFolder,
  isFolderBackupIgnored,
  folderSharedWith,
  users,
  isLabOwner,
  onFolderNewFile,
  onFolderNewFolder,
  onFolderCopy,
  onFolderUpload,
  onFolderDownloadZip,
  onFolderRename,
  onFolderDelete,
  onFolderCreateSync,
  onFolderToggleBackup,
  onFolderShare,
  onFolderPrompt,
  // actions
  onEdit,
  onSave,
  onCancel,
  onContentChange,
  onThemeChange,
  onOpenInNewWindow,
  onDownloadFile,
  onUnpackArchive,
  onDeleteFile,
  onAnalyze,
  csvPreviewMaxRows,
  previewMaxFileSize,
  // File locking
  fileLocks,
  isReadonlyFile,
  onReleaseLock,
  onRequestLock,
  officeSessions,
  onSyncOfficeFile,
}) {

  // Flash effect: set to true when previewRefreshKey changes, auto-clears after animation
  const [flash, setFlash] = useState(false);
  const [officePreviewRevision, setOfficePreviewRevision] = useState(0);
  const [officeRefreshing, setOfficeRefreshing] = useState(false);
  useEffect(() => {
    if (previewRefreshKey === 0) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [previewRefreshKey]);

  useEffect(() => {
    setOfficePreviewRevision(0);
    setOfficeRefreshing(false);
  }, [selectedFile]);

  const editorLanguage = useMemo(() => getLanguageFromFilename(selectedFile), [selectedFile]);

  // Lock state for the current file
  const lockInfo = fileLocks?.[selectedFile];
  const isLockedByMe = lockInfo && lockInfo.isMe;
  const isLockedByOther = lockInfo && !lockInfo.isMe;
  const fileIsReadonly = isReadonlyFile?.(selectedFile);

  const editorReadOnly = readOnly || fileIsReadonly || isLockedByOther;

  // CSV/TSV preview truncation — only in read-only / non-editing mode
  const isCsvLike = selectedFile && /\.(csv|tsv)$/i.test(selectedFile);
  const { displayContent, totalRows, truncated } = useMemo(() => {
    const maxRows = csvPreviewMaxRows;
    if (!isCsvLike || !maxRows || isEditing || !fileContent) {
      return { displayContent: fileContent, totalRows: 0, truncated: false };
    }
    const lines = fileContent.split('\n');
    // Remove trailing empty line caused by trailing newline
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    const dataRows = lines.length - 1; // subtract header
    const limit = maxRows + 1; // header + maxRows data lines
    if (lines.length <= limit) {
      return { displayContent: fileContent, totalRows: dataRows, truncated: false };
    }
    return {
      displayContent: lines.slice(0, limit).join('\n'),
      totalRows: dataRows,
      truncated: true,
    };
  }, [fileContent, isCsvLike, csvPreviewMaxRows, isEditing]);

  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  if (selectedFolder) {
    return (
      <FolderDetailPanel
        folder={selectedFolder}
        isFolderBackupIgnored={isFolderBackupIgnored}
        folderSharedWith={folderSharedWith}
        users={users}
        isLabOwner={isLabOwner}
        loading={loading}
        onNewFile={onFolderNewFile}
        onNewFolder={onFolderNewFolder}
        onCopy={onFolderCopy}
        onUpload={onFolderUpload}
        onDownloadZip={onFolderDownloadZip}
        onRename={onFolderRename}
        onDelete={onFolderDelete}
        onCreateSync={onFolderCreateSync}
        onToggleBackup={onFolderToggleBackup}
        onShare={onFolderShare}
        onPrompt={onFolderPrompt}
      />
    );
  }

  if (!selectedFile || !selectedFileInfo) {
    return (
      <section style={{ flex: 1, minWidth: 0, height: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14 }}>
        {'Select a file or folder to view'}
      </section>
    );
  }

  const isText = selectedFileInfo.isText || isTextFile(selectedFile);
  const isImg = isImageFile(selectedFile);
  const isPdf = isPdfFile(selectedFile);
  const isOfficeEditable = isOfficeEditableFile(selectedFile);
  //const isMarkdown = selectedFile && /\.md$/i.test(selectedFile);
  const isMarkdown = isMarkdownFile(selectedFile);
  const showMarkdownPreview = isMarkdown && !isEditing;

  const canEdit = isText && !readOnly && !fileIsReadonly && !isLockedByOther;
  const canUnpackArchive = Boolean(onUnpackArchive)
    && !readOnly
    && /\.(zip|gz|gzip|tgz)$/i.test(selectedFile || '');

  // Large file guard — skip Monaco for files exceeding the configured limit
  const maxSize = previewMaxFileSize || 1048576;
  const fileTooLarge = isText && !isMarkdown && selectedFileInfo.size > maxSize;
  const officeSession = selectedFile ? officeSessions?.[selectedFile] : null;
  const officeEditors = officeSession?.users || [];
  const isOfficeEdited = officeEditors.length > 0;

  const openOffice = (targetMode) => {
    if (!apiBasePath || !selectedFile) return;
    openOfficeEditor(apiBasePath, selectedFile, targetMode);
  };

  const refreshOfficePreview = async () => {
    if (!selectedFile) return;
    setOfficeRefreshing(true);
    try {
      await onSyncOfficeFile?.(selectedFile, { silent: true });
      setOfficePreviewRevision((v) => v + 1);
    } finally {
      setOfficeRefreshing(false);
    }
  };

  const officeMode = (!readOnly && !fileIsReadonly) ? 'edit' : 'view';
  const officeBtnCfg = officeMode === 'edit' ? fpBtn.officeEdit : fpBtn.officeView;

  return (
    <section style={{
      flex: 1, minWidth: 0, height: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'flex', flexDirection: 'column',
      boxShadow: flash ? '0 0 0 3px #3b82f6, inset 0 0 12px rgba(59,130,246,0.15)' : 'none',
      transition: 'box-shadow 0.3s ease-out',
    }}>
      {/* Lock status banners */}
      {fileIsReadonly && (
        <div style={{
          padding: '6px 12px', marginBottom: 8, borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: lockCfg.readonlyBg, border: `1px solid ${lockCfg.readonlyColor}`, color: lockCfg.readonlyColor,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {lockCfg.readonlyIcon} This file is read-only and cannot be edited
        </div>
      )}
      {isLockedByMe && isEditing && (
        <div style={{
          padding: '6px 12px', marginBottom: 8, borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: lockCfg.ownerBannerBg, border: `1px solid ${lockCfg.ownerBannerBorder}`, color: lockCfg.ownerBannerColor,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>{lockCfg.crownIcon}</span>
          <span>You have exclusive editing access</span>
          <button
            onClick={() => { onReleaseLock?.(selectedFile); onCancel?.(); }}
            style={{
              marginLeft: 'auto', padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
              background: lockCfg.releaseBtn.bg, color: lockCfg.releaseBtn.color, boxShadow: shadow.small,
            }}
            title={'Release exclusive access'}
          >
            {lockCfg.releaseBtn.icon} Unlock
          </button>
        </div>
      )}
      {isLockedByOther && (
        <div style={{
          padding: '6px 12px', marginBottom: 8, borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: lockCfg.lockedBannerBg, border: `1px solid ${lockCfg.lockedBannerBorder}`, color: lockCfg.lockedBannerColor,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>{lockCfg.lockIcon}</span>
          <span>Locked by {lockInfo.userName || lockInfo.userEmail || 'another user'}</span>
          <button
            onClick={() => onRequestLock?.(selectedFile)}
            style={{
              marginLeft: 'auto', padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
              background: lockCfg.requestBtn.bg, color: lockCfg.requestBtn.color, boxShadow: shadow.small,
            }}
            title={'Request exclusive access'}
          >
            {lockCfg.requestBtn.icon} Request access
          </button>
        </div>
      )}

      {/* Toolbar: file name, meta, action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{selectedFile}</div>
          {(selectedFileInfo.size !== undefined || selectedFileInfo.mtime) && (
            <div style={{
              fontSize: 12, color: '#6b7280', display: 'flex', gap: 8,
              background: flash ? '#dbeafe' : 'transparent',
              padding: '2px 6px', borderRadius: 4,
              transition: 'background 0.3s ease-out',
            }}>
              {selectedFileInfo.size !== undefined && <span>📊 {formatFileSize(selectedFileInfo.size)}</span>}
              {selectedFileInfo.mtime && <span>🕒 {formatModifiedDate(selectedFileInfo.mtime)}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Edit / Save / Cancel */}
          {canEdit && isEditing ? (
            <>
              <button
                className="btn"
                onClick={onSave}
                disabled={loading || !isDirty}
                style={{
                  padding: '4px 10px',
                  background: fpBtn.save.bg,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: loading || !isDirty ? 'not-allowed' : 'pointer',
                  opacity: loading || !isDirty ? 0.65 : 1,
                  fontSize: 12,
                  boxShadow: shadow.small,
                }}
              >
                {fpBtn.save.icon} {fpBtn.save.label}
              </button>
              <button
                className="btn"
                onClick={onCancel}
                disabled={loading}
                style={{ padding: '4px 10px', background: fpBtn.cancel.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              >
                {fpBtn.cancel.icon} {fpBtn.cancel.label}
              </button>
            </>
          ) : canEdit && !isEditing ? (
            <button
              className="btn"
              onClick={onEdit}
              disabled={loading}
              style={{ padding: '4px 10px', background: fpBtn.edit.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
            >
              {fpBtn.edit.icon} {fpBtn.edit.label}
            </button>
          ) : null}
          {isOfficeEditable && (
            <button
              onClick={() => openOffice(officeMode)}
              style={{ padding: '4px 10px', background: officeBtnCfg.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              title={officeBtnCfg.label}
            >
              {officeMode === 'edit' ? (
                <>✏ Edit</>
              ) : (
                <>{officeBtnCfg.icon} {officeBtnCfg.label}</>
              )}
            </button>
          )}
          {isOfficeEditable && !readOnly && (
            <button
              onClick={refreshOfficePreview}
              disabled={officeRefreshing}
              style={{
                padding: '4px 10px',
                background: fpBtn.officeRefresh.bg,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: officeRefreshing ? 'not-allowed' : 'pointer',
                opacity: officeRefreshing ? 0.7 : 1,
                fontSize: 12,
                boxShadow: shadow.small,
              }}
              title={fpBtn.officeRefresh.label}
            >
              {officeRefreshing ? '⏳' : fpBtn.officeRefresh.icon} {fpBtn.officeRefresh.label}
            </button>
          )}
          {/* Download */}
          <button
            onClick={() => onDownloadFile(selectedFile)}
            style={{ padding: '4px 10px', background: fpBtn.download.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
            title={fpBtn.download.label}
          >
            {fpBtn.download.icon} {fpBtn.download.label}
          </button>
          {canUnpackArchive && (
            <button
              onClick={() => onUnpackArchive(selectedFile)}
              disabled={loading}
              style={{
                padding: '4px 10px',
                background: fpBtn.unpack.bg,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                boxShadow: shadow.small,
                opacity: loading ? 0.65 : 1,
              }}
              title={fpBtn.unpack.label}
            >
              {fpBtn.unpack.icon} {fpBtn.unpack.label}
            </button>
          )}
          {/* Analyze — CSV, JSON, TSV files only */}
          {onAnalyze && /\.(csv|json|tsv)$/i.test(selectedFile) && (
            <button
              onClick={() => onAnalyze(selectedFile)}
              style={{ padding: '4px 10px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              title="Open in Data Explorer"
            >
              � Analyze
            </button>
          )}
          {/* Delete */}
          {showDelete && (
            <button
              onClick={() => onDeleteFile(selectedFile)}
              style={{ padding: '4px 10px', background: fpBtn.delete.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              title={fpBtn.delete.label}
            >
              {fpBtn.delete.icon} {fpBtn.delete.label}
            </button>
          )}
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div style={{ padding: '8px 0', color: '#6b7280', fontSize: 12, textAlign: 'center' }}>Loading...</div>
      )}

      {/* Content area */}
      {isImg ? (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 16 }}>
          {imageBlobUrl ? (
            <img
              src={imageBlobUrl}
              alt={selectedFile}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            />
          ) : (
            <div style={{ color: '#6b7280' }}>Loading...</div>
          )}
        </div>
      ) : isPdf ? (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
          {pdfBlobUrl ? (
            <embed src={pdfBlobUrl} type="application/pdf" style={{ flex: 1, width: '100%', minHeight: 400 }} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              Loading...
            </div>
          )}
        </div>
      ) : isText && fileTooLarge ? (
        /* Large file — info card instead of Monaco */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280', gap: 16, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f8fafc' }}>
          <div style={{ fontSize: 64 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>{selectedFile.split('/').pop()}</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>
            {formatFileSize(selectedFileInfo.size)} · {editorLanguage}
          </div>
          <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
            This file is too large for inline preview ({formatFileSize(previewMaxFileSize || 1048576)} limit).
            Double-click the file in the browser to open it in a dedicated tab for editing.
          </div>
          <button
            onClick={() => onDownloadFile(selectedFile)}
            style={{ padding: '6px 16px', background: fpBtn.download.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, boxShadow: shadow.small }}
          >
            {fpBtn.download.icon} {fpBtn.download.label}
          </button>
        </div>
      ) : isText ? (
        showMarkdownPreview ? (
          /* Rendered Markdown preview */
          <div
            className="markdown-preview-pane"
            style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'auto', background: '#fff', padding: '20px 28px', lineHeight: 1.7, fontSize: 14 }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeKatex]}
              components={{
                h1: ({ children }) => <h1 style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: 8, marginTop: 24, marginBottom: 12, fontSize: 28, fontWeight: 700 }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 6, marginTop: 20, marginBottom: 10, fontSize: 22, fontWeight: 600 }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: 18, fontWeight: 600 }}>{children}</h3>,
                p: ({ children }) => <p style={{ marginTop: 0, marginBottom: 12 }}>{children}</p>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>{children}</a>,
                code: ({ inline, children }) => {
                  if (inline) return <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: "'Fira Code', monospace" }}>{children}</code>;
                  return (
                    <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13, lineHeight: 1.5, fontFamily: "'Fira Code', monospace" }}>
                      <code>{children}</code>
                    </pre>
                  );
                },
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '4px solid #3b82f6', margin: '12px 0', padding: '8px 16px', background: '#eff6ff', color: '#1e40af', borderRadius: '0 6px 6px 0' }}>{children}</blockquote>,
                table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '12px 0', fontSize: 13 }}>{children}</table>,
                th: ({ children }) => <th style={{ border: '1px solid #d1d5db', padding: '8px 12px', background: '#f3f4f6', fontWeight: 600, textAlign: 'left' }}>{children}</th>,
                td: ({ children }) => <td style={{ border: '1px solid #d1d5db', padding: '8px 12px' }}>{children}</td>,
                ul: ({ children }) => <ul style={{ paddingLeft: 24, marginTop: 0, marginBottom: 12 }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ paddingLeft: 24, marginTop: 0, marginBottom: 12 }}>{children}</ol>,
                li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #d1d5db', margin: '20px 0' }} />,
                img: ({ src, alt }) => <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />,
              }}
            >
              {fileContent || ''}
            </ReactMarkdown>
          </div>
        ) : (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {/* Editor toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px',
            background: editorTheme === 'vs' ? '#f5f5f5' : '#1e1e1e',
            borderBottom: `1px solid ${editorTheme === 'vs' ? '#e5e7eb' : '#333'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ background: 'rgba(59,130,246,0.2)', color: editorTheme === 'vs' ? '#1d4ed8' : '#60a5fa', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
                {editorLanguage}
              </span>
              {(readOnly || fileIsReadonly) && (
                <span style={{ background: 'rgba(239,68,68,0.2)', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
                  Read only
                </span>
              )}
              {isLockedByMe && isEditing && (
                <span style={{ background: 'rgba(245,158,11,0.2)', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
                  {lockCfg.crownIcon} Exclusive
                </span>
              )}
              {isLockedByOther && (
                <span style={{ background: 'rgba(239,68,68,0.2)', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
                  {lockCfg.lockIcon} {lockInfo.userName || lockInfo.userEmail || ''}
                </span>
              )}
              <select
                value={editorTheme}
                onChange={(e) => onThemeChange(e.target.value)}
                style={{
                  padding: '4px 8px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${editorTheme === 'vs' ? '#d1d5db' : '#555'}`,
                  background: editorTheme === 'vs' ? '#fff' : '#333',
                  color: editorTheme === 'vs' ? '#374151' : '#e5e7eb',
                }}
              >
                {availableThemes.map((th) => <option key={th.value} value={th.value}>🎨 {th.label}</option>)}
              </select>
            </div>
            <button
              onClick={onOpenInNewWindow}
              style={{
                padding: '4px 10px', background: 'transparent',
                color: editorTheme === 'vs' ? '#374151' : '#e5e7eb',
                border: `1px solid ${editorTheme === 'vs' ? '#d1d5db' : '#555'}`,
                borderRadius: 4, cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              title="Open in new window"
            >
              ↗ New window
            </button>
          </div>
          {truncated && (
            <div style={{
              padding: '4px 10px', background: '#fef3c7', color: '#92400e', fontSize: 12,
              borderBottom: `1px solid ${editorTheme === 'vs' ? '#e5e7eb' : '#333'}`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              ⚠️ Showing {csvPreviewMaxRows} of {totalRows} rows. Open in a tab or use <strong>🔍 Analyze</strong> for full data.
            </div>
          )}
          {truncated ? (
            /* Truncated CSV — readonly HTML table */
            <CsvTablePreview content={displayContent} />
          ) : (
          <div style={{ flex: 1 }}>
            <CodeEditor
              key={selectedFile}
              value={fileContent}
              language={editorLanguage}
              theme={editorTheme}
              readOnly={editorReadOnly}
              onChange={editorReadOnly ? undefined : (value) => onContentChange(value || '')}
              onSave={isDirty ? onSave : undefined}
            />
          </div>
          )}
        </div>
        )
      ) : isOfficeEditable ? (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {isOfficeEdited && (
            <>
              <style>{`@keyframes measure-live-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
              <div style={{
                padding: '5px 10px',
                borderBottom: '1px solid #bbf7d0',
                fontSize: 12,
                color: '#166534',
                background: '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0,
                  animation: 'measure-live-pulse 1.4s ease-in-out infinite',
                }} />
                <span>{officeEditors.map((u) => u.name || u.email || u.id).join(', ')}</span>
              </div>
            </>
          )}
          <div style={{ flex: 1, minHeight: 0, background: '#f8fafc' }}>
            <iframe
              key={`${selectedFile}:${officePreviewRevision}`}
              title={`Office preview ${selectedFile}`}
              src={`/office-editor.html?apiBasePath=${encodeURIComponent(apiBasePath)}&file=${encodeURIComponent(selectedFile)}&mode=view&embed=1`}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        </div>
      ) : (
        /* Binary file */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280', gap: 16 }}>
          <div style={{ fontSize: 64 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Binary file</div>
          <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
            This file is binary and cannot be displayed. You can download or delete it.
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Simple CSV/TSV table preview (readonly) ────────────────────────────────── */
function CsvTablePreview({ content }) {
  const rows = useMemo(() => {
    if (!content) return [];
    const lines = content.split('\n').filter(l => l.trim());
    const sep = content.includes('\t') ? '\t' : ',';
    return lines.map(line => {
      const cells = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === sep && !inQuotes) { cells.push(cur); cur = ''; continue; }
        cur += ch;
      }
      cells.push(cur);
      return cells;
    });
  }, [content]);

  if (rows.length === 0) return null;
  const header = rows[0];
  const data = rows.slice(1);

  return (
    <div style={{ flex: 1, overflow: 'auto', fontSize: 12, fontFamily: "'Fira Code', monospace" }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{ position: 'sticky', top: 0, padding: '6px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', fontSize: 11 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f9fafb' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '4px 10px', border: '1px solid #e5e7eb', whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
