/**
 * FilePreviewPane — right column of FileManagerEditor.
 * Shows: filename, size, mtime, Edit / Save / Cancel + Download / Delete buttons,
 * then the actual preview (Monaco editor, image, PDF, or binary placeholder).
 */
import React, { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { useLanguage } from '../../context/LanguageContext';
import { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile, formatFileSize, formatModifiedDate } from './fileUtils.js';
import { filePreviewButtons as fpBtn, shadow } from '../../lib/uiConfig.js';

export default function FilePreviewPane({
  selectedFile,
  selectedFileInfo,
  fileContent,
  pdfBlobUrl,
  isEditing,
  loading,
  readOnly,
  editorTheme,
  showDelete,
  apiBasePath,
  // actions
  onEdit,
  onSave,
  onCancel,
  onContentChange,
  onThemeChange,
  onOpenInNewWindow,
  onDownloadFile,
  onDeleteFile,
}) {
  const { t } = useLanguage();

  const editorLanguage = useMemo(() => getLanguageFromFilename(selectedFile), [selectedFile]);

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

  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  if (!selectedFile || !selectedFileInfo) {
    return (
      <section style={{ flex: 1, minWidth: 0, height: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14 }}>
        {t('selectFileToView') || 'Select a file to view'}
      </section>
    );
  }

  const isText = selectedFileInfo.isText || isTextFile(selectedFile);
  const isImg = isImageFile(selectedFile);
  const isPdf = isPdfFile(selectedFile);

  return (
    <section style={{ flex: 1, minWidth: 0, height: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar: file name, meta, action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{selectedFile}</div>
          {(selectedFileInfo.size !== undefined || selectedFileInfo.mtime) && (
            <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 8 }}>
              {selectedFileInfo.size !== undefined && <span>📊 {formatFileSize(selectedFileInfo.size)}</span>}
              {selectedFileInfo.mtime && <span>🕒 {formatModifiedDate(selectedFileInfo.mtime)}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Edit / Save / Cancel */}
          {isText && !readOnly && isEditing ? (
            <>
              <button
                className="btn"
                onClick={onSave}
                disabled={loading}
                style={{ padding: '4px 10px', background: fpBtn.save.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              >
                {fpBtn.save.icon} {t('save') || fpBtn.save.label}
              </button>
              <button
                className="btn"
                onClick={onCancel}
                disabled={loading}
                style={{ padding: '4px 10px', background: fpBtn.cancel.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              >
                {fpBtn.cancel.icon} {t('cancel') || fpBtn.cancel.label}
              </button>
            </>
          ) : isText && !readOnly ? (
            <button
              className="btn"
              onClick={onEdit}
              disabled={loading}
              style={{ padding: '4px 10px', background: fpBtn.edit.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
            >
              {fpBtn.edit.icon} {t('edit') || fpBtn.edit.label}
            </button>
          ) : null}
          {/* Download */}
          <button
            onClick={() => onDownloadFile(selectedFile)}
            style={{ padding: '4px 10px', background: fpBtn.download.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
            title={t('download') || fpBtn.download.label}
          >
            {fpBtn.download.icon} {t('download') || fpBtn.download.label}
          </button>
          {/* Delete */}
          {showDelete && (
            <button
              onClick={() => onDeleteFile(selectedFile)}
              style={{ padding: '4px 10px', background: fpBtn.delete.bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, boxShadow: shadow.small }}
              title={t('delete') || fpBtn.delete.label}
            >
              {fpBtn.delete.icon} {t('delete') || fpBtn.delete.label}
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      {isImg ? (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 16 }}>
          <img
            src={`${apiBasePath}/download?file=${encodeURIComponent(selectedFile)}`}
            alt={selectedFile}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
          />
        </div>
      ) : isPdf ? (
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
          {pdfBlobUrl ? (
            <embed src={pdfBlobUrl} type="application/pdf" style={{ flex: 1, width: '100%', minHeight: 400 }} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              {t('loading') || 'Loading...'}
            </div>
          )}
        </div>
      ) : isText ? (
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
              {readOnly && (
                <span style={{ background: 'rgba(239,68,68,0.2)', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, textTransform: 'uppercase' }}>
                  {t('readOnly') || 'Read only'}
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
              ↗ {t('newWindow') || 'New window'}
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <Editor
              height="100%"
              language={editorLanguage}
              value={fileContent}
              onChange={(value) => onContentChange(value || '')}
              options={editorOptions}
              theme={editorTheme}
              loading={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>{t('loading') || 'Loading editor...'}</div>}
            />
          </div>
        </div>
      ) : (
        /* Binary file */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280', gap: 16 }}>
          <div style={{ fontSize: 64 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('binaryFile') || 'Binary file'}</div>
          <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
            {t('binaryFileDescription') || 'This file is binary and cannot be displayed. You can download or delete it.'}
          </div>
        </div>
      )}
    </section>
  );
}
