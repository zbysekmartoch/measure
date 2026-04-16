/**
 * LabWorkspaceTab — workspace for a single lab.
 *
 * Sub-tabs:
 *   📜 Scripts  — file browser + inline editors for lab scripts
 *   🐞 Debug    — result picker + file browser for result files
 *   📤 Current output — file manager for current output
 *   💬 Chat     — real-time lab chat
 *   ⚙️ Settings — lab name, description, sharing
 *
 * Every sub-tab can be popped out into its own window via a button
 * in the tab header.
 *
 * The debugger panel can be shown right / below / in a popup window.
 * A draggable splitter separates main content from the debugger.
 *
 * Props:
 *   lab         – lab metadata object { id, name, description, … }
 *   onLabUpdate – callback(updatedLab) when settings change
 */
import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { createPortal } from 'react-dom';
import LabScriptsPane from './LabScriptsPane.jsx';
import LabResultsPane from './LabResultsPane.jsx';
import LabSettingsPane from './LabSettingsPane.jsx';
import LabChatPane from './LabChatPane.jsx';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { useDebugSession } from '../debug/useDebugSession.js';
import DebugPanel from '../debug/DebugPanel.jsx';
import { shadow, debugModes as dmCfg } from '../lib/uiConfig.js';
import { useLabChat } from '../hooks/useLabChat.js';
import { usePopoutWindow } from '../hooks/usePopoutWindow.js';

const DataExplorerTab = React.lazy(
  () => import('./DataExplorerTab.jsx')
);

const TABS = [
  { key: 'scripts',  icon: '📜', label: 'Scripts' },
  { key: 'results',  icon: '🐞', label: 'Debug' },
  { key: 'output',   icon: '📤', label: 'Current output' },
  { key: 'chat',     icon: '💬', label: 'Chat' },
];

// Debug panel placement: 'hidden' | 'right' | 'bottom' | 'popup'
const DEBUG_MODES = [
  { key: 'hidden', label: dmCfg.hidden.label, icon: dmCfg.hidden.icon },
  { key: 'right',  label: dmCfg.right.label,  icon: dmCfg.right.icon },
  { key: 'bottom', label: dmCfg.bottom.label, icon: dmCfg.bottom.icon },
  { key: 'popup',  label: dmCfg.popup.label,  icon: dmCfg.popup.icon },
];

