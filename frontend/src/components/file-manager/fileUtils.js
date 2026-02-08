/**
 * fileUtils.js — pure helper functions for file type detection, formatting, etc.
 * No React dependencies. Shared across FileManagerEditor, LabWorkspaceTab, etc.
 */

/** Map file extension → Monaco Editor language id */
export const getLanguageFromFilename = (filename) => {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap = {
    py: 'python', python: 'python',
    js: 'javascript', jsx: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json', sql: 'sql',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown',
    xml: 'xml', yaml: 'yaml', yml: 'yaml',
    sh: 'shell', bash: 'shell',
    txt: 'plaintext', log: 'plaintext', err: 'plaintext', csv: 'plaintext',
  };
  return languageMap[ext] || 'plaintext';
};

/** Image file? */
export const isImageFile = (filename) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

/** PDF file? */
export const isPdfFile = (filename) => {
  if (!filename) return false;
  return filename.split('.').pop()?.toLowerCase() === 'pdf';
};

/** Text-editable file? */
export const isTextFile = (filename) => {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  const textExts = [
    'log','err','txt','json','xml','yaml','yml','md',
    'py','js','jsx','ts','tsx','css','html','htm',
    'sql','sh','bash','csv','ini','cfg','conf','properties',
  ];
  return textExts.includes(ext);
};

/** Format bytes → human-readable string */
export const formatFileSize = (bytes) => {
  if (bytes === undefined || bytes === null) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/** Format ISO date → cs-CZ locale string */
export const formatModifiedDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('cs-CZ', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

/** Pick emoji icon for a file based on its extension */
export const fileIcon = (filename) => {
  if (isImageFile(filename)) return '🖼️';
  if (isPdfFile(filename)) return '📕';
  if (isTextFile(filename)) return '📄';
  return '📦';
};

/** Recursively flatten a tree (items with children) into a flat file list */
export const extractFiles = (items) => {
  const out = [];
  const walk = (nodes) => {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.type === 'file') out.push(n);
      if (n.type === 'directory' && n.children) walk(n.children);
    }
  };
  walk(items);
  return out;
};

/** Group flat file list by folder path */
export const groupFilesByFolder = (files) =>
  files.reduce((acc, file) => {
    const parts = file.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    (acc[folder] ??= []).push(file);
    return acc;
  }, {});
