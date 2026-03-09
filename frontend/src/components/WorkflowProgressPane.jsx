/**
 * WorkflowProgressPane — Narrow vertical panel on the left showing workflow execution progress.
 *
 * Displays a list of workflow steps with real-time status indicators:
 *   ○  pending     — not yet started (grey circle)
 *   ●  running     — currently executing (blue pulsing dot)
 *   ✓  completed   — finished successfully (green checkmark + duration)
 *   !  failed      — script failed (red exclamation + duration)
 *   ⊘  skipped     — skipped due to earlier failure
 *   ⏳ debug-waiting — waiting for debugger to attach (orange, animated)
 *   ⏸  debug-stopped — paused in debugger (red, blinking)
 *
 * Props:
 *   workflowState — state object from useWorkflowEvents hook or backend snapshot
 *   onClose       — callback to close/hide the progress pane
 */
import React from 'react';

// ── Step status icons & colors ──────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:         { icon: '○', color: '#9ca3af', bg: 'transparent', label: 'Pending' },
  running:         { icon: '●', color: '#2563eb', bg: '#dbeafe',     label: 'Running', animate: true },
  completed:       { icon: '✓', color: '#16a34a', bg: '#dcfce7',     label: 'Completed' },
  failed:          { icon: '!', color: '#dc2626', bg: '#fee2e2',     label: 'Failed' },
  skipped:         { icon: '⊘', color: '#9ca3af', bg: '#f3f4f6',     label: 'Skipped' },
  'debug-waiting': { icon: '⏳', color: '#d97706', bg: '#fef3c7',    label: 'Waiting for debugger', animate: true },
  'debug-stopped': { icon: '⏸', color: '#dc2626', bg: '#fef3c7',    label: 'Paused in debugger', animate: true },
};

/**
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

/**
 * Single step row in the progress list.
 */
function StepRow({ step, isLast }) {
  const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      position: 'relative',
      paddingBottom: isLast ? 0 : 6,
    }}>
      {/* Vertical connector line */}
      {!isLast && (
        <div style={{
          position: 'absolute',
          left: 10,
          top: 22,
          bottom: 0,
          width: 2,
          background: step.status === 'completed' ? '#86efac' : '#e5e7eb',
        }} />
      )}

      {/* Status icon */}
      <div style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: step.status === 'debug-waiting' || step.status === 'debug-stopped' ? 11 : 13,
        fontWeight: 700,
        color: cfg.color,
        background: cfg.bg,
        border: `2px solid ${cfg.color}`,
        flexShrink: 0,
        zIndex: 1,
        animation: cfg.animate ? 'wfPulse 1.2s ease-in-out infinite' : 'none',
      }}>
        {cfg.icon}
      </div>

      {/* Step info */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <span style={{
          fontSize: 12,
          fontWeight: step.status === 'running' || step.status === 'debug-waiting' || step.status === 'debug-stopped' ? 600 : 400,
          color: step.status === 'skipped' ? '#9ca3af' : '#1f2937',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          wordBreak: 'break-all',
          lineHeight: 1.3,
        }}>
          {step.name}
        </span>

        {/* Duration badge */}
        {step.durationMs != null && (
          <span style={{
            fontSize: 10,
            color: '#6b7280',
            background: '#f3f4f6',
            padding: '0 4px',
            borderRadius: 3,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            whiteSpace: 'nowrap',
            marginLeft: 4,
          }}>
            {formatDuration(step.durationMs)}
          </span>
        )}

        {/* Status label for special states */}
        {(step.status === 'debug-waiting' || step.status === 'debug-stopped' || step.status === 'failed') && (
          <div style={{
            fontSize: 10,
            color: cfg.color,
            marginTop: 1,
            fontStyle: 'italic',
          }}>
            {cfg.label}
            {step.error && ` — ${step.error}`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Workflow status header bar.
 */
function WorkflowHeader({ workflowState, onClose }) {
  const status = workflowState?.status || 'idle';
  const steps = workflowState?.steps || [];
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const total = steps.length;

  const headerColors = {
    idle:      { bg: '#f3f4f6', color: '#374151', label: 'Idle' },
    running:   { bg: '#dbeafe', color: '#1d4ed8', label: 'Running' },
    completed: { bg: '#dcfce7', color: '#166534', label: 'Completed' },
    failed:    { bg: '#fee2e2', color: '#991b1b', label: 'Failed' },
    aborted:   { bg: '#fef3c7', color: '#92400e', label: 'Aborted' },
  };

  const cfg = headerColors[status] || headerColors.idle;

  // Calculate total duration
  let totalDuration = null;
  if (workflowState?.startedAt) {
    const start = new Date(workflowState.startedAt).getTime();
    const end = workflowState?.completedAt
      ? new Date(workflowState.completedAt).getTime()
      : Date.now();
    totalDuration = end - start;
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '5px 8px',
      background: cfg.bg,
      borderRadius: 5,
      marginBottom: 6,
      border: `1px solid ${cfg.color}22`,
      gap: 4,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: cfg.color,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {workflowState?.debugVisible ? '🛠 Debug' : '▶ Run'} — {cfg.label}
        </span>

        <span style={{ fontSize: 10, color: '#6b7280' }}>
          {completed}/{total}
          {failed > 0 && <span style={{ color: '#dc2626' }}> ({failed}✕)</span>}
          {totalDuration != null && (
            <span style={{ marginLeft: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              {formatDuration(totalDuration)}
            </span>
          )}
        </span>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            color: '#9ca3af',
            padding: '0 2px',
            lineHeight: 1,
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; }}
          title="Close progress panel"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Progress bar (thin bar showing completion percentage).
 */
function WorkflowProgressBar({ workflowState }) {
  const steps = workflowState?.steps || [];
  const total = steps.length;
  if (total === 0) return null;

  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const pct = ((completed + failed) / total) * 100;

  return (
    <div style={{
      height: 3,
      background: '#e5e7eb',
      borderRadius: 2,
      overflow: 'hidden',
      marginBottom: 6,
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: failed > 0 ? '#dc2626' : '#16a34a',
        transition: 'width 0.3s ease',
        borderRadius: 2,
      }} />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function WorkflowProgressPane({ workflowState, onClose }) {
  if (!workflowState || !workflowState.steps || workflowState.steps.length === 0) {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: '#fafbfc',
      borderRight: '1px solid #e5e7eb',
      padding: '8px 8px 8px 8px',
      width: 220,
      minWidth: 180,
      maxWidth: 280,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <WorkflowHeader workflowState={workflowState} onClose={onClose} />
      <WorkflowProgressBar workflowState={workflowState} />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        paddingRight: 2,
      }}>
        {workflowState.steps.map((step, i) => (
          <StepRow
            key={`${step.name}-${i}`}
            step={step}
            isLast={i === workflowState.steps.length - 1}
          />
        ))}
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes wfPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.92); }
        }
      `}</style>
    </div>
  );
}
