/**
 * FileBrowserPane — left column of FileManagerEditor.
 * Renders a proper recursive tree (directories with children).
 *
 * Features:
 *   - Root folder row with all actions (new file, new folder, paste, upload, zip, etc.)
 *   - Collapsible folders at any nesting depth with per-folder actions
 *   - Single click on file → preview; double click → open in separate tab
 *   - Copy / Paste buttons on files and folders (cross-instance via ClipboardContext)
 *   - Drag-and-drop upload into any folder
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { formatFileSize, fileIcon } from './fileUtils.js';
import { useFileClipboard } from './ClipboardContext.jsx';
import { useToast } from '../Toast';
import { useDialog } from '../Dialog.jsx';
import {
  shadow,
  fileBrowserButtons as fbBtn,
  fileItemButtons as fiBtn,
  fileLocking as lockCfg,
  fileBrowserGrouping as groupCfg,
} from '../../lib/uiConfig.js';

/* ── tiny icon-button helper ────────────────────────────────────────────────── */
const IBtn = ({ title, onClick, bg = '#6b7280', children, disabled, style: extra }) => (
  <button
    title={title}
    onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    disabled={disabled}
    style={{
      fontSize: 10, padding: '2px 6px', background: bg, color: 'white',
      border: 'none', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
      lineHeight: '16px', whiteSpace: 'nowrap',
      boxShadow: disabled ? 'none' : shadow.small,
      transition: 'box-shadow 0.15s, transform 0.15s',
      ...extra,
    }}
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.boxShadow = shadow.smallHover; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = disabled ? 'none' : shadow.small; e.currentTarget.style.transform = ''; }}
    onMouseDown={(e) => { if (!disabled) e.currentTarget.style.boxShadow = shadow.pressed; }}
    onMouseUp={(e) => { if (!disabled) e.currentTarget.style.boxShadow = shadow.smallHover; }}
  >{children}</button>
);

/* ── file grouping helpers ─────────────────────────────────────────────────── */
const compareByName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function extensionKey(filename) {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

function buildExtensionGroups(fileNodes) {
  const byExt = new Map();

  for (const f of fileNodes) {
    const ext = extensionKey(f.name);
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext).push(f);
  }

  const groups = [...byExt.entries()].map(([ext, groupFiles]) => ({
    ext,
    files: [...groupFiles].sort(compareByName),
  }));

  groups.sort((a, b) => {
    if (a.ext === b.ext) return 0;
    // Files without extension are shown last.
    if (!a.ext) return 1;
    if (!b.ext) return -1;
    return a.ext.localeCompare(b.ext, undefined, { numeric: true, sensitivity: 'base' });
  });

  return groups;
}

const extensionCategoryMap = (() => {
  const map = new Map();
  const categories = groupCfg.categoryExtensions || {};

  for (const [categoryName, extensions] of Object.entries(categories)) {
    if (!Array.isArray(extensions)) continue;
    for (const ext of extensions) {
      const key = String(ext || '').toLowerCase().trim();
      if (!key) continue;
      map.set(key, categoryName);
    }
  }

  return map;
})();

function groupColorForExtension(ext) {
  const key = (ext || '').toLowerCase();
  const categoryName = extensionCategoryMap.get(key) || 'other';
  return groupCfg.categoryColors?.[categoryName] || groupCfg.categoryColors?.other || '#111827';
}

function normalizeBackupPath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed === '.' || trimmed === '..') return '';
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return '';
  return parts.join('/');
}

function toScriptsBackupPath(folderPath) {
  const normalized = normalizeBackupPath(folderPath);
  if (!normalized) return '';
  return `scripts/${normalized}`;
}

