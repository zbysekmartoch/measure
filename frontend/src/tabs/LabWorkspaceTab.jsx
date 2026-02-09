/**
 * LabWorkspaceTab — workspace for a single lab.
 *
 * Three main sub-tabs:
 *   📜 Scripts  — file browser + inline editors for lab scripts
 *   📊 Results  — result picker + file browser for result files
 *   ⚙️ Settings — lab name, description, sharing
 *
 * The debugger panel can be shown right / below / in a popup window.
 * A draggable splitter separates main content from the debugger.
 *
 * Props:
 *   lab         – lab metadata object { id, name, description, … }
 *   onLabUpdate – callback(updatedLab) when settings change
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import LabScriptsPane from './LabScriptsPane.jsx';
import LabResultsPane from './LabResultsPane.jsx';
import LabSettingsPane from './LabSettingsPane.jsx';
import { useDebugSession } from '../debug/useDebugSession.js';
import DebugPanel from '../debug/DebugPanel.jsx';

const TABS = [
  { key: 'scripts',  icon: '📜', label: 'Scripts' },
  { key: 'results',  icon: '📊', label: 'Results' },
];

// Debug panel placement: 'hidden' | 'right' | 'bottom' | 'popup'
const DEBUG_MODES = [
  { key: 'hidden', label: 'Skrýt',       icon: '🚫' },
  { key: 'right',  label: 'Vpravo',      icon: '◧' },
  { key: 'bottom', label: 'Pod',         icon: '⬓' },
  { key: 'popup',  label: 'Nové okno',   icon: '↗' },
];

export default function LabWorkspaceTab({ lab, onLabUpdate }) {
  const [activeTab, setActiveTab] = useState('scripts');
  const [debugMode, setDebugMode] = useState('hidden');
  const popupRef = useRef(null);

  // ---- Splitter state (fraction 0–1, from left/top) ----
  const [splitFraction, setSplitFraction] = useState(0.65);
  const containerRef = useRef(null);

  // ---- Debug session (lives here, shared with children) ----
  const debug = useDebugSession({ labId: lab.id });

  // ---- F9 handler ref (set by LabResultsPane) ----
  const runDebugRef = useRef(null);

  // ---- Keep fresh refs for keyboard handler ----
  const debugRef = useRef(debug);
  debugRef.current = debug;

  // ---- Blinking state ----
  const [blinkScripts, setBlinkScripts] = useState(false);

  // Blink Scripts tab when debugger is stopped and Scripts tab is NOT active
  useEffect(() => {
    if (debug.status === 'stopped' && activeTab !== 'scripts') {
      setBlinkScripts(true);
    } else {
      setBlinkScripts(false);
    }
  }, [debug.status, activeTab]);

  // ---- Global keyboard shortcuts ----
  useEffect(() => {
    const handler = (e) => {
      // Don't intercept if user is typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't intercept if inside Monaco editor (contentEditable or textarea)
      const isMonaco = e.target.closest?.('.monaco-editor');
      if (isMonaco) return;

      const d = debugRef.current;
      switch (e.key) {
        case 'F8':
          e.preventDefault();
          if (d.status === 'stopped') d.doContinue();
          break;
        case 'F9':
          e.preventDefault();
          if (runDebugRef.current) runDebugRef.current();
          break;
        case 'F10':
          e.preventDefault();
          if (d.status === 'stopped') d.doNext();
          break;
        case 'F11':
          e.preventDefault();
          if (e.shiftKey) {
            if (d.status === 'stopped') d.doStepOut();
          } else {
            if (d.status === 'stopped') d.doStepIn();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // ---- Popup window handling ----
  const [popupContainer, setPopupContainer] = useState(null);

  useEffect(() => {
    if (debugMode === 'popup') {
      if (!popupRef.current || popupRef.current.closed) {
        const w = window.open('', `debug_${lab.id}`, 'width=480,height=700,resizable=yes');
        if (w) {
          popupRef.current = w;
          w.document.title = `🛠 Debugger — ${lab.name}`;
          // Copy stylesheets from parent window
          const parentStyles = document.querySelectorAll('style, link[rel="stylesheet"]');
          parentStyles.forEach(s => {
            try { w.document.head.appendChild(s.cloneNode(true)); } catch { /* ignore */ }
          });
          // Add base styles
          const style = w.document.createElement('style');
          style.textContent = 'body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#1e1e1e;color:#d4d4d4;}';
          w.document.head.appendChild(style);
          // Create portal container
          let container = w.document.getElementById('debug-root');
          if (!container) {
            container = w.document.createElement('div');
            container.id = 'debug-root';
            container.style.cssText = 'height:100vh;overflow:auto;padding:6px;';
            w.document.body.innerHTML = '';
            w.document.body.appendChild(container);
          }
          setPopupContainer(container);
          w.addEventListener('beforeunload', () => {
            popupRef.current = null;
            setPopupContainer(null);
            setDebugMode('hidden');
          });
        }
      }
    } else {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
      popupRef.current = null;
      setPopupContainer(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

  // Re-render popup content on debug state changes
  useEffect(() => {
    if (debugMode !== 'popup' || !popupRef.current || popupRef.current.closed) return;
    const root = popupRef.current.document.getElementById('debug-root');
    if (!root) return;
    root.innerHTML = `
      <div style="padding:10px;font-size:13px;">
        <div style="margin-bottom:10px;font-weight:bold;font-size:15px;">🛠 Debugger — ${lab.name}</div>
        <div style="margin-bottom:6px;">Status: <b style="color:${debug.status === 'stopped' ? '#f87171' : debug.status === 'running' ? '#4ade80' : '#d4d4d4'}">${debug.status}</b></div>
        ${debug.debugInfo ? `<div style="font-size:11px;color:#888;margin-bottom:8px;">Script: ${debug.debugInfo.scriptPath || '—'} | Port: ${debug.debugInfo.port || '—'}</div>` : ''}
        ${debug.stoppedLocation ? `<div style="margin-bottom:8px;color:#ffcc00;">⏸ Stopped at ${debug.stoppedLocation.name || debug.stoppedLocation.file || '?'}:${debug.stoppedLocation.line}</div>` : ''}
        <div style="margin-bottom:6px;font-weight:600;">Call Stack (${debug.callStack.length})</div>
        ${debug.callStack.map((f) => `<div style="padding:2px 0;font-family:monospace;font-size:12px;${f.id === debug.selectedFrameId ? 'color:#569cd6;' : ''}">${f.name} — ${f.source?.name || '?'}:${f.line}</div>`).join('')}
        <div style="margin-top:10px;margin-bottom:6px;font-weight:600;">Variables (${debug.variables.length})</div>
        ${debug.variables.map(v => `<div style="padding:1px 0;font-family:monospace;font-size:12px;"><span style="color:#9cdcfe;">${v.name}</span> = <span style="color:#b5cea8;">${v.value}</span></div>`).join('')}
        ${debug.error ? `<div style="margin-top:10px;padding:6px;background:#7f1d1d;color:#fecaca;border-radius:4px;font-size:12px;">⚠ ${debug.error}</div>` : ''}
        <div style="margin-top:12px;color:#555;font-size:11px;">Ovládání probíhá v hlavním okně.</div>
      </div>
    `;
  });

  // ---- Splitter drag handling ----
  const onSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const isHorizontal = debugMode === 'right';

    const onMove = (ev) => {
      const pos = isHorizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      setSplitFraction(Math.max(0.2, Math.min(0.85, pos)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [debugMode]);

  // ---- Tab style ----
  const tabStyle = (isActive, blink = false) => ({
    padding: '7px 14px',
    border: '1px solid #012345',
    borderBottom: 'none',
    marginBottom: isActive ? -1 : 0,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    background: isActive ? '#fff' : blink ? undefined : '#f3f4f6',
    fontWeight: isActive ? 600 : 400,
    color: '#111827',
    zIndex: isActive ? 1 : 0,
    cursor: 'pointer',
    fontSize: 13,
    outline: 'none',
    animation: blink ? 'tabBlink 0.8s ease-in-out infinite' : 'none',
  });

  const showSplitter = debugMode === 'right' || debugMode === 'bottom';
  const isHorizontalSplit = debugMode === 'right';

  // ---- Debug panel block (reused for inline right/bottom) ----
  const debugPanelInline = showSplitter ? (
    <DebugPanel
      status={debug.status}
      debugInfo={debug.debugInfo}
      callStack={debug.callStack}
      variables={debug.variables}
      selectedFrameId={debug.selectedFrameId}
      output={debug.output}
      error={debug.error}
      onAttach={debug.attach}
      onDetach={debug.detach}
      onContinue={debug.doContinue}
      onNext={debug.doNext}
      onStepIn={debug.doStepIn}
      onStepOut={debug.doStepOut}
      onSelectFrame={debug.selectFrame}
      onExpandVariable={debug.expandVariable}
    />
  ) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', marginTop: 2 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={tabStyle(
              activeTab === tab.key,
              tab.key === 'scripts' && blinkScripts
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}

        {/* Debugger placement controls — right after Results tab */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          marginLeft: 6,
          padding: '0 4px',
          borderLeft: '1px solid #d1d5db',
        }}>
          <span style={{ fontSize: 11, color: '#6b7280', marginRight: 4, whiteSpace: 'nowrap' }}>🛠</span>
          {DEBUG_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setDebugMode(debugMode === m.key && m.key !== 'hidden' ? 'hidden' : m.key)}
              title={m.label}
              style={{
                padding: '4px 7px',
                border: debugMode === m.key ? '1px solid #012345' : '1px solid transparent',
                borderRadius: 4,
                background: debugMode === m.key ? '#e0e7ff' : 'transparent',
                color: debugMode === m.key ? '#3730a3' : '#6b7280',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: debugMode === m.key ? 600 : 400,
                outline: 'none',
                lineHeight: 1,
              }}
            >
              {m.icon}
            </button>
          ))}
        </div>

        {/* Settings tab — pushed to right */}
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            ...tabStyle(activeTab === 'settings'),
            marginLeft: 'auto',
          }}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Content area with optional splitter */}
      <div
        ref={containerRef}
        style={{
          border: '1px solid #012345',
          background: '#fff',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: isHorizontalSplit ? 'row' : 'column',
        }}
      >
        {/* Main content */}
        <div style={{
          ...(showSplitter
            ? isHorizontalSplit
              ? { width: `${splitFraction * 100}%` }
              : { height: `${splitFraction * 100}%` }
            : { flex: 1 }),
          minWidth: 0, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{ height: '100%', display: activeTab === 'scripts' ? 'flex' : 'none', flexDirection: 'column', padding: 6 }}>
            <LabScriptsPane lab={lab} debug={debug} />
          </div>
          <div style={{ height: '100%', display: activeTab === 'results' ? 'flex' : 'none', flexDirection: 'column', padding: 6 }}>
            <LabResultsPane lab={lab} debug={debug} debugVisible={debugMode !== 'hidden'} runDebugRef={runDebugRef} />
          </div>
          <div style={{ height: '100%', display: activeTab === 'settings' ? 'block' : 'none', overflow: 'auto' }}>
            <LabSettingsPane lab={lab} onLabUpdate={onLabUpdate} />
          </div>
        </div>

        {/* Splitter handle */}
        {showSplitter && (
          <div
            onMouseDown={onSplitterMouseDown}
            style={{
              ...(isHorizontalSplit
                ? { width: 5, cursor: 'col-resize', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db' }
                : { height: 5, cursor: 'row-resize', borderTop: '1px solid #d1d5db', borderBottom: '1px solid #d1d5db' }),
              background: '#e5e7eb',
              flexShrink: 0,
              zIndex: 10,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#93c5fd'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#e5e7eb'; }}
          />
        )}

        {/* Debug panel (right or bottom) */}
        {showSplitter && (
          <div style={{
            ...(isHorizontalSplit
              ? { width: `${(1 - splitFraction) * 100}%` }
              : { height: `${(1 - splitFraction) * 100}%` }),
            minWidth: 0, minHeight: 0,
            overflow: 'auto',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {debugPanelInline}
          </div>
        )}
      </div>

      {/* Popup portal for debug panel */}
      {debugMode === 'popup' && popupContainer && createPortal(
        <DebugPanel
          status={debug.status}
          debugInfo={debug.debugInfo}
          callStack={debug.callStack}
          variables={debug.variables}
          selectedFrameId={debug.selectedFrameId}
          output={debug.output}
          error={debug.error}
          onAttach={debug.attach}
          onDetach={debug.detach}
          onContinue={debug.doContinue}
          onNext={debug.doNext}
          onStepIn={debug.doStepIn}
          onStepOut={debug.doStepOut}
          onSelectFrame={debug.selectFrame}
          onExpandVariable={debug.expandVariable}
        />,
        popupContainer
      )}

      <style>{`
        @keyframes tabBlink {
          0%, 100% { background: #fef3c7; }
          50% { background: #fbbf24; }
        }
      `}</style>
    </div>
  );
}
