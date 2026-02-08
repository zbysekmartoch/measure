/**
 * FileBrowserPane — left column of FileManagerEditor.
 * Renders a proper recursive tree (directories with children).
 *
 * Features:
 *   - Collapsible folders at any nesting depth
 *   - Single click on file → preview; double click → open in separate tab
 *   - Copy / Paste buttons on files and folders (cross-instance via ClipboardContext)
 *   - Drag-and-drop upload into any folder
 *   - Folder actions: upload here, download ZIP, delete, paste
 */
import React, { useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { formatFileSize, fileIcon } from './fileUtils.js';
import { useFileClipboard } from './ClipboardContext.jsx';

/* ── tiny icon-button helper ────────────────────────────────────────────────── */
const IBtn = ({ title, onClick, bg = '#6b7280', children, disabled, style: extra }) => (
  <button
    title={title}
    onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    disabled={disabled}
    style={{
      fontSize: 10, padding: '1px 5px', background: bg, color: 'white',
      border: 'none', borderRadius: 3, cursor: disabled ? 'not-allowed' : 'pointer',
      lineHeight: '16px', whiteSpace: 'nowrap', ...extra,
    }}
  >{children}</button>
);

/* ── recursive tree node (folder) ───────────────────────────────────────────── */
function FolderNode({
  node, depth, expandedFolders, selectedFile, dragOverFolder,
  showUpload, showDelete, showModificationDate, loading,
  onToggleFolder, onFileClick, onFileDoubleClick,
  onTriggerFolderUpload, onDownloadFolderZip, onDeleteFolder,
  onDrop, onDragOver, onDragLeave,
  onCopyFile, onCopyFolder, onPasteInto, clipboard, apiBasePath,
  onDebugWorkflow,
}) {
  const isExpanded = expandedFolders[node.path] ?? (depth === 0);
  const indent = depth * 16;

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
          background: dragOverFolder === node.path ? '#dbeafe' : (depth === 0 ? '#f9fafb' : 'transparent'),
          borderRadius: 4, cursor: 'pointer', userSelect: 'none',
          borderBottom: depth === 0 ? '1px solid #e5e7eb' : 'none',
          marginTop: depth === 0 ? 4 : 0,
        }}
        onClick={() => onToggleFolder(node.path)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: depth === 0 ? 600 : 500, color: '#374151', minWidth: 0 }}>
          <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 10 }}>▶</span>
          <span>📁</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          <span style={{ fontSize: 9, color: '#9ca3af', background: '#e5e7eb', padding: '0 4px', borderRadius: 6, flexShrink: 0 }}>
            {countFiles(node)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {dragOverFolder === node.path && showUpload && (
            <span style={{ color: '#3b82f6', fontSize: 10 }}>⬆</span>
          )}
          <IBtn title="Kopírovat složku" onClick={() => onCopyFolder(node.path)} bg="#6366f1">📋</IBtn>
          {clipboard && (
            <IBtn title="Vložit sem" onClick={() => onPasteInto(node.path)} bg="#8b5cf6">📌</IBtn>
          )}
          {showUpload && (
            <IBtn title="Nahrát sem" onClick={() => onTriggerFolderUpload(node.path)} bg="#22c55e" disabled={loading}>+</IBtn>
          )}
          <IBtn title="Stáhnout ZIP" onClick={() => onDownloadFolderZip(node.path)} bg="#3b82f6" disabled={loading}>⬇</IBtn>
          {showDelete && (
            <IBtn title="Smazat složku" onClick={() => onDeleteFolder(node.path)} bg="#ef4444" disabled={loading}>🗑</IBtn>
          )}
        </div>
      </div>

      {/* Children (files + subdirectories) */}
      {isExpanded && (node.children || []).map((child) =>
        child.type === 'directory' ? (
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
          />
        ) : (
          <FileRow
            key={child.path}
            file={child}
            depth={depth + 1}
            isSelected={selectedFile === child.path}
            showModificationDate={showModificationDate}
            onClick={onFileClick}
            onDoubleClick={onFileDoubleClick}
            onCopy={onCopyFile}
            onDebugWorkflow={onDebugWorkflow}
          />
        ),
      )}
    </div>
  );
}

/* ── file row ───────────────────────────────────────────────────────────────── */
function FileRow({ file, depth, isSelected, showModificationDate, onClick, onDoubleClick, onCopy, onDebugWorkflow }) {
  const indent = depth * 16 + 12;
  const isWorkflow = file.name?.endsWith('.workflow');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 6px', paddingLeft: indent,
        borderRadius: 4,
        background: isSelected ? '#dbeafe' : 'transparent',
        cursor: 'pointer', fontSize: 12,
      }}
      onClick={() => onClick(file)}
      onDoubleClick={() => onDoubleClick?.(file)}
    >
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{fileIcon(file.name)}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
        {showModificationDate && file.size !== undefined && (
          <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0 }}>{formatFileSize(file.size)}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {isWorkflow && onDebugWorkflow && (
          <IBtn title="Debug workflow" onClick={() => onDebugWorkflow(file.path)} bg="#b82b2b">🐛</IBtn>
        )}
        <IBtn title="Kopírovat soubor" onClick={() => onCopy(file.path)} bg="#6366f1">📋</IBtn>
      </div>
    </div>
  );
}

