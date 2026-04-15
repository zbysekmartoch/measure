/**
 * CodeEditor — unified Monaco editor wrapper used across the entire app.
 *
 * Features baked in:
 *   - Cursor-jump prevention: during active editing the controlled `value` prop
 *     is set to `undefined` so Monaco manages its own state (no race condition).
 *     In read-only / preview mode, `value` is passed normally so file switches
 *     update content reliably via @monaco-editor/react's built-in mechanism.
 *   - Ctrl+S / Cmd+S save shortcut (when onSave is provided and not readOnly).
 *   - Forwards onMount so consumers can add breakpoints, keybindings, etc.
 *   - Uses shared monacoDefaults from uiConfig.
 *
 * Props:
 *   value        — file content string
 *   language     — Monaco language id
 *   theme        — 'vs' | 'vs-dark' | 'hc-black'
 *   readOnly     — boolean (default false)
 *   options      — extra Monaco options merged on top of monacoDefaults + readOnly
 *   onChange     — (newValue: string) => void
 *   onSave       — () => void   (triggered by Ctrl+S when not readOnly)
 *   onMount      — (editor, monaco) => void  (called after internal setup)
 *   height       — CSS height (default '100%')
 */
import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { monacoDefaults } from '../lib/uiConfig.js';

export default function CodeEditor({
  value,
  language = 'plaintext',
  theme = 'vs-dark',
  readOnly = false,
  options: extraOptions,
  onChange,
  onSave,
  onMount: onMountProp,
  height = '100%',
}) {
  const onSaveRef = useRef(onSave);
  const readOnlyRef = useRef(readOnly);

  // Keep refs fresh
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);

  // Editing = not readOnly AND onChange is provided.
  // During editing we pass value={undefined} so Monaco manages its own state
  // and fast typing doesn't cause cursor jumps. In all other modes we pass the
  // controlled value so file switches update content reliably.
  //
  // EXCEPTION: on the very first render we always pass the value so the editor
  // has initial content (important when Monaco is mounted fresh, e.g. switching
  // from Markdown preview to edit mode).
  const isEditing = !readOnly && !!onChange;
  const mountedRef = useRef(false);
  const editorRef = useRef(null);

  // When the value prop changes externally (e.g. file switch) while in editing
  // mode, push it imperatively via the editor model. Must run in useEffect
  // (not during render) because model.setValue fires onChange → setState.
  useEffect(() => {
    if (isEditing && mountedRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== value) {
        model.setValue(value ?? '');
      }
    }
  }, [value, isEditing]);

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    // Mark as mounted *after* this render cycle so the first render still
    // passes the controlled value.
    requestAnimationFrame(() => { mountedRef.current = true; });

    // Ctrl+S / Cmd+S → save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (!readOnlyRef.current && onSaveRef.current) {
        onSaveRef.current();
      }
    });

    // Forward to consumer's onMount
    onMountProp?.(editor, monaco);
  }, [onMountProp]);

  const mergedOptions = useMemo(() => ({
    ...monacoDefaults,
    readOnly,
    ...extraOptions,
  }), [readOnly, extraOptions]);

  // During editing, skip controlled value to prevent cursor jumps — BUT only
  // after the editor has mounted once (so fresh mounts get initial content).
  const controlledValue = (isEditing && mountedRef.current) ? undefined : (value ?? '');

  return (
    <Editor
      height={height}
      language={language}
      value={controlledValue}
      onChange={onChange}
      options={mergedOptions}
      theme={theme}
      onMount={handleMount}
      loading={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
          Loading editor...
        </div>
      }
    />
  );
}
