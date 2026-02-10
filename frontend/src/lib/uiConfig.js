/**
 * UI Configuration — centralized button styles, icons, and colors.
 *
 * Edit this file to customize the look of all buttons and icons in the app.
 * All inline-styled buttons reference these values so you can tweak them
 * from a single place.
 */

// ─── Box-shadow presets (3D floating effect) ────────────────────────────────

export const shadow = {
  /** Default resting shadow — button appears to float slightly */
  normal: '0 2px 4px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.14)',
  /** Hover shadow — button lifts up */
  hover:  '0 4px 8px rgba(0,0,0,0.22), 0 2px 4px rgba(0,0,0,0.16)',
  /** Pressed/active — button sinks in */
  pressed: 'inset 0 2px 4px rgba(0,0,0,0.25)',
  /** Pressed toggle button (selected state) */
  inset: 'inset 0 2px 6px rgba(0,0,0,0.30)',
  /** Small icon buttons */
  small: '0 1px 3px rgba(0,0,0,0.18), 0 1px 1px rgba(0,0,0,0.12)',
  smallHover: '0 2px 5px rgba(0,0,0,0.22), 0 1px 2px rgba(0,0,0,0.15)',
};

// ─── File browser toolbar buttons ───────────────────────────────────────────

export const fileBrowserButtons = {
  refresh:      { icon: '↻',  bg: '#009771', label: 'Refresh' },
  preview:      { icon: '▶',  bg: '#6c4599', label: 'Preview' },
  previewHide:  { icon: '◀',  bg: '#6c4599', label: 'Hide preview' },
  newFile:      { icon: '+', bg: '#0488d4', label: 'New file' },
  paste:        { icon: 'P', bg: '#002a69', label: '' },
  upload:       { icon: '⬆',  bg: '#005ae2', label: '' },
};

// ─── File browser item (row) buttons ────────────────────────────────────────

export const fileItemButtons = {
  copyFile:     { icon: 'C', bg: '#000916', label: 'Copy file' },
  copyFolder:   { icon: 'C', bg: '#000916', label: 'Copy folder' },
  pasteInto:    { icon: 'P', bg: '#002a69', label: 'Paste here' },
  newFile:      { icon: '+', bg: '#0488d4', label: 'New file' },
  newFolder:    { icon: '🗀', bg: '#0488d4', label: 'New folder' },
  uploadHere:   { icon: '⬆', bg: '#005ae2', label: 'Upload here' },
  downloadZip:  { icon: '⬇',  bg: '#2f9722', label: 'Download ZIP' },
  deleteFolder: { icon: '🗑', bg: '#f81717', label: 'Delete folder' },
  debugWorkflow:{ icon: '🛠', bg: '#ff7300', label: 'Debug workflow' },
};

// ─── File preview toolbar buttons ───────────────────────────────────────────

export const filePreviewButtons = {
  edit:     { icon: '✏', bg: '#ff7300', label: 'Edit' },
  download: { icon: '⬇', bg: '#2f9722', label: 'Download' },
  delete:   { icon: '🗑', bg: '#f81717', label: 'Delete' },
  save:     { icon: '💾', bg: '#0066ff', label: 'Save' },
  cancel:   { icon: '✕', bg: '#6b7280', label: 'Cancel' },
};

// ─── Result pane buttons ────────────────────────────────────────────────────

export const resultButtons = {
  run: {
    icon: '▶',
    bg: '#0aad25',
    disabledBg: '#9ca3af',
    label: 'Run',
  },
  debug: {
    icon: '🛠',
    bg: '#ad610a',
    disabledBg: '#9ca3af',
    label: 'Debug',
  },
  reset: {
    icon: '⏹',
    bg: '#92400e',
    label: 'Reset',
  },
  loading: {
    icon: '⏳',
  },
};

// ─── Debugger panel buttons ─────────────────────────────────────────────────

export const debugButtons = {
  attach: {
    icon: '🔗',
    bg: '#166534',
    label: 'Attach',
  },
  stop: {
    icon: '⏹',
    bg: '#f81717',
    label: 'Stop',
  },
  continue: {
    icon: '▶',
    label: 'Continue',
    shortcut: 'F8',
  },
  stepOver: {
    icon: '⤵',
    label: 'Step Over',
    shortcut: 'F10',
  },
  stepIn: {
    icon: '↓',
    label: 'Step In',
    shortcut: 'F11',
  },
  stepOut: {
    icon: '↑',
    label: 'Step Out',
    shortcut: 'Shift+F11',
  },
  /** Background for stepping buttons (dark toolbar) */
  stepBg: '#333',
};

// ─── Debug mode switcher buttons ────────────────────────────────────────────

export const debugModes = {
  hidden: { icon: '⊘', label: 'Hide debugger' },
  right:  { icon: '◧',  label: 'Debugger on the right' },
  bottom: { icon: '⬓',  label: 'Debugger at bottom' },
  popup:  { icon: '⧉',  label: 'Debugger in a separate window' },

  /** Panel background */
  panelBg: '#f3f4f6',
  panelBorder: '#d1d5db',
  /** Active/pressed toggle */
  activeBg: '#e0e7ff',
  activeColor: '#232925',
  activeBorder: '#012345',
  /** Inactive toggle */
  inactiveBg: '#f9fafb',
  inactiveColor: '#23252b',
};

// ─── General action button colors (used via CSS classes .btn-*) ─────────────

export const actionButtons = {
  add:       { bg: '#00a2ff', hoverBg: '#0186d3', disabledBg: '#bbf7d0' },
  delete:    { bg: '#f81717', hoverBg: '#b91c1c', disabledBg: '#fecaca' },
  edit:      { bg: '#eb4325', hoverBg: '#d8491d', disabledBg: '#bfdbfe' },
  primary:   { bg: '#008f83', hoverBg: '#016e65', disabledBg: '#99f6e4' },
  secondary: { bg: '#6b7280', hoverBg: '#4b5563', disabledBg: '#e5e7eb' },
  cancel:    { bg: '#f3f4f6', hoverBg: '#e5e7eb', border: '#d1d5db', color: '#374151' },
  warning:   { bg: '#7c3aed', hoverBg: '#6d28d9', disabledBg: '#ddd6fe' },
  logout:    { bg: '#f81717', hoverBg: '#dc2626' },
};

// ─── Tab icon colors ────────────────────────────────────────────────────────

export const tabIcons = {
  close:  { icon: '×',  color: '#c20000', hoverColor: '#ff0000' },
  popOut: { icon: '⧉', color: 'rgb(0, 101, 148)', hoverColor: '#rgb(0, 174, 255)' },
  enter:  { icon: '↗', color: '#9ca3af', hoverColor: '#059669' },
};

// ─── Icons (legacy shortcut) ────────────────────────────────────────────────

export const icons = {
  popOut: '⧉',
  close: '×',
  enter: '↗',
};