/* ── root-level files (files at the top level that aren't inside any folder) ─ */
function RootFiles({
  files, selectedFile, showModificationDate, onFileClick, onFileDoubleClick, onCopyFile, onDebugWorkflow,
}) {
  if (!files.length) return null;
  return files.map((file) => (
    <FileRow
      key={file.path}
      file={file}
      depth={0}
      isSelected={selectedFile === file.path}
      showModificationDate={showModificationDate}
      onClick={onFileClick}
      onDoubleClick={onFileDoubleClick}
      onCopy={onCopyFile}
      onDebugWorkflow={onDebugWorkflow}
    />
  ));
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
  onUpload,
  onFolderUpload,
  onTriggerFolderUpload,
  onDrop,
  onDragOver,
  onDragLeave,
  onToggleFolder,
  onFileClick,
  onFileDoubleClick,
  onCreateNewFile,
  onDeleteFolder,
  onDownloadFolderZip,
  onPasteInto,
  onDebugWorkflow,
  showModificationDate,
  apiBasePath,
}) {
  const { t } = useLanguage();
  const { clipboard, copyFile, copyFolder } = useFileClipboard();

  const handleCopyFile = useCallback((filePath) => {
    copyFile(filePath, apiBasePath);
  }, [copyFile, apiBasePath]);

  const handleCopyFolder = useCallback((folderPath) => {
    copyFolder(folderPath, apiBasePath);
  }, [copyFolder, apiBasePath]);

  const handlePaste = useCallback((targetFolder) => {
    if (!clipboard) return;
    onPasteInto(targetFolder, clipboard);
  }, [clipboard, onPasteInto]);

  const uploadId = 'file-upload-input-' + (apiBasePath || '').replace(/[^a-zA-Z0-9]/g, '-');

  // Separate root-level files and directories
  const rootDirs = (tree || []).filter((n) => n.type === 'directory');
  const rootFiles = (tree || []).filter((n) => n.type === 'file');

  return (
    <section
      style={{
        width: showPreview ? 380 : '100%',
        minWidth: 280,
        height: '100%',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 10,
        overflow: 'auto',
        background: '#fff',
        flex: showPreview ? 'none' : 1,
      }}
    >
      {/* Title bar + toolbar */}
      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {title || t('files') || 'Soubory'}
        </h3>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <IBtn title={t('refresh') || 'Obnovit'} onClick={onRefresh} bg="#8b5cf6" disabled={loading}>↻</IBtn>
          <IBtn
            title={showPreview ? (t('hidePreview') || 'Skrýt náhled') : (t('showPreview') || 'Náhled')}
            onClick={onTogglePreview}
            bg={showPreview ? '#6b7280' : '#3b82f6'}
          >
            {showPreview ? '◀' : '▶'}
          </IBtn>
          <IBtn
            title="Nový soubor"
            onClick={() => {
              const name = prompt('Název nového souboru (např. folder/query.sql):');
              if (name) onCreateNewFile(name);
            }}
            bg="#f59e0b" disabled={loading}
          >
            📝
          </IBtn>
          {clipboard && (
            <IBtn title="Vložit do root" onClick={() => handlePaste('')} bg="#8b5cf6">📌 Paste</IBtn>
          )}
          {showUpload && (
            <>
              <IBtn title={t('upload') || 'Nahrát'} onClick={() => document.getElementById(uploadId)?.click()} bg="#22c55e" disabled={loading}>
                + {t('upload') || 'Nahrát'}
              </IBtn>
              <input id={uploadId} type="file" style={{ display: 'none' }} onChange={onUpload} />
            </>
          )}
        </div>
      </div>

      {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>{t('loading')}</div>}

      {/* Hidden input for folder-specific upload */}
      {showUpload && (
        <input ref={folderUploadRef} type="file" style={{ display: 'none' }} onChange={onFolderUpload} />
      )}

      {/* Root-level files first */}
      <RootFiles
        files={rootFiles}
        selectedFile={selectedFile}
        showModificationDate={showModificationDate}
        onFileClick={onFileClick}
        onFileDoubleClick={onFileDoubleClick}
        onCopyFile={handleCopyFile}
        onDebugWorkflow={onDebugWorkflow}
      />

      {/* Directory tree */}
      {rootDirs.map((node) => (
        <FolderNode
          key={node.path}
          node={node}
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
        />
      ))}

      {files.length === 0 && !loading && (
        <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
          {t('noFiles') || 'Žádné soubory'}
        </div>
      )}
    </section>
  );
}
