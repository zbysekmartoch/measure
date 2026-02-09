/**
 * DebugPanel.jsx — Debug controls, call stack, and variables panel.
 *
 * Used inside LabResultsPane when a debug session is active.
 *
 * Props: everything from useDebugSession() hook
 */
import React, { useState, useCallback } from 'react';

// ── Styles ──────────────────────────────────────────────────────────────────

const toolbarStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px',
  background: '#1e1e1e', borderRadius: 6,
  flexWrap: 'wrap',
};

const btnStyle = (enabled = true) => ({
  padding: '5px 10px', border: 'none', borderRadius: 4,
  fontSize: 13, fontWeight: 500,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.4,
  color: '#fff',
  background: '#333',
  display: 'flex', alignItems: 'center', gap: 4,
});

const statusBadge = (status) => {
  const colors = {
    idle: { bg: '#374151', fg: '#d1d5db' },
    connecting: { bg: '#92400e', fg: '#fef3c7' },
    attached: { bg: '#1d4ed8', fg: '#dbeafe' },
    running: { bg: '#166534', fg: '#dcfce7' },
    stopped: { bg: '#b91c1c', fg: '#fee2e2' },
    ended: { bg: '#374151', fg: '#d1d5db' },
  };
  const c = colors[status] || colors.idle;
  return {
    padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
    background: c.bg, color: c.fg, textTransform: 'uppercase',
  };
};

const panelStyle = {
  display: 'flex', flexDirection: 'column', gap: 6,
  height: '100%', minHeight: 0,
};

const sectionStyle = {
  background: '#1e1e1e', borderRadius: 6, color: '#d4d4d4',
  fontSize: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
};

const sectionHeader = {
  padding: '6px 10px', fontWeight: 600, fontSize: 11,
  background: '#252526', color: '#ccc', textTransform: 'uppercase',
  borderBottom: '1px solid #333',
};

const listItem = (selected) => ({
  padding: '4px 10px', cursor: 'pointer',
  background: selected ? '#094771' : 'transparent',
  color: selected ? '#fff' : '#d4d4d4',
  fontSize: 12, fontFamily: 'monospace',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  borderBottom: '1px solid #2a2a2a',
});

// ── DebugToolbar ────────────────────────────────────────────────────────────

function DebugToolbar({ status, onAttach, onDetach, onContinue, onNext, onStepIn, onStepOut }) {
  const isStopped = status === 'stopped';
  const isRunning = status === 'running';
  const canStep = isStopped;
  const canAttach = status === 'idle' || status === 'ended';
  const canDetach = status !== 'idle' && status !== 'ended';

  return (
    <div style={toolbarStyle}>
      <span style={statusBadge(status)}>{status}</span>

      {canAttach && (
        <button style={{ ...btnStyle(true), background: '#166534' }} onClick={onAttach} title="Attach debugger">
          🔗 Attach
        </button>
      )}

      {canDetach && (
        <button style={{ ...btnStyle(true), background: '#991b1b' }} onClick={onDetach} title="Stop debug session">
          ⏹ Stop
        </button>
      )}

      <span style={{ width: 1, height: 20, background: '#555' }} />

      <button style={btnStyle(canStep)} disabled={!canStep} onClick={onContinue} title="Continue (F8)">
        ▶ Continue <span style={{fontSize:10,opacity:0.6}}>F8</span>
      </button>
      <button style={btnStyle(canStep)} disabled={!canStep} onClick={onNext} title="Step Over (F10)">
        ⤵ Step Over <span style={{fontSize:10,opacity:0.6}}>F10</span>
      </button>
      <button style={btnStyle(canStep)} disabled={!canStep} onClick={onStepIn} title="Step In (F11)">
        ↓ Step In <span style={{fontSize:10,opacity:0.6}}>F11</span>
      </button>
      <button style={btnStyle(canStep)} disabled={!canStep} onClick={onStepOut} title="Step Out (Shift+F11)">
        ↑ Step Out
      </button>

      {isRunning && (
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>
          ⏳ Running…
        </span>
      )}
    </div>
  );
}

// ── CallStackPanel ──────────────────────────────────────────────────────────