export default function LabWorkspaceTab({ lab, onLabUpdate, appConfig }) {
  const [activeTab, setActiveTab] = useState('scripts');
  const [debugMode, setDebugMode] = useState('hidden');
  const popupRef = useRef(null);

  // ---- Data Explorer sub-tabs ----
  const [openExplorers, setOpenExplorers] = useState([]);

  const openAnalyze = useCallback((source) => {
    const id = `explorer:${source.fileName}:${Date.now()}`;
    setOpenExplorers((prev) => [...prev, { id, source, label: source.fileName }]);
    setActiveTab(id);
  }, []);

  const closeAnalyze = useCallback((explorerId) => {
    setOpenExplorers((prev) => prev.filter((e) => e.id !== explorerId));
    setActiveTab((prev) => (prev === explorerId ? 'scripts' : prev));
  }, []);

  // ---- Splitter state (fraction 0–1, from left/top) ----
  const [splitFraction, setSplitFraction] = useState(0.65);
  const containerRef = useRef(null);

  // ---- Debug session (lives here, shared with children) ----
  const debug = useDebugSession({ labId: lab.id });

  // ---- F9 handler ref (set by LabResultsPane) ----
  const runDebugRef = useRef(null);

  // ---- Save-all ref (set by LabScriptsPane, called by LabResultsPane before Run/Debug) ----
  const saveAllRef = useRef(null);

  // ---- Lab Chat ----
  const chat = useLabChat(lab.id);

  // Mark chat visible/invisible based on active tab
  useEffect(() => {
    chat.setVisible(activeTab === 'chat');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ---- Pop-out windows for sub-tabs ----
  const popoutScripts = usePopoutWindow({ title: `📜 Scripts — ${lab.name}`, width: 1000, height: 700 });
  const popoutResults = usePopoutWindow({ title: `🐞 Debug — ${lab.name}`, width: 1000, height: 700 });
  const popoutOutput  = usePopoutWindow({ title: `📤 Output — ${lab.name}`, width: 900, height: 600 });
  const popoutChat    = usePopoutWindow({ title: `💬 Chat — ${lab.name}`, width: 500, height: 700 });

  const popouts = {
    scripts: popoutScripts,
    results: popoutResults,
    output: popoutOutput,
    chat: popoutChat,
  };

  // ---- Auto-show debug panel when debug workflow starts ----
  const showDebugPanel = useCallback(() => {
    if (debugMode === 'hidden') setDebugMode('right');
  }, [debugMode]);

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
        const debugTitle = `🛠 Debugger — ${lab.name}`;
        const w = window.open('', `debug_${lab.id}`, 'popup,width=480,height=700,resizable=yes');
        if (w) {
          popupRef.current = w;
          const faviconEl = document.querySelector('link[rel="icon"]');
          const faviconHref = faviconEl ? new URL(faviconEl.href, location.origin).href : '';
          const faviconTag = faviconHref ? `<link rel="icon" href="${faviconHref}">` : '';
          w.document.open();
          w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${debugTitle}</title>${faviconTag}</head><body></body></html>`);
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
    const doc = container.ownerDocument;
    const rect = container.getBoundingClientRect();
    const isHorizontal = debugMode === 'right';

    const onMove = (ev) => {
      const pos = isHorizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      setSplitFraction(Math.max(0.2, Math.min(0.85, pos)));
    };

    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.body.style.userSelect = '';
      doc.body.style.cursor = '';
    };

    doc.body.style.userSelect = 'none';
    doc.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
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
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const blink = tab.key === 'scripts' && blinkScripts;
          const popout = popouts[tab.key];
          const showBadge = tab.key === 'chat' && chat.unreadCount > 0 && activeTab !== 'chat';
          return (
            <span key={tab.key} style={{
              display: 'inline-flex', alignItems: 'stretch',
              marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0,
            }}>
              <button
                onClick={() => setActiveTab(tab.key)}
                style={{
                  ...tabStyle(isActive, blink),
                  borderRight: popout ? 'none' : undefined,
                  borderTopRightRadius: popout ? 0 : 6,
                  position: 'relative',
                }}
              >
                {tab.icon} {tab.label}
                {showBadge && (
                  <span style={{
                    position: 'absolute', top: 2, right: 4,
                    background: '#dc2626', color: '#fff', borderRadius: '50%',
                    minWidth: 16, height: 16, fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', lineHeight: 1,
                  }}>
                    {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                  </span>
                )}
              </button>
              {popout && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (popout.isPopout) popout.closePopout();
                    else popout.openPopout();
                  }}
                  title={popout.isPopout ? 'Close popup window' : 'Open in popup window'}
                  style={{
                    padding: '4px 5px',
                    border: '1px solid #012345', borderBottom: 'none', borderLeft: 'none',
                    borderRadius: '0 6px 0 0',
                    background: popout.isPopout ? '#dbeafe' : (isActive ? '#fff' : (blink ? undefined : '#f3f4f6')),
                    cursor: 'pointer', color: popout.isPopout ? '#2563eb' : '#6b7280',
                    fontSize: 11, display: 'flex', alignItems: 'center',
                    animation: blink ? 'tabBlink 0.8s ease-in-out infinite' : 'none',
                  }}
                >
                  {popout.isPopout ? '⊡' : '⧉'}
                </button>
              )}
            </span>
          );
        })}

        {/* Data Explorer sub-tabs */}
        {openExplorers.map((explorer) => {
          const isActive = activeTab === explorer.id;
          return (
            <span key={explorer.id} style={{
              display: 'inline-flex', alignItems: 'stretch',
              marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0,
            }}>
              <button
                onClick={() => setActiveTab(explorer.id)}
                title={`Data Explorer: ${explorer.label}`}
                style={{
                  padding: '6px 10px', border: '1px solid #012345', borderBottom: 'none', borderRight: 'none',
                  borderRadius: '6px 0 0 0', background: isActive ? '#fff' : '#f3f4f6',
                  fontWeight: isActive ? 600 : 400, color: '#111827', cursor: 'pointer', fontSize: 13,
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                🔍 {explorer.label}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeAnalyze(explorer.id); }}
                title="Close"
                style={{
                  padding: '4px 6px', border: '1px solid #012345', borderBottom: 'none', borderLeft: 'none',
                  borderRadius: '0 6px 0 0', background: isActive ? '#fff' : '#f3f4f6',
                  cursor: 'pointer', color: '#9ca3af', fontSize: 12, display: 'flex', alignItems: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; }}
              >
                ×
              </button>
            </span>
          );
        })}

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
          <div style={{ flex: 1, minHeight: 0, display: activeTab === 'scripts' ? 'flex' : 'none', flexDirection: 'column', padding: 6, overflow: 'hidden' }}>
            <LabScriptsPane lab={lab} debug={debug} appConfig={appConfig} onAnalyze={openAnalyze} saveAllRef={saveAllRef} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: activeTab === 'results' ? 'flex' : 'none', flexDirection: 'column', padding: 6, overflow: 'hidden' }}>
            <LabResultsPane lab={lab} debug={debug} debugVisible={debugMode !== 'hidden'} runDebugRef={runDebugRef} onAnalyze={openAnalyze} appConfig={appConfig} saveAllRef={saveAllRef} onShowDebugPanel={showDebugPanel} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: activeTab === 'output' ? 'flex' : 'none', flexDirection: 'column', padding: 6, overflow: 'hidden' }}>
            <FileManagerEditor
              apiBasePath={`/api/v1/labs/${lab.id}/current_output`}
              showUpload={false}
              showDelete={false}
              readOnly
              showModificationDate
              title="Current output"
              csvPreviewMaxRows={appConfig?.csvPreviewMaxRows}
              previewMaxFileSize={appConfig?.previewMaxFileSize}
              onAnalyze={(fileName) => openAnalyze({ labId: lab.id, apiPath: `/api/v1/labs/${lab.id}/current_output`, fileName })}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <LabChatPane lab={lab} chat={chat} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: activeTab === 'settings' ? 'block' : 'none', overflow: 'auto' }}>
            <LabSettingsPane lab={lab} onLabUpdate={onLabUpdate} />
          </div>

          {/* Data Explorer sub-tab content */}
          {openExplorers.map((explorer) => (
            <div
              key={explorer.id}
              style={{
                flex: 1, minHeight: 0,
                display: activeTab === explorer.id ? 'flex' : 'none',
                flexDirection: 'column', padding: 6, overflow: 'hidden',
              }}
            >
              <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>Loading Data Explorer…</div>}>
                <DataExplorerTab source={explorer.source} />
              </Suspense>
            </div>
          ))}
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

      {/* Pop-out portals for sub-tabs */}
      {popoutScripts.isPopout && popoutScripts.popoutContainer && createPortal(
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 6, overflow: 'hidden', height: '100%' }}>
          <LabScriptsPane lab={lab} debug={debug} appConfig={appConfig} onAnalyze={openAnalyze} saveAllRef={saveAllRef} />
        </div>,
        popoutScripts.popoutContainer
      )}
      {popoutResults.isPopout && popoutResults.popoutContainer && createPortal(
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 6, overflow: 'hidden', height: '100%' }}>
          <LabResultsPane lab={lab} debug={debug} debugVisible={debugMode !== 'hidden'} runDebugRef={runDebugRef} onAnalyze={openAnalyze} appConfig={appConfig} saveAllRef={saveAllRef} onShowDebugPanel={showDebugPanel} />
        </div>,
        popoutResults.popoutContainer
      )}
      {popoutOutput.isPopout && popoutOutput.popoutContainer && createPortal(
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 6, overflow: 'hidden', height: '100%' }}>
          <FileManagerEditor
            apiBasePath={`/api/v1/labs/${lab.id}/current_output`}
            showUpload={false}
            showDelete={false}
            readOnly
            showModificationDate
            title="Current output"
            csvPreviewMaxRows={appConfig?.csvPreviewMaxRows}
            previewMaxFileSize={appConfig?.previewMaxFileSize}
            onAnalyze={(fileName) => openAnalyze({ labId: lab.id, apiPath: `/api/v1/labs/${lab.id}/current_output`, fileName })}
          />
        </div>,
        popoutOutput.popoutContainer
      )}
      {popoutChat.isPopout && popoutChat.popoutContainer && createPortal(
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
          <LabChatPane lab={lab} chat={chat} />
        </div>,
        popoutChat.popoutContainer
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
