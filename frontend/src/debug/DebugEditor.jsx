/**
 * DebugEditor.jsx — Monaco editor with breakpoint gutter and debug line highlight.
 *
 * Features:
 *   - Click in gutter to toggle breakpoints (red dots)
 *   - Highlight current stopped line (yellow background)
 *   - glyphMargin enabled for breakpoint dots
 *
 * Props:
 *   file            — { path, name, content, language, dirty }
 *   editorTheme     — 'vs' | 'vs-dark' | 'hc-black'
 *   breakpoints     — Set<number> of 1-based line numbers
 *   stoppedLine     — number (1-based) or null
 *   readOnly        — boolean
 *   onChange         — (newContent: string) => void
 *   onToggleBreakpoint — (filePath: string, line: number) => void
 *   onEditorMount   — (editor, monaco) => void (optional)
 */
import React, { useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';

export default function DebugEditor({
  file,
  editorTheme = 'vs-dark',
  breakpoints = new Set(),
  stoppedLine = null,
  readOnly = false,
  onChange,
  onToggleBreakpoint,
  onBreakpointsMoved,
  onEditorMount,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const bpDecIdsRef = useRef([]); // track which decorations are breakpoints

  // Update decorations when breakpoints or stoppedLine change
  const updateDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const decorations = [];
    const bpCount = breakpoints.size;

    // Breakpoint dots
    for (const line of breakpoints) {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'debug-breakpoint-glyph',
          glyphMarginHoverMessage: { value: `Breakpoint at line ${line}` },
          stickiness: monaco.editor.TrackedRangeStickiness.GrowsOnlyWhenTypingBefore,
        },
      });
    }

    // Stopped line highlight
    if (stoppedLine) {
      decorations.push({
        range: new monaco.Range(stoppedLine, 1, stoppedLine, 1),
        options: {
          isWholeLine: true,
          className: 'debug-stopped-line',
          glyphMarginClassName: 'debug-stopped-glyph',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
    // First N decorations are breakpoints
    bpDecIdsRef.current = decorationsRef.current.slice(0, bpCount);
  }, [breakpoints, stoppedLine]);

  // Scroll to stopped line
  useEffect(() => {
    if (stoppedLine && editorRef.current) {
      editorRef.current.revealLineInCenter(stoppedLine);
    }
  }, [stoppedLine]);

  // Re-apply decorations when breakpoints or stoppedLine change
  useEffect(() => {
    updateDecorations();
  }, [updateDecorations]);

  // Sync breakpoint positions from Monaco decorations back to parent state.
  // When lines are inserted/deleted, Monaco moves decorations but our
  // breakpointsMap still has the old line numbers. This reads the actual
  // decoration positions and notifies the parent to update.
  const syncRef = useRef(null);
  syncRef.current = () => {
    const editor = editorRef.current;
    if (!editor || !onBreakpointsMoved || !file?.path) return;
    if (bpDecIdsRef.current.length === 0) return;

    const model = editor.getModel();
    if (!model) return;

    const newLines = new Set();
    for (const decId of bpDecIdsRef.current) {
      const range = model.getDecorationRange(decId);
      if (range) {
        newLines.add(range.startLineNumber);
      }
    }

    // Check if positions changed
    if (newLines.size !== breakpoints.size || ![...breakpoints].every(l => newLines.has(l))) {
      onBreakpointsMoved(file.path, newLines);
    }
  };

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Inject CSS for breakpoint glyphs and stopped line
    injectDebugStyles();

    // Enable glyph margin
    editor.updateOptions({ glyphMargin: true });

    // Handle gutter click to toggle breakpoints
    editor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const line = e.target.position?.lineNumber;
        if (line && onToggleBreakpoint && file?.path) {
          // Before toggling, sync current breakpoint positions from decorations
          syncRef.current?.();
          onToggleBreakpoint(file.path, line);
        }
      }
    });

    // On content changes, track where breakpoints moved and notify parent
    editor.onDidChangeModelContent(() => {
      syncRef.current?.();
    });

    // Apply initial decorations
    updateDecorations();

    if (onEditorMount) onEditorMount(editor, monaco);
  }, [file?.path, onToggleBreakpoint, updateDecorations, onEditorMount]);

  return (
    <Editor
      height="100%"
      language={file?.language || 'plaintext'}
      value={file?.content || ''}
      onChange={(val) => onChange?.(val || '')}
      theme={editorTheme}
      onMount={handleMount}
      options={{
        minimap: { enabled: true },
        fontSize: 13,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        readOnly,
        glyphMargin: true,
        lineNumbersMinChars: 3,
      }}
    />
  );
}

// ── Inject CSS for debug decorations ────────────────────────────────────────

let stylesInjected = false;
function injectDebugStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .debug-breakpoint-glyph {
      background: #e51400;
      border-radius: 50%;
      width: 10px !important;
      height: 10px !important;
      margin-left: 4px;
      margin-top: 4px;
      display: inline-block;
    }
    .debug-stopped-line {
      background: rgba(255, 255, 0, 0.15) !important;
      border-left: 3px solid #ffcc00 !important;
    }
    .debug-stopped-glyph {
      background: #ffcc00;
      clip-path: polygon(0% 20%, 60% 50%, 0% 80%);
      width: 12px !important;
      height: 14px !important;
      margin-left: 3px;
      margin-top: 3px;
    }
    /* Hover indicator for gutter (show faded breakpoint on hover) */
    .monaco-editor .margin-view-overlays .line-numbers:hover {
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}