function CallStackPanel({ frames, selectedFrameId, onSelectFrame }) {
  if (!frames || frames.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionHeader}>Call Stack</div>
        <div style={{ padding: 10, color: '#6b7280', fontSize: 11 }}>No frames</div>
      </div>
    );
  }

  return (
    <div style={{ ...sectionStyle, flex: '0 0 auto', maxHeight: 200, overflow: 'auto' }}>
      <div style={sectionHeader}>Call Stack ({frames.length})</div>
      <div style={{ overflow: 'auto' }}>
        {frames.map((frame) => (
          <div
            key={frame.id}
            style={listItem(frame.id === selectedFrameId)}
            onClick={() => onSelectFrame(frame.id)}
            title={`${frame.source?.path || '?'}:${frame.line}`}
          >
            <span style={{ color: '#569cd6' }}>{frame.name}</span>
            <span style={{ color: '#808080', marginLeft: 8 }}>
              {frame.source?.name || '?'}:{frame.line}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── VariablesPanel ──────────────────────────────────────────────────────────

function VariableRow({ variable, depth = 0, onExpand }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);

  const hasChildren = variable.variablesReference > 0;

  const handleToggle = useCallback(async () => {
    if (!hasChildren) return;
    if (expanded) {
      setExpanded(false);
    } else {
      const kids = await onExpand(variable.variablesReference);
      setChildren(kids);
      setExpanded(true);
    }
  }, [expanded, hasChildren, variable.variablesReference, onExpand]);

  const valueColor = () => {
    const t = (variable.type || '').toLowerCase();
    if (t === 'int' || t === 'float' || t === 'complex') return '#b5cea8';
    if (t === 'str') return '#ce9178';
    if (t === 'bool') return '#569cd6';
    if (t === 'nonetype') return '#808080';
    return '#d4d4d4';
  };

  return (
    <>
      <div
        style={{
          padding: '2px 6px 2px ' + (10 + depth * 16) + 'px',
          fontFamily: 'monospace', fontSize: 12,
          display: 'flex', gap: 6, alignItems: 'baseline',
          borderBottom: '1px solid #2a2a2a',
          cursor: hasChildren ? 'pointer' : 'default',
        }}
        onClick={handleToggle}
      >
        {hasChildren ? (
          <span style={{ width: 12, textAlign: 'center', color: '#808080', fontSize: 10 }}>
            {expanded ? '▼' : '▶'}
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}
        <span style={{ color: '#9cdcfe', minWidth: 60 }}>{variable.name}</span>
        <span style={{ color: '#808080', marginRight: 4 }}>=</span>
        <span style={{ color: valueColor(), wordBreak: 'break-all' }}>
          {variable.value}
        </span>
        {variable.type && (
          <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>{variable.type}</span>
        )}
      </div>
      {expanded && children.map((child, i) => (
        <VariableRow key={child.name + i} variable={child} depth={depth + 1} onExpand={onExpand} />
      ))}
    </>
  );
}

function VariablesPanel({ variables, onExpand }) {
  if (!variables || variables.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionHeader}>Variables</div>
        <div style={{ padding: 10, color: '#6b7280', fontSize: 11 }}>No variables</div>
      </div>
    );
  }

  return (
    <div style={{ ...sectionStyle, flex: 1, minHeight: 0 }}>
      <div style={sectionHeader}>Variables ({variables.length})</div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {variables.map((v, i) => (
          <VariableRow key={v.name + i} variable={v} onExpand={onExpand} />
        ))}
      </div>
    </div>
  );
}

// ── OutputPanel ─────────────────────────────────────────────────────────────

function OutputPanel({ output }) {
  return (
    <div style={{ ...sectionStyle, flex: '0 0 auto', maxHeight: 150 }}>
      <div style={sectionHeader}>Output</div>
      <div style={{
        overflow: 'auto', flex: 1, padding: 6,
        fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap',
        maxHeight: 120,
      }}>
        {output.length === 0 ? (
          <span style={{ color: '#6b7280' }}>No output yet</span>
        ) : (
          output.map((o, i) => (
            <span key={i} style={{ color: o.type === 'stderr' ? '#f87171' : '#d4d4d4' }}>
              {o.text}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main DebugPanel ─────────────────────────────────────────────────────────

export default function DebugPanel({
  status, debugInfo, callStack, variables, selectedFrameId,
  output, error,
  onAttach, onDetach, onContinue, onNext, onStepIn, onStepOut,
  onSelectFrame, onExpandVariable,
}) {
  return (
    <div style={panelStyle}>
      <DebugToolbar
        status={status}
        onAttach={onAttach}
        onDetach={onDetach}
        onContinue={onContinue}
        onNext={onNext}
        onStepIn={onStepIn}
        onStepOut={onStepOut}
      />

      {error && (
        <div style={{ padding: '6px 10px', background: '#7f1d1d', color: '#fecaca', borderRadius: 4, fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {debugInfo && (
        <div style={{ padding: '4px 10px', background: '#252526', color: '#808080', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' }}>
          Script: {debugInfo.scriptPath || '—'} | Port: {debugInfo.port || '—'} | PID: {debugInfo.pid || '—'}
        </div>
      )}

      <CallStackPanel frames={callStack} selectedFrameId={selectedFrameId} onSelectFrame={onSelectFrame} />
      <VariablesPanel variables={variables} onExpand={onExpandVariable} />
      <OutputPanel output={output} />
    </div>
  );
}
