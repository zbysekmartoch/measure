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

  // Keep refs fresh — update synchronously during render so they are never stale
  // when a keybinding fires between render and effect.
  onSaveRef.current = onSave;
  readOnlyRef.current = readOnly;

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
  // Queue of values recently emitted from local typing. When React feeds these
  // values back via props, we skip model.setValue() to avoid caret jumps.
  const pendingLocalValuesRef = useRef([]);
  // True while we are pushing an external value into Monaco model.
  // onChange fired from that setValue() is ignored to prevent feedback loops.
  const applyingExternalUpdateRef = useRef(false);

  // When the value prop changes externally (e.g. file switch) while in editing
  // mode, push it imperatively via the editor model. Must run in useEffect
  // (not during render) because model.setValue can fire onChange -> setState.
  useEffect(() => {
    if (isEditing && mountedRef.current && editorRef.current) {
      const nextValue = value ?? '';
      const pending = pendingLocalValuesRef.current;

      // Skip values that originated from this editor instance itself.
      // This avoids replaying stale intermediate states back into Monaco while typing fast.
      const localIdx = pending.indexOf(nextValue);
      if (localIdx !== -1) {
        pending.splice(0, localIdx + 1);
        return;
      }

      const model = editorRef.current.getModel();
      if (model && model.getValue() !== nextValue) {
        pendingLocalValuesRef.current = [];
        applyingExternalUpdateRef.current = true;
        model.setValue(nextValue);
        // Keep the guard active for any synchronous onChange callbacks
        // emitted by Monaco due to setValue().
        queueMicrotask(() => {
          applyingExternalUpdateRef.current = false;
        });
      }
    }
  }, [value, isEditing]);

  const handleChange = useCallback((newValue) => {
    if (applyingExternalUpdateRef.current) return;
    const nextValue = newValue ?? '';
    const pending = pendingLocalValuesRef.current;
    pending.push(nextValue);
    if (pending.length > 100) {
      pending.splice(0, pending.length - 100);
    }
    onChange?.(nextValue);
  }, [onChange]);

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    // Mark as mounted *after* this render cycle so the first render still
    // passes the controlled value.
    requestAnimationFrame(() => { mountedRef.current = true; });

    // Ctrl+S / Cmd+S → save (use addAction instead of addCommand for reliable
    // per-instance keybinding that only fires when THIS editor has focus)
    editor.addAction({
      id: 'custom-save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        if (!readOnlyRef.current && onSaveRef.current) {
          onSaveRef.current();
        }
      },
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
      onChange={handleChange}
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
