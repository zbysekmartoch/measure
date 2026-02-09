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
  refresh:      { icon: '↻',  bg: '#8b5cf6', label: 'Obnovit' },
  preview:      { icon: '▶',  bg: '#3b82f6', label: 'Náhled' },
  previewHide:  { icon: '◀',  bg: '#6b7280', label: 'Skrýt náhled' },
  newFile:      { icon: '📝', bg: '#f59e0b', label: 'Nový soubor' },
  paste:        { icon: '📌', bg: '#8b5cf6', label: 'Paste' },
  upload:       { icon: '+',  bg: '#22c55e', label: 'Nahrát' },
};

// ─── File browser item (row) buttons ────────────────────────────────────────

export const fileItemButtons = {
  copyFile:     { icon: '📋', bg: '#6366f1', label: 'Kopírovat soubor' },
  copyFolder:   { icon: '📋', bg: '#6366f1', label: 'Kopírovat složku' },
  pasteInto:    { icon: '📌', bg: '#8b5cf6', label: 'Vložit sem' },
  uploadHere:   { icon: '+',  bg: '#22c55e', label: 'Nahrát sem' },
  downloadZip:  { icon: '⬇',  bg: '#3b82f6', label: 'Stáhnout ZIP' },
  deleteFolder: { icon: '🗑', bg: '#ef4444', label: 'Smazat složku' },
  debugWorkflow:{ icon: '🛠', bg: '#b82b2b', label: 'Debug workflow' },
};

// ─── Result pane buttons ────────────────────────────────────────────────────

export const resultButtons = {
  run: {
    icon: '▶',
    bg: '#b82b2b',
    disabledBg: '#9ca3af',
    label: 'Run',
  },
  debug: {
    icon: '🛠',
    bg: '#b82b2b',
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
    bg: '#991b1b',
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
  hidden: { icon: '🚫', label: 'Skrýt' },
  right:  { icon: '◧',  label: 'Vpravo' },
  bottom: { icon: '⬓',  label: 'Pod' },
  popup:  { icon: '⧉',  label: 'Nové okno' },

  /** Panel background */
  panelBg: '#f3f4f6',
  panelBorder: '#d1d5db',
  /** Active/pressed toggle */
  activeBg: '#e0e7ff',
  activeColor: '#3730a3',
  activeBorder: '#012345',
  /** Inactive toggle */
  inactiveBg: '#f9fafb',
  inactiveColor: '#6b7280',
};

// ─── General action button colors (used via CSS classes .btn-*) ─────────────

export const actionButtons = {
  add:       { bg: '#16a34a', hoverBg: '#15803d', disabledBg: '#bbf7d0' },
  delete:    { bg: '#dc2626', hoverBg: '#b91c1c', disabledBg: '#fecaca' },
  edit:      { bg: '#2563eb', hoverBg: '#1d4ed8', disabledBg: '#bfdbfe' },
  primary:   { bg: '#0d9488', hoverBg: '#0f766e', disabledBg: '#99f6e4' },
  secondary: { bg: '#6b7280', hoverBg: '#4b5563', disabledBg: '#e5e7eb' },
  cancel:    { bg: '#f3f4f6', hoverBg: '#e5e7eb', border: '#d1d5db', color: '#374151' },
  warning:   { bg: '#7c3aed', hoverBg: '#6d28d9', disabledBg: '#ddd6fe' },
  logout:    { bg: '#ef4444', hoverBg: '#dc2626' },
};

// ─── Icons ──────────────────────────────────────────────────────────────────

export const icons = {
  popOut: '⧉',
  close: '×',
  enter: '⧉',
};
