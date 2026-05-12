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
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { getLocation } from 'jsonc-parser';
import { monacoDefaults } from '../lib/uiConfig.js';

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isJsonLanguage(language) {
  const normalized = String(language || '').toLowerCase();
  return normalized === 'json' || normalized === 'jsonc';
}

function formatJsonPath(path) {
  if (!Array.isArray(path) || path.length === 0) return '';

  return path.map((segment, index) => {
    if (typeof segment === 'number') {
      return `[${segment}]`;
    }

    const key = String(segment);
    if (IDENTIFIER_RE.test(key)) {
      return index === 0 ? key : `.${key}`;
    }

    return `[${JSON.stringify(key)}]`;
  }).join('');
}

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
  const [jsonPath, setJsonPath] = useState('');
  const [jsonPathCopied, setJsonPathCopied] = useState(false);
  const jsonPathCopiedTimerRef = useRef(null);
  const jsonPathUpdateFrameRef = useRef(null);
  const jsonPathDisposablesRef = useRef([]);

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
  const showJsonPath = isJsonLanguage(language);
  const mountedRef = useRef(false);
  const editorRef = useRef(null);
  // Queue of values recently emitted from local typing. When React feeds these
  // values back via props, we skip model.setValue() to avoid caret jumps.
  const pendingLocalValuesRef = useRef([]);
  // True while we are pushing an external value into Monaco model.
  // onChange fired from that setValue() is ignored to prevent feedback loops.
  const applyingExternalUpdateRef = useRef(false);

  const cleanupJsonPathListeners = useCallback(() => {
    for (const disposable of jsonPathDisposablesRef.current) {
      disposable?.dispose?.();
    }
    jsonPathDisposablesRef.current = [];
  }, []);

  const updateJsonPath = useCallback((editor = editorRef.current) => {
    if (!showJsonPath || !editor) {
      setJsonPath('');
      return;
    }

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) {
      setJsonPath('');
      return;
    }

    try {
      const offset = model.getOffsetAt(position);
      const location = getLocation(model.getValue(), offset);
      setJsonPath(formatJsonPath(location.path));
    } catch {
      // Keep the UI stable if the current JSON text cannot be parsed.
      setJsonPath('');
    }
  }, [showJsonPath]);

  const scheduleJsonPathUpdate = useCallback((editor = editorRef.current) => {
    if (jsonPathUpdateFrameRef.current !== null) {
      cancelAnimationFrame(jsonPathUpdateFrameRef.current);
    }

    jsonPathUpdateFrameRef.current = requestAnimationFrame(() => {
      jsonPathUpdateFrameRef.current = null;
      updateJsonPath(editor);
    });
  }, [updateJsonPath]);

  const attachJsonPathListeners = useCallback((editor) => {
    cleanupJsonPathListeners();
    if (!showJsonPath || !editor) {
      setJsonPath('');
      return;
    }

    jsonPathDisposablesRef.current = [
      editor.onDidChangeCursorPosition(() => {
        scheduleJsonPathUpdate(editor);
      }),
      editor.onDidChangeModelContent(() => {
        scheduleJsonPathUpdate(editor);
      }),
      editor.onDidChangeModel(() => {
        scheduleJsonPathUpdate(editor);
      }),
    ];

    scheduleJsonPathUpdate(editor);
  }, [cleanupJsonPathListeners, scheduleJsonPathUpdate, showJsonPath]);

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

  useEffect(() => {
    attachJsonPathListeners(editorRef.current);
  }, [attachJsonPathListeners]);

  useEffect(() => () => {
    cleanupJsonPathListeners();
    if (jsonPathCopiedTimerRef.current) {
      clearTimeout(jsonPathCopiedTimerRef.current);
    }
    if (jsonPathUpdateFrameRef.current !== null) {
      cancelAnimationFrame(jsonPathUpdateFrameRef.current);
    }
  }, [cleanupJsonPathListeners]);

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

    attachJsonPathListeners(editor);

    // Forward to consumer's onMount
    onMountProp?.(editor, monaco);
  }, [attachJsonPathListeners, onMountProp]);

  const handleCopyJsonPath = useCallback(async () => {
    if (!jsonPath) return;
    try {
      await navigator.clipboard.writeText(jsonPath);
      setJsonPathCopied(true);
      if (jsonPathCopiedTimerRef.current) {
        clearTimeout(jsonPathCopiedTimerRef.current);
      }
      jsonPathCopiedTimerRef.current = setTimeout(() => {
        setJsonPathCopied(false);
      }, 1400);
    } catch {
      setJsonPathCopied(false);
    }
  }, [jsonPath]);

  const mergedOptions = useMemo(() => ({
    ...monacoDefaults,
    readOnly,
    ...extraOptions,
  }), [readOnly, extraOptions]);

  const isLightTheme = theme === 'vs';

  // During editing, skip controlled value to prevent cursor jumps — BUT only
  // after the editor has mounted once (so fresh mounts get initial content).
  const controlledValue = (isEditing && mountedRef.current) ? undefined : (value ?? '');

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
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
      </div>

      {showJsonPath && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderTop: `1px solid ${isLightTheme ? '#e5e7eb' : '#333'}`,
            background: isLightTheme ? '#f9fafb' : '#171717',
            color: isLightTheme ? '#374151' : '#d1d5db',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>JSON path</span>
          <input
            type="text"
            readOnly
            value={jsonPath || '(root)'}
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${isLightTheme ? '#d1d5db' : '#444'}`,
              background: isLightTheme ? '#fff' : '#111827',
              color: isLightTheme ? '#111827' : '#e5e7eb',
              fontSize: 12,
              fontFamily: "'Fira Code', monospace",
            }}
          />
          <button
            type="button"
            onClick={handleCopyJsonPath}
            disabled={!jsonPath}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${isLightTheme ? '#d1d5db' : '#555'}`,
              background: isLightTheme ? '#fff' : '#232323',
              color: isLightTheme ? '#111827' : '#f3f4f6',
              fontSize: 12,
              cursor: jsonPath ? 'pointer' : 'default',
              opacity: jsonPath ? 1 : 0.6,
              whiteSpace: 'nowrap',
            }}
          >
            {jsonPathCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
