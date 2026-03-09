/**
 * FilePreviewPane — right column of FileManagerEditor.
 * Shows: filename, size, mtime, Edit / Save / Cancel + Download / Delete buttons,
 * then the actual preview (Monaco editor, image, PDF, or binary placeholder).
 */
import React, { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useLanguage } from '../../context/LanguageContext';
import { getLanguageFromFilename, isImageFile, isPdfFile, isTextFile, formatFileSize, formatModifiedDate } from './fileUtils.js';
import { filePreviewButtons as fpBtn, shadow, monacoDefaults } from '../../lib/uiConfig.js';

export default function FilePreviewPane({
  selectedFile,
  selectedFileInfo,
  fileContent,
  pdfBlobUrl,
  imageBlobUrl,
  isEditing,
  loading,
  readOnly,
  editorTheme,
  showDelete,
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
    ...monacoDefaults,
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
  const isMarkdown = selectedFile && /\.md$/i.test(selectedFile);
  const showMarkdownPreview = isMarkdown && !isEditing;

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
          {imageBlobUrl ? (
            <img
              src={imageBlobUrl}
              alt={selectedFile}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            />
          ) : (
            <div style={{ color: '#6b7280' }}>{t('loading') || 'Loading...'}</div>
          )}
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
        showMarkdownPreview ? (
          /* Rendered Markdown preview */
          <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'auto', background: '#fff', padding: '20px 28px', lineHeight: 1.7, fontSize: 14 }}>
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
        )
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