/* ── recursive tree node (folder) ───────────────────────────────────────────── */
function FolderNode({
  node, depth, expandedFolders, selectedFile, dragOverFolder,
  showUpload, showDelete, showModificationDate, loading,
  onToggleFolder, onFileClick, onFileDoubleClick,
  onCreateNewFile, onCreateNewFolder,
  onTriggerFolderUpload, onDownloadFolderZip, onDeleteFolder,
  onDrop, onDragOver, onDragLeave,
  onCopyFile, onCopyFolder, onPasteInto, clipboard, apiBasePath,
  onDebugWorkflow, onRunWorkflow, onRename, changedFiles,
  onPublish, onCreateSync,
  isRoot,
  isBackupIgnored,
  groupByExtension,
  specialFolders,
  compactButtons,
  fileLocks, isReadonlyFile, onRequestLock,
  onUnlockFile, onUnlockFolder, labOwnerId, currentUserId,
  onToggleBackupIgnoreFolder,
  isFolderBackupIgnored,
  onPrompt,
}) {
  const [hovered, setHovered] = useState(false);
  const isExpanded = isRoot || (expandedFolders[node.path] ?? (depth === 0));
  const indent = depth * 16;
  const isSpecial = !isRoot && specialFolders?.some(sf => sf.toLowerCase() === node.name.toLowerCase());
  const folderRowBg = dragOverFolder === node.path
    ? '#dbeafe'
    : isBackupIgnored
      ? '#fff7ed'
      : isSpecial
        ? '#f5f3ff'
        : (depth === 0 ? '#f9fafb' : 'transparent');
  const folderHoverBg = isBackupIgnored ? '#ffedd5' : (isSpecial ? '#ede9fe' : '#f0f4ff');
  const folderNameColor = isBackupIgnored ? '#b45309' : (isSpecial ? '#7c3aed' : '#374151');

  // Count all files recursively in this folder
  const countFiles = (n) => {
    let c = 0;
    for (const ch of (n.children || [])) {
      if (ch.type === 'file') c++;
      else c += countFiles(ch);
    }
    return c;
  };

  return (
    <div
      onDrop={(e) => onDrop(e, node.path)}
      onDragOver={(e) => onDragOver(e, node.path)}
      onDragLeave={onDragLeave}
    >
      {/* Folder header row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 6px', paddingLeft: indent + 6,
          background: folderRowBg,
          borderRadius: 4, cursor: 'pointer', userSelect: 'none',
          borderBottom: depth === 0 ? '1px solid #e5e7eb' : 'none',
          borderLeft: isBackupIgnored ? '3px solid #f59e0b' : (isSpecial ? '3px solid #8b5cf6' : '3px solid transparent'),
          marginTop: depth === 0 ? 4 : 0,
          transition: 'background 0.1s',
        }}
        onClick={() => onToggleFolder(node.path)}
        onMouseEnter={(e) => { setHovered(true); if (dragOverFolder !== node.path) e.currentTarget.style.background = folderHoverBg; }}
        onMouseLeave={(e) => { setHovered(false); e.currentTarget.style.background = folderRowBg; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: folderNameColor, minWidth: 0 }}>
          <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 10 }}>▶</span>
          <span>{isSpecial ? '📦' : '📁'}</span>
          <span title={node.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          {isBackupIgnored && (
            <span title="Excluded from backup" style={{ fontSize: 9, color: '#b45309', background: '#ffedd5', padding: '0 4px', borderRadius: 6, flexShrink: 0 }}>
              NO BACKUP
            </span>
          )}

          <span style={{ fontSize: 9, color: '#9ca3af', background: '#e5e7eb', padding: '0 4px', borderRadius: 6, flexShrink: 0 }}>
            {countFiles(node)}
          </span>
        </div>
        <div style={{ alignItems: 'center', gap: 2, flexShrink: 0, display: compactButtons && !hovered ? 'none' : 'flex' }}>
          {dragOverFolder === node.path && showUpload && (
            <span style={{ color: '#3b82f6', fontSize: 10 }}>⬆</span>
          )}
          <IBtn
            title={fiBtn.newFile.label}
            onClick={async () => {
              const prefix = isRoot ? '' : (node.path + '/');
              const name = await onPrompt({
                title: 'Create file',
                message: 'New file name:',
                defaultValue: '',
                placeholder: 'file.txt',
                confirmText: 'Create',
                cancelText: 'Cancel',
              });
              if (name) onCreateNewFile(prefix + name);
            }}
            bg={fiBtn.newFile.bg} disabled={loading}
          >{fiBtn.newFile.icon}</IBtn>
          <IBtn
            title={fiBtn.newFolder.label}
            onClick={async () => {
              const prefix = isRoot ? '' : (node.path + '/');
              const name = await onPrompt({
                title: 'Create folder',
                message: 'New folder name:',
                defaultValue: '',
                placeholder: 'new-folder',
                confirmText: 'Create',
                cancelText: 'Cancel',
              });
              if (name) onCreateNewFolder(prefix + name);
            }}
            bg={fiBtn.newFolder.bg} disabled={loading}
          >{fiBtn.newFolder.icon}</IBtn>
          <IBtn title={fiBtn.copyFolder.label} onClick={() => onCopyFolder(node.path)} bg={fiBtn.copyFolder.bg}>{fiBtn.copyFolder.icon}</IBtn>
          {clipboard && (
            <IBtn title={fiBtn.pasteInto.label} onClick={() => onPasteInto(isRoot ? '' : node.path)} bg={fiBtn.pasteInto.bg}>{fiBtn.pasteInto.icon}</IBtn>
          )}
          {showUpload && (
            <IBtn title={fiBtn.uploadHere.label} onClick={() => onTriggerFolderUpload(isRoot ? '.' : node.path)} bg={fiBtn.uploadHere.bg} disabled={loading}>{fiBtn.uploadHere.icon}</IBtn>
          )}
          <IBtn title={fiBtn.downloadZip.label} onClick={() => onDownloadFolderZip(isRoot ? '.' : node.path)} bg={fiBtn.downloadZip.bg} disabled={loading}>{fiBtn.downloadZip.icon}</IBtn>
          {!isRoot && (
            <IBtn title={fiBtn.renameFolder.label} onClick={async () => {
              const newName = await onPrompt({
                title: 'Rename folder',
                message: 'New name:',
                defaultValue: node.name,
                confirmText: 'Rename',
                cancelText: 'Cancel',
              });
              if (newName && newName !== node.name) {
                const parts = node.path.split('/');
                parts[parts.length - 1] = newName;
                onRename(node.path, parts.join('/'));
              }
            }} bg={fiBtn.renameFolder.bg} disabled={loading}>{fiBtn.renameFolder.icon}</IBtn>
          )}
          {showDelete && !isRoot && (
            <IBtn title={fiBtn.deleteFolder.label} onClick={() => onDeleteFolder(node.path)} bg={fiBtn.deleteFolder.bg} disabled={loading}>{fiBtn.deleteFolder.icon}</IBtn>
          )}
          {onPublish && !isRoot && (
            <IBtn title="Publish to current output" onClick={() => onPublish(node.path)} bg="#7c3aed" disabled={loading}>📤</IBtn>
          )}
          {onCreateSync && !isRoot && (
            <IBtn title={fiBtn.createSync.label} onClick={() => onCreateSync(node.path)} bg={fiBtn.createSync.bg} disabled={loading}>{fiBtn.createSync.icon}</IBtn>
          )}
          {onToggleBackupIgnoreFolder && !isRoot && (
            <IBtn
              title={isBackupIgnored ? 'Include in backup' : 'Exclude from backup'}
              onClick={() => onToggleBackupIgnoreFolder(node.path, !isBackupIgnored)}
              bg={isBackupIgnored ? '#0f766e' : '#92400e'}
              disabled={loading}
            >{isBackupIgnored ? 'B+' : 'B-'}</IBtn>
          )}
          {/* Unlock all locked files in this folder */}
          {onUnlockFolder && (() => {
            const hasLocks = Object.entries(fileLocks || {}).some(([fp, lk]) =>
              (node.path === '' || fp.startsWith(node.path + '/')) && (lk.isMe || String(labOwnerId) === String(currentUserId))
            );
            if (!hasLocks) return null;
            const isOwner = String(labOwnerId) === String(currentUserId);
            return (
              <IBtn
                title={isOwner ? 'Unlock all in folder' : 'Unlock my files in folder'}
                onClick={() => onUnlockFolder(node.path)}
                bg="#dc2626"
                disabled={loading}
              >U</IBtn>
            );
          })()}
        </div>
      </div>

      {/* Children — files first (optionally grouped by extension), then subdirectories */}
      {isExpanded && (() => {
        const children = [...(node.children || [])];
        const fileChildren = children.filter((c) => c.type === 'file').sort(compareByName);
        const dirChildren = children.filter((c) => c.type === 'directory').sort(compareByName);
        const groupInset = depth * 16 + 10;

        const renderFileRow = (child, indentForGroup = 0) => (
          <FileRow
            key={child.path}
            file={child}
            depth={depth + 1}
            indentOffset={indentForGroup}
            isSelected={selectedFile === child.path}
            showModificationDate={showModificationDate}
            onClick={onFileClick}
            onDoubleClick={onFileDoubleClick}
            onCopy={onCopyFile}
            onDebugWorkflow={onDebugWorkflow}
            onRunWorkflow={onRunWorkflow}
            onRename={onRename}
            isChanged={changedFiles?.has(child.path)}
            onPublish={onPublish}
            compactButtons={compactButtons}
            lockInfo={fileLocks?.[child.path]}
            isReadonly={isReadonlyFile?.(child.path)}
            onRequestLock={onRequestLock}
            onUnlockFile={onUnlockFile}
            labOwnerId={labOwnerId}
            currentUserId={currentUserId}
            onPrompt={onPrompt}
          />
        );

        return (
          <>
            {groupByExtension
              ? buildExtensionGroups(fileChildren).map((group, idx) => (
                <div
                  key={`${node.path || '__root__'}::${group.ext || '__noext__'}`}
                  style={{
                    marginTop: idx === 0 ? 3 : 7,
                    marginBottom: 2,
                    marginLeft: groupInset,
                    border: `1px solid ${groupCfg.borderColor || '#e5e7eb'}`,
                    borderLeft: `${groupCfg.borderLeftWidth || 5}px solid ${groupColorForExtension(group.ext)}`,
                    borderRadius: 6,
                    background: 'transparent',
                    overflow: 'hidden',
                  }}
                >
                  {group.files.map((f) => renderFileRow(f, groupInset))}
                </div>
              ))
              : fileChildren.map(renderFileRow)}

            {dirChildren.map((child) => (
              <FolderNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                selectedFile={selectedFile}
                dragOverFolder={dragOverFolder}
                showUpload={showUpload}
                showDelete={showDelete}
                showModificationDate={showModificationDate}
                loading={loading}
                onToggleFolder={onToggleFolder}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
                onCreateNewFile={onCreateNewFile}
                onCreateNewFolder={onCreateNewFolder}
                onTriggerFolderUpload={onTriggerFolderUpload}
                onDownloadFolderZip={onDownloadFolderZip}
                onDeleteFolder={onDeleteFolder}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onCopyFile={onCopyFile}
                onCopyFolder={onCopyFolder}
                onPasteInto={onPasteInto}
                clipboard={clipboard}
                apiBasePath={apiBasePath}
                onDebugWorkflow={onDebugWorkflow}
                onRunWorkflow={onRunWorkflow}
                onRename={onRename}
                changedFiles={changedFiles}
                onPublish={onPublish}
                onCreateSync={onCreateSync}
                isBackupIgnored={isFolderBackupIgnored?.(child.path)}
                groupByExtension={groupByExtension}
                specialFolders={specialFolders}
                compactButtons={compactButtons}
                fileLocks={fileLocks}
                isReadonlyFile={isReadonlyFile}
                onRequestLock={onRequestLock}
                onUnlockFile={onUnlockFile}
                onUnlockFolder={onUnlockFolder}
                labOwnerId={labOwnerId}
                currentUserId={currentUserId}
                onToggleBackupIgnoreFolder={onToggleBackupIgnoreFolder}
                isFolderBackupIgnored={isFolderBackupIgnored}
                onPrompt={onPrompt}
              />
            ))}
          </>
        );
      })()}
    </div>
  );
}

