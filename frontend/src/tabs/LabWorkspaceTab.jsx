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
import { shadow, debugModes as dmCfg, icons } from '../lib/uiConfig.js';

const TABS = [
  { key: 'scripts',  icon: '📜', label: 'Scripts' },
  { key: 'results',  icon: '📊', label: 'Results' },
];

// Debug panel placement: 'hidden' | 'right' | 'bottom' | 'popup'
const DEBUG_MODES = [
  { key: 'hidden', label: dmCfg.hidden.label, icon: dmCfg.hidden.icon },
  { key: 'right',  label: dmCfg.right.label,  icon: dmCfg.right.icon },
  { key: 'bottom', label: dmCfg.bottom.label, icon: dmCfg.bottom.icon },
  { key: 'popup',  label: dmCfg.popup.label,  icon: dmCfg.popup.icon },
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
      // Only handle F-keys we care about
      if (!['F8', 'F9', 'F10', 'F11'].includes(e.key)) return;

      // Don't intercept if user is typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
          // Write a clean document so it doesn't show about:blank content
          w.document.open();
          w.document.write('<!DOCTYPE html><html><head></head><body></body></html>');
          w.document.close();
          // Add base styles
          const style = w.document.createElement('style');
          style.textContent = 'body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#1e1e1e;color:#d4d4d4;}';
          w.document.head.appendChild(style);
          // Create portal container
          const container = w.document.createElement('div');
          container.id = 'debug-root';
          container.style.cssText = 'height:100vh;overflow:auto;padding:6px;';
          w.document.body.appendChild(container);
          setPopupContainer(container);
          w.addEventListener('beforeunload', () => {
            // Clear the portal BEFORE the window is destroyed
            // so React can unmount cleanly
            setPopupContainer(null);
            popupRef.current = null;
            setDebugMode('hidden');
          });
        }
      }
    } else {
      if (popupRef.current && !popupRef.current.closed) {
        // First clear the portal so React unmounts
        setPopupContainer(null);
        // Then close the window on next tick
        const w = popupRef.current;
        popupRef.current = null;
        setTimeout(() => { try { w.close(); } catch { /* ignore */ } }, 0);
      } else {
        popupRef.current = null;
        setPopupContainer(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

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

        {/* Debugger placement controls — enclosed panel with toggle buttons */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          marginLeft: 8,
          background: dmCfg.panelBg,
          border: `1px solid ${dmCfg.panelBorder}`,
          borderRadius: 6,
          padding: 2,
          boxShadow: shadow.small,
        }}>
          <span style={{ fontSize: 16, color: '#6b7280', padding: '0 6px', whiteSpace: 'nowrap' }}>🛠|</span>
          {DEBUG_MODES.map((m) => {
            const isActive = debugMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setDebugMode(m.key)}
                title={m.label}
                style={{
                  padding: '4px 8px',
                  border: `1px solid ${isActive ? dmCfg.activeBorder : 'transparent'}`,
                  borderRadius: 4,
                  background: isActive ? dmCfg.activeBg : dmCfg.inactiveBg,
                  color: isActive ? dmCfg.activeColor : dmCfg.inactiveColor,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  outline: 'none',
                  lineHeight: 1,
                  boxShadow: isActive ? shadow.inset : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {m.icon}
              </button>
            );
          })}
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
