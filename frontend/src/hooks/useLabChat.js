/**
 * useLabChat — WebSocket hook for real-time lab chat.
 *
 * Connects to /chat WebSocket, joins a lab room, and provides
 * messages, presence, typing indicators, and send/edit/delete actions.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

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

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/chat?token=${encodeURIComponent(token)}`;

    let reconnectTimer;
    let connectTimer;
    let disposed = false;
    const timers = typingTimers.current;

    function scheduleConnect(delay = 0) {
      connectTimer = setTimeout(connect, delay);
    }

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (disposed) { ws.close(); return; }
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

      ws.addEventListener('close', () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (!disposed) {
          scheduleConnect(3000);
        }
      });

      ws.addEventListener('error', () => {
        // onclose will fire after this
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