/* ── file row ───────────────────────────────────────────────────────────────── */
function FileRow({ file, depth, indentOffset = 0, isSelected, showModificationDate, onClick, onDoubleClick, onCopy, onDebugWorkflow, onRunWorkflow, onRename, isChanged, onPublish, compactButtons, lockInfo, isReadonly, onRequestLock, onUnlockFile, labOwnerId, currentUserId, onPrompt }) {
  const [hovered, setHovered] = useState(false);
  const indent = Math.max(4, depth * 16 + 12 - indentOffset);
  const isEnvironmentJson = file.name?.toLowerCase() === 'environment.json';
  const isWorkflow = file.name?.endsWith('.workflow');
  const isRunnableScript = /\.(py|js|cjs|r)$/i.test(file.name);
  const isDebuggable = isWorkflow || isRunnableScript;
  const isLockedByOther = lockInfo && !lockInfo.isMe;
  const isLockedByMe = lockInfo && lockInfo.isMe;
  const changedBg = '#fef9c3';  // light yellow for changed files
//  const environmentBg = '#ffedd5';
//  const environmentHoverBg = '#fed7aa';
  const baseBg = isSelected ? '#dbeafe'
    : isReadonly ? lockCfg.readonlyBg
    : isLockedByOther ? lockCfg.lockedRowBg
  //  : isEnvironmentJson ? environmentBg
    : isChanged ? changedBg
    : 'transparent';
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 6px', paddingLeft: indent,
        borderRadius: 4,
        background: baseBg,
        borderLeft: isReadonly ? `3px solid ${lockCfg.readonlyColor}`
          : isLockedByOther ? `3px solid ${lockCfg.lockedRowBorder}`
          : isLockedByMe ? '3px solid #f59e0b'
    //      : isEnvironmentJson ? '3px solid #ea580c'
          : isChanged ? '3px solid #eab308'
          : '3px solid transparent',
        cursor: 'pointer', fontSize: 12,
        transition: 'background 0.3s, border-color 0.3s',
      }}
      onClick={() => onClick(file)}
      onDoubleClick={() => onDoubleClick?.(file)}
      onMouseEnter={(e) => {
        setHovered(true);
        if (!isSelected) {
          e.currentTarget.style.background = isChanged
            ? '#fef08a'
 //           : isEnvironmentJson
 //             ? environmentHoverBg
              : '#f5f7fa';
        }
      }}
      onMouseLeave={(e) => { setHovered(false); e.currentTarget.style.background = baseBg; }}
    >
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{fileIcon(file.name)}</span>
        <span
          title={file.path || file.name}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isReadonly
              ? lockCfg.readonlyColor
              : isEnvironmentJson
                ? '#134da3'
                : undefined,
            fontWeight: isEnvironmentJson ? 700 : undefined,
          }}
        >
          {file.name}
        </span>
        {isReadonly && (
          <span title="Read-only" style={{ fontSize: 10, flexShrink: 0, cursor: 'default' }}>{lockCfg.readonlyIcon}</span>
        )}
        {isLockedByMe && (
          <span title="Locked by you (exclusive)" style={{ fontSize: 10, flexShrink: 0, cursor: 'default' }}>{lockCfg.crownIcon}</span>
        )}
        {isLockedByOther && (
          <span
            title={`Locked by ${lockInfo.userName || lockInfo.userEmail || 'another user'}`}
            style={{ fontSize: 10, flexShrink: 0, cursor: 'default' }}
          >{lockCfg.lockIcon}</span>
        )}
        {showModificationDate && file.size !== undefined && (
          <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0 }}>{formatFileSize(file.size)}</span>
        )}
      </div>
      <div style={{  gap: 2, flexShrink: 0, display: compactButtons && !hovered ? 'none' : 'flex' }}>
        {onDoubleClick && (
          <IBtn title={fiBtn.openInTab.label} onClick={(e) => { e.stopPropagation(); onDoubleClick(file); }} bg={fiBtn.openInTab.bg}>{fiBtn.openInTab.icon}</IBtn>
        )}
        {isDebuggable && onDebugWorkflow && (
          <IBtn title={fiBtn.debugWorkflow.label} onClick={() => onDebugWorkflow(file.path)} bg={fiBtn.debugWorkflow.bg}>{fiBtn.debugWorkflow.icon}</IBtn>
        )}
        {(isWorkflow || isRunnableScript) && onRunWorkflow && (
          <IBtn title={fiBtn.runWorkflow.label} onClick={() => onRunWorkflow(file.path)} bg={fiBtn.runWorkflow.bg}>{fiBtn.runWorkflow.icon}</IBtn>
        )}
        <IBtn title={fiBtn.renameFile.label} onClick={async () => {
          const newName = await onPrompt({
            title: 'Rename file',
            message: 'New name:',
            defaultValue: file.name,
            confirmText: 'Rename',
            cancelText: 'Cancel',
          });
          if (newName && newName !== file.name) {
            const parts = file.path.split('/');
            parts[parts.length - 1] = newName;
            onRename(file.path, parts.join('/'));
          }
        }} bg={fiBtn.renameFile.bg}>{fiBtn.renameFile.icon}</IBtn>
        <IBtn title={fiBtn.copyFile.label} onClick={() => onCopy(file.path)} bg={fiBtn.copyFile.bg}>{fiBtn.copyFile.icon}</IBtn>
        <IBtn title="Copy link" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(file.path); }} bg="#6b7280">L</IBtn>
        {onPublish && (
          <IBtn title="Publish to current output" onClick={() => onPublish(file.path)} bg="#7c3aed">📤</IBtn>
        )}
        {/* Unlock button for locked files */}
        {lockInfo && (lockInfo.isMe || String(labOwnerId) === String(currentUserId)) && onUnlockFile && (
          <IBtn
            title={lockInfo.isMe ? 'Release lock' : `Request Lock release (${lockInfo.userName || lockInfo.userEmail || 'other'})`}
            onClick={() => {
              if (lockInfo.isMe || String(labOwnerId) === String(currentUserId)) {
                onUnlockFile(file.path);
              } else {
                onRequestLock?.(file.path);
              }
            }}
            bg="#dc2626"
          >U</IBtn>
        )}
        {lockInfo && !lockInfo.isMe && String(labOwnerId) !== String(currentUserId) && onRequestLock && (
          <IBtn
            title={`Request Lock release (${lockInfo.userName || lockInfo.userEmail || 'other'})`}
            onClick={() => onRequestLock(file.path)}
            bg="#f59e0b"
          >U</IBtn>
        )}
      </div>
    </div>
  );
}

