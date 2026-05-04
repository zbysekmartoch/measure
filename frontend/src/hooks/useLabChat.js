/**
 * useLabChat — WebSocket hook for real-time lab chat.
 *
 * Connects to /chat WebSocket, joins a lab room, and provides
 * messages, presence, typing indicators, and send/edit/delete actions.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

function normalizeChatWsBase(rawBase) {
  if (!rawBase) return null;
  try {
    const base = rawBase.trim();
    // Accept ws://, wss://, http://, https:// as explicit overrides
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      if (!u.pathname || u.pathname === '/') u.pathname = '/chat';
      return u;
    }
    if (/^wss?:\/\//i.test(base)) {
      const u = new URL(base);
      if (!u.pathname || u.pathname === '/') u.pathname = '/chat';
      return u;
    }
  } catch {
    // Invalid override -> ignore and use defaults
  }
  return null;
}

function buildChatWsCandidates(token) {
  const candidates = [];
  const seen = new Set();
  const add = (u) => {
    if (!u) return;
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(key);
  };

  const explicit = normalizeChatWsBase(import.meta.env.VITE_CHAT_WS_URL);
  if (explicit) {
    explicit.searchParams.set('token', token);
    add(explicit);
  }

  const pageProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sameOrigin = new URL(`${pageProto}//${window.location.host}/chat`);
  sameOrigin.searchParams.set('token', token);
  add(sameOrigin);

  // Dev/LAN fallback: when frontend runs on a dev/proxy port, try backend's default port directly.
  // This helps when reverse proxy/websocket upgrade for /chat is not configured on the frontend port.
  const isSecure = window.location.protocol === 'https:';
  if (!isSecure) {
    const host = window.location.hostname;
    const backendPort = String(import.meta.env.VITE_BACKEND_PORT || '50100');
    const directBackend = new URL(`ws://${host}:${backendPort}/chat`);
    directBackend.searchParams.set('token', token);
    add(directBackend);
  }

  return candidates;
}

export function useLabChat(labId) {
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const typingTimers = useRef(new Map());
  // Track unread count (messages arriving while component is mounted)
  const [unreadCount, setUnreadCount] = useState(0);
  const visibleRef = useRef(true);

  /** Mark chat as visible / not visible (controls unread counting) */
  const setVisible = useCallback((v) => {
    visibleRef.current = v;
    if (v) setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!labId) return;

    const token = localStorage.getItem('authToken');
    if (!token) return;
    const wsCandidates = buildChatWsCandidates(token);
    if (wsCandidates.length === 0) return;

    let reconnectTimer;
    let connectTimer;
    let disposed = false;
    let preferredCandidateIndex = 0;
    const timers = typingTimers.current;
    const connectTimeoutMs = Number(import.meta.env.VITE_CHAT_WS_CONNECT_TIMEOUT_MS || 2500);

    function scheduleConnect(delay = 0) {
      connectTimer = setTimeout(() => connect(preferredCandidateIndex), delay);
    }

    function connect(candidateIndex = 0) {
      if (disposed) return;
      const url = wsCandidates[candidateIndex] || wsCandidates[0];
      console.log(`[useLabChat] Connecting to ${url.replace(/token=[^&]+/, 'token=***')} (${candidateIndex + 1}/${wsCandidates.length})`);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      let opened = false;
      let movedToNextCandidate = false;

      const moveToNextCandidate = (reason) => {
        if (disposed || movedToNextCandidate) return;
        movedToNextCandidate = true;
        console.warn(`[useLabChat] Switching WS candidate (${reason})`);
        if (candidateIndex + 1 < wsCandidates.length) {
          connect(candidateIndex + 1);
        } else {
          scheduleConnect(3000);
        }
      };

      const connectWatchdog = setTimeout(() => {
        if (disposed || opened) return;
        console.warn(`[useLabChat] WS connect timeout after ${connectTimeoutMs}ms`);
        try { ws.close(); } catch { /* ignore */ }
        moveToNextCandidate('timeout');
      }, connectTimeoutMs);

      ws.addEventListener('open', () => {
        if (disposed) { ws.close(); return; }
        opened = true;
        clearTimeout(connectWatchdog);
        preferredCandidateIndex = candidateIndex;
        console.log('[useLabChat] WebSocket open');
        setConnected(true);
        ws.send(JSON.stringify({ type: 'join', labId }));
      });

      ws.addEventListener('message', (ev) => {
        if (disposed) return;
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }

        switch (data.type) {
          case 'history':
            setMessages(data.messages || []);
            break;

          case 'message':
            setMessages(prev => [...prev, data.message]);
            if (!visibleRef.current) {
              setUnreadCount(c => c + 1);
            }
            break;

          case 'edited':
            setMessages(prev => prev.map(m => m.id === data.message.id ? data.message : m));
            break;

          case 'deleted':
            setMessages(prev => prev.filter(m => m.id !== data.messageId));
            break;

          case 'reacted':
            setMessages(prev => prev.map(m => m.id === data.message.id ? data.message : m));
            break;

          case 'presence':
            setOnlineUsers(data.users || []);
            break;

          case 'typing': {
            const key = data.userId;
            setTypingUsers(prev => {
              if (prev.some(u => u.userId === key)) return prev;
              return [...prev, { userId: data.userId, userName: data.userName }];
            });
            // Clear after 3s
            if (typingTimers.current.has(key)) clearTimeout(typingTimers.current.get(key));
            typingTimers.current.set(key, setTimeout(() => {
              setTypingUsers(prev => prev.filter(u => u.userId !== key));
              typingTimers.current.delete(key);
            }, 3000));
            break;
          }

          default:
            break;
        }
      });

      ws.addEventListener('close', (ev) => {
        clearTimeout(connectWatchdog);
        console.log(`[useLabChat] WebSocket closed code=${ev.code} reason=${ev.reason || 'none'} wasClean=${ev.wasClean}`);
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (!disposed) {
          // If handshake failed before open, try next candidate immediately.
          if (!opened) {
            if (!movedToNextCandidate) {
              moveToNextCandidate('close-before-open');
            }
            return;
          }
          scheduleConnect(3000);
        }
      });

      ws.addEventListener('error', (ev) => {
        console.error('[useLabChat] WebSocket error:', ev);
        if (!opened) {
          try { ws.close(); } catch { /* ignore */ }
          moveToNextCandidate('error-before-open');
        }
      });
    }

    // Defer initial connect so StrictMode cleanup can cancel before the socket is created
    scheduleConnect(0);

    return () => {
      disposed = true;
      clearTimeout(connectTimer);
      clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [labId]);

  const sendMessage = useCallback((text, { threadId, mentions, fileLinks } = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'message', text, threadId, mentions, fileLinks }));
  }, []);

  const editMsg = useCallback((messageId, text) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'edit', messageId, text }));
  }, []);

  const deleteMsg = useCallback((messageId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'delete', messageId }));
  }, []);

  const sendTyping = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'typing' }));
  }, []);

  const sendReaction = useCallback((messageId, reactionKey) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'react', messageId, reactionKey }));
  }, []);

  return {
    messages,
    onlineUsers,
    typingUsers,
    connected,
    unreadCount,
    setVisible,
    sendMessage,
    editMessage: editMsg,
    deleteMessage: deleteMsg,
    sendTyping,
    sendReaction,
  };
}
