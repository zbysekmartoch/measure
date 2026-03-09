/**
 * useWorkflowEvents.js — React hook for subscribing to workflow SSE events.
 *
 * Connects to the backend SSE endpoint for real-time workflow progress.
 * Returns the current workflow state (steps, statuses, timing).
 *
 * Usage:
 *   const { workflowState, isConnected } = useWorkflowEvents(labId, resultId, active, reconnectKey);
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * @param {string} labId
 * @param {string} resultId
 * @param {boolean} active — whether to connect (false = disconnect)
 * @param {number} reconnectKey — change this value to force SSE reconnection (e.g. on new run)
 * @returns {{ workflowState: object|null, isConnected: boolean }}
 */
export function useWorkflowEvents(labId, resultId, active = false, reconnectKey = 0) {
  const [workflowState, setWorkflowState] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef(null);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!active || !labId || !resultId) {
      cleanup();
      return;
    }

    const token = localStorage.getItem('authToken');
    const url = `/api/v1/labs/${labId}/results/${resultId}/workflow/events?token=${token}`;

    // Close any existing connection before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('state', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setWorkflowState(data);
        setIsConnected(true);
      } catch { /* parse error */ }
    });

    // Specific events — we use the 'state' event for the full snapshot,
    // but individual events can be useful for animations/transitions.
    const eventTypes = [
      'workflow-start', 'step-start', 'step-complete', 'step-failed',
      'debug-waiting', 'debug-attached', 'debug-stopped',
      'workflow-complete', 'workflow-failed', 'workflow-aborted',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (ev) => {
        try {
          const data = JSON.parse(ev.data);
          window.dispatchEvent(new CustomEvent(`workflow:${eventType}`, { detail: data }));
        } catch { /* parse error */ }
      });
    }

    es.onerror = () => {
      setIsConnected(false);
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
      }
    };

    return cleanup;
    // reconnectKey is included so changing it forces a fresh SSE connection
  }, [labId, resultId, active, reconnectKey, cleanup]);

  return { workflowState, isConnected };
}