/* ── main export ────────────────────────────────────────────────────────────── */
export default function FileBrowserPane({
  title,
  loading,
  tree,
  files,           // flat list — used only for "no files" check
  expandedFolders,
  selectedFile,
  dragOverFolder,
  showPreview,
  showUpload,
  showDelete,
  folderUploadRef,
  // actions
  onRefresh,
  onTogglePreview,
  onFolderUpload,
  onTriggerFolderUpload,
  onDrop,
  onDragOver,
  onDragLeave,
  onToggleFolder,
  onFileClick,
  onFileDoubleClick,
  onCreateNewFile,
  onCreateNewFolder,
  onDeleteFolder,
  onDownloadFolderZip,
  onPasteInto,
  onDebugWorkflow,
  onRunWorkflow,
  onRename,
  changedFiles,
  showModificationDate,
  apiBasePath,
  onPublish,
  specialFolders,
  overrideWidth,
  // File locking
  fileLocks,
  isReadonlyFile,
  onRequestLock,
  onUnlockFile,
  onUnlockFolder,
  labOwnerId,
  currentUserId,
  backupIgnoredFolders,
  onToggleBackupIgnoreFolder,
}) {
  const { compactButtons, setCompactButtons } = useSettings();
  const toast = useToast();
  const dialog = useDialog();
  const { clipboard, copyFile, copyFolder, refreshFromServer } = useFileClipboard();
  const [groupByExtension, setGroupByExtension] = useState(() => {
    try {
      const saved = localStorage.getItem('fileBrowserGroupByExtension');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('fileBrowserGroupByExtension', groupByExtension ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, [groupByExtension]);

  const askPrompt = useCallback((options) => dialog.prompt(options), [dialog]);
  const isScriptsBrowser = /\/labs\/[^/]+\/scripts(?:$|\/)/.test(apiBasePath);
  const normalizedIgnoredFolders = useMemo(
    () => (backupIgnoredFolders || []).map(normalizeBackupPath).filter(Boolean),
    [backupIgnoredFolders]
  );
  const backupIgnoredSet = useMemo(() => new Set(normalizedIgnoredFolders), [normalizedIgnoredFolders]);
  const canToggleBackupIgnoreFolder = isScriptsBrowser
    && typeof onToggleBackupIgnoreFolder === 'function'
    && String(labOwnerId) === String(currentUserId);

  const isFolderBackupIgnored = useCallback((folderPath) => {
    if (!isScriptsBrowser) return false;
    const scriptsPath = toScriptsBackupPath(folderPath);
    if (!scriptsPath) return false;
    return backupIgnoredSet.has(scriptsPath);
  }, [isScriptsBrowser, backupIgnoredSet]);

  const handleToggleBackupIgnoreFolder = useCallback((folderPath, shouldIgnore) => {
    if (!canToggleBackupIgnoreFolder) return;
    onToggleBackupIgnoreFolder(folderPath, shouldIgnore);
  }, [canToggleBackupIgnoreFolder, onToggleBackupIgnoreFolder]);

  // Create sync config for a folder (only for scripts-based file managers)
  const handleCreateSync = useCallback(async (folderPath) => {
    const labMatch = apiBasePath.match(/\/labs\/([^/]+)\/scripts/);
    if (!labMatch) return;
    const labId = labMatch[1];
    const serverUrl = window.location.origin;
    try {
      const r = await fetch(`/api/v1/labs/${encodeURIComponent(labId)}/sync/create-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({ folder: folderPath, serverUrl }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (typeof onRefresh === 'function') onRefresh();
      toast.success('Sync config created. Download sync.json to your PC.');
    } catch {
      toast.error('Error creating sync config');
    }
  }, [apiBasePath, onRefresh, toast]);

  const handleCopyFile = useCallback((filePath) => {
    copyFile(filePath, apiBasePath);
  }, [copyFile, apiBasePath]);

  const handleCopyFolder = useCallback((folderPath) => {
    copyFolder(folderPath, apiBasePath);
  }, [copyFolder, apiBasePath]);

  const handlePaste = useCallback(async (targetFolder) => {
    // Always fetch the latest clipboard from server before pasting
    // (covers the case where copy happened in another window)
    await refreshFromServer();
    // Use a fresh read – we can't rely on the state updated by refreshFromServer
    // synchronously, so we fetch once more directly:
    let item = clipboard;
    try {
      const r = await fetch('/api/v1/clipboard', {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.clipboard) item = data.clipboard;
      }
    } catch { /* use local */ }
    if (!item) return;
    onPasteInto(targetFolder, item);
  }, [clipboard, onPasteInto, refreshFromServer]);

  // Build a virtual root node that wraps all top-level items
  const rootNode = {
    name: title || 'Files',
    path: '',
    type: 'directory',
    children: tree || [],
  };

  return (
    <section
      style={{
        width: overrideWidth || (showPreview ? 380 : '100%'),
        minWidth: 200,
        height: '100%',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 10,
        overflow: 'auto',
        background: '#fff',
        flex: overrideWidth ? 'none' : (showPreview ? 'none' : 1),
        flexShrink: 0,
      }}
    >
      {/* Compact title bar — only title + refresh + preview toggle */}
      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {title || 'Files'}
        </h3>
        <div style={{ display: 'flex', gap: 3 }}>
          <IBtn
            title={compactButtons ? 'Buttons on hover only' : 'Always show buttons'}
            onClick={() => setCompactButtons(v => !v)}
            bg={'transparent'}
            style={{
                color: compactButtons ?  '#000000':'#5f5f5f'
            }}
                
          >👁</IBtn>
          <IBtn title={fbBtn.refresh.label} onClick={onRefresh} bg={fbBtn.refresh.bg} disabled={loading}>{fbBtn.refresh.icon}</IBtn>
          <IBtn
            title={groupByExtension ? 'Disable extension groups' : 'Enable extension groups'}
            onClick={() => setGroupByExtension((v) => !v)}
            bg="#ffffff"
            style={{
              color: '#000000',
              border: '1px solid #d1d5db',
              fontWeight: 700,
            }}
          >□</IBtn>
          <IBtn
            title={showPreview ? fbBtn.previewHide.label : fbBtn.preview.label}
            onClick={onTogglePreview}
            bg={showPreview ? fbBtn.previewHide.bg : fbBtn.preview.bg}
          >
            {showPreview ? fbBtn.previewHide.icon : fbBtn.preview.icon}
          </IBtn>
        </div>
      </div>

      {/* Hidden input for folder-specific upload */}
      {showUpload && (
        <input ref={folderUploadRef} type="file" style={{ display: 'none' }} onChange={onFolderUpload} />
      )}

      {/* Root folder node — acts as the top-level "folder" with all actions */}
      <FolderNode
        node={rootNode}
        depth={0}
        expandedFolders={expandedFolders}
        selectedFile={selectedFile}
        dragOverFolder={dragOverFolder}
        showUpload={showUpload}
        showDelete={showDelete}
        showModificationDate={showModificationDate}
        loading={loading}
        onToggleFolder={onToggleFolder}
        onFileClick={onFileClick}
        onFileDoubleClick={onFileDoubleClick}
        onCreateNewFile={onCreateNewFile}
        onCreateNewFolder={onCreateNewFolder}
        onTriggerFolderUpload={onTriggerFolderUpload}
        onDownloadFolderZip={onDownloadFolderZip}
        onDeleteFolder={onDeleteFolder}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onCopyFile={handleCopyFile}
        onCopyFolder={handleCopyFolder}
        onPasteInto={handlePaste}
        clipboard={clipboard}
        apiBasePath={apiBasePath}
        onDebugWorkflow={onDebugWorkflow}
        onRunWorkflow={onRunWorkflow}
        onRename={onRename}
        changedFiles={changedFiles}
        onPublish={onPublish}
        onCreateSync={apiBasePath.includes('/scripts') ? handleCreateSync : undefined}
        isBackupIgnored={false}
        groupByExtension={groupByExtension}
        specialFolders={specialFolders}
        isRoot
        compactButtons={compactButtons}
        fileLocks={fileLocks}
        isReadonlyFile={isReadonlyFile}
        onRequestLock={onRequestLock}
        onUnlockFile={onUnlockFile}
        onUnlockFolder={onUnlockFolder}
        labOwnerId={labOwnerId}
        currentUserId={currentUserId}
        onToggleBackupIgnoreFolder={canToggleBackupIgnoreFolder ? handleToggleBackupIgnoreFolder : undefined}
        isFolderBackupIgnored={isFolderBackupIgnored}
        onPrompt={askPrompt}
      />

      {files.length === 0 && !loading && (
        <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
          {'No files'}
        </div>
      )}
    </section>
  );
}
