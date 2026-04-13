/**
 * LabChatPane — integrated chat for a lab workspace.
 *
 * Features:
 *  - Real-time messages via WebSocket
 *  - @mentions with autocomplete
 *  - #fileLinks (references to scripts)
 *  - Emoji picker (common emojis)
 *  - Threaded replies
 *  - Online presence indicator
 *  - Typing indicators
 *  - Edit/delete own messages
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchJSON } from '../lib/fetchJSON.js';
import { shadow } from '../lib/uiConfig.js';

// ─── Common emojis for quick picker ─────────────────────────────────────────
const EMOJI_LIST = [
  '👍', '👎', '❤️', '😊', '😂', '🎉', '🔥', '✅', '❌', '👀',
  '🚀', '💡', '⚠️', '🐛', '📝', '🤔', '👏', '💪', '🙏', '✨',
];

// ─── Quick reactions — configurable list ────────────────────────────────────
const QUICK_REACTIONS = [
  { key: 'roger', icon: '👍', label: 'Roger', hint: 'Received' },
  { key: 'wilco', icon: '🫡', label: 'Wilco', hint: 'Will Comply' },
  { key: 'check', icon: '✔️', label: 'Yes', hint: 'Yes/Correct' },
  { key: 'cross', icon: '✖️', label: 'No', hint: 'No/Incorrect' },
  { key: 'thx', icon: '❤️', label: 'Thanks', hint: 'Thank you' },
  { key: 'lol', icon: '😂', label: 'LOL', hint: 'Laughing' },
  { key: 'thinking', icon: '🤔', label: 'Thinking', hint: "I’m thinking"},
  { key: 'clap', icon: '👏', label: 'Great', hint: 'Great job' },
  { key: 'wow', icon: '😮', label: 'Wow', hint: 'Wow' },  
  { key: 'please', icon: '🙏', label: 'Yes please', hint: 'Please do this' },


 



];

// ─── Parse @mentions and #fileLinks in text ─────────────────────────────────
function parseMessageContent(text) {
  const parts = [];
  // Match @Name Name or #path/to/file.py
  const regex = /(@[\w][\w ]*(?=\s|$|[.,!?]))|(#[\w./-]+)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      parts.push({ type: 'mention', value: match[1] });
    } else if (match[2]) {
      parts.push({ type: 'fileLink', value: match[2] });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}

// ─── Rendered message text with highlighted mentions and file links ──────────
function MessageText({ text }) {
  const parts = parseMessageContent(text);
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => {
        if (p.type === 'mention') {
          return (
            <span key={i} style={{
              background: '#dbeafe', color: '#1d4ed8', borderRadius: 3,
              padding: '0 3px', fontWeight: 500,
            }}>
              {p.value}
            </span>
          );
        }
        if (p.type === 'fileLink') {
          return (
            <span key={i} style={{
              background: '#fef3c7', color: '#92400e', borderRadius: 3,
              padding: '0 3px', fontFamily: 'monospace', fontSize: '0.92em',
            }}>
              {p.value}
            </span>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </span>
  );
}

// ─── Single message component ────────────────────────────────────────────────
function ChatMessage({ msg, currentUserId, onReply, onEdit, onDelete, onReact, threadCount }) {
  const [hovering, setHovering] = useState(false);
  const isOwn = String(msg.userId) === String(currentUserId);
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = new Date(msg.createdAt).toLocaleDateString();
  const reactions = msg.reactions || {};

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #ccd4e6',
        position: 'relative',
        background: hovering ? '#f9fafb' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: isOwn ? '#1d4ed8' : '#111827' }}>
          {msg.userName}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af' }} title={`${date} ${time}`}>
          {time}
        </span>
        {msg.editedAt && (
          <span style={{ fontSize: 10, color: '#9ca3af', fontStyle: 'italic' }}>(edited)</span>
        )}
        {/* Action buttons on hover */}
        {hovering && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {QUICK_REACTIONS.map(r => (
              <button key={r.key} onClick={() => onReact(msg.id, r.key)}
                title={`${r.label} (${r.hint})`} style={actionBtnStyle}>
                {r.icon}
              </button>
            ))}
            <button onClick={() => onReply(msg)} title="Reply in thread"
              style={actionBtnStyle}>💬</button>
            {isOwn && (
              <>
                <button onClick={() => onEdit(msg)} title="Edit"
                  style={actionBtnStyle}>✏️</button>
                <button onClick={() => onDelete(msg.id)} title="Delete"
                  style={actionBtnStyle}>🗑</button>
              </>
            )}
          </span>
        )}
      </div>
      <div style={{ fontSize: 16, marginTop: 8,marginBottom: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
        <MessageText text={msg.text} />
      </div>
      {/* Reactions display — grouped by user, one line per person */}
      {Object.keys(reactions).length > 0 && (() => {
        // Build map: userName → { userId, reactions: [{ key, icon, label }] }
        const byUser = new Map();
        for (const r of QUICK_REACTIONS) {
          for (const u of (reactions[r.key] || [])) {
            if (!byUser.has(u.userId)) byUser.set(u.userId, { userName: u.userName, userId: u.userId, items: [] });
            byUser.get(u.userId).items.push(r);
          }
        }
        return (
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6 }}>
            {[...byUser.values()].map(entry => (
              <div key={entry.userId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  fontWeight: 500, color: '#6d7e9b', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {entry.userName}
                </span>
                {entry.items.map(r => (
                  <button
                    key={r.key}
                    onClick={() => onReact(msg.id, r.key)}
                    title={`${r.label} (${r.hint})`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '1px 6px', fontSize: 11, borderRadius: 10,
                      border: `1px solid ${String(entry.userId) === String(currentUserId) ? '#93c5fd' : '#e5e7eb'}`,
                      background: String(entry.userId) === String(currentUserId) ? '#eff6ff' : '#f9fafb',
                      cursor: 'pointer', lineHeight: 1.4, color: '#374151',
                    }}
                  >
                    <span>{r.icon}</span>
                    <span>{r.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        );
      })()}
      {/* Thread indicator */}
      {threadCount > 0 && !msg.threadId && (
        <button
          onClick={() => onReply(msg)}
          style={{
            marginTop: 4, fontSize: 11, color: '#2563eb', background: '#eff6ff',
            border: '1px solid #bfdbfe', borderRadius: 4, padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          💬 {threadCount} {threadCount === 1 ? 'reply' : 'replies'}
        </button>
      )}
    </div>
  );
}

const actionBtnStyle = {
  background: '#fff', border: '1px solid #d1d5db', borderRadius: 4,
  padding: '4px 5px', cursor: 'pointer', fontSize: 12, lineHeight: 1,
};

// ─── Autocomplete dropdown ───────────────────────────────────────────────────
function AutocompleteDropdown({ items, onSelect, type }) {
  if (!items.length) return null;
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0,
      background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
      boxShadow: shadow.normal, maxHeight: 180, overflowY: 'auto', zIndex: 100,
      marginBottom: 4,
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onSelect(item)}
          style={{
            padding: '6px 10px', cursor: 'pointer', fontSize: 13,
            borderBottom: i < items.length - 1 ? '1px solid #f3f4f6' : 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
        >
          {type === 'mention' && <span>👤 {item.label}</span>}
          {type === 'file' && <span>📄 {item.label}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Main Chat Component ─────────────────────────────────────────────────────
export default function LabChatPane({ lab, chat }) {
  const { user } = useAuth();
  const {
    messages, onlineUsers, typingUsers, connected,
    sendMessage, editMessage, deleteMessage, sendTyping, sendReaction,
  } = chat;

  const [inputText, setInputText] = useState('');
  const [editingMsg, setEditingMsg] = useState(null);
  const [threadParent, setThreadParent] = useState(null);
  const [showEmojis, setShowEmojis] = useState(false);
  const [autocomplete, setAutocomplete] = useState(null); // { type, items, query }
  const [allUsers, setAllUsers] = useState([]);
  const [scriptFiles, setScriptFiles] = useState([]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(120);
  const typingThrottle = useRef(0);

  // Fetch users for @mention autocomplete
  useEffect(() => {
    fetchJSON('/api/v1/users')
      .then(data => setAllUsers(data.items || []))
      .catch(() => {});
  }, []);

  // Fetch scripts for #file autocomplete
  useEffect(() => {
    if (!lab?.id) return;
    fetchJSON(`/api/v1/labs/${lab.id}/scripts`)
      .then(data => {
        const flatFiles = [];
        function walk(items, prefix = '') {
          for (const item of items) {
            const p = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.type === 'file') flatFiles.push(p);
            if (item.children) walk(item.children, p);
          }
        }
        walk(data.items || []);
        setScriptFiles(flatFiles);
      })
      .catch(() => {});
  }, [lab?.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Filter messages for current view (thread or main)
  const displayMessages = useMemo(() => {
    if (threadParent) {
      return messages.filter(m => m.id === threadParent.id || m.threadId === threadParent.id);
    }
    // Show top-level messages (no threadId) and their reply counts
    return messages.filter(m => !m.threadId);
  }, [messages, threadParent]);

  // Count thread replies per message
  const threadCounts = useMemo(() => {
    const counts = {};
    for (const m of messages) {
      if (m.threadId) {
        counts[m.threadId] = (counts[m.threadId] || 0) + 1;
      }
    }
    return counts;
  }, [messages]);

  // ── Input handling with autocomplete ──
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    // Throttled typing indicator
    const now = Date.now();
    if (now - typingThrottle.current > 2000) {
      typingThrottle.current = now;
      sendTyping();
    }

    // Check for @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const mentionMatch = textBefore.match(/@([\w]*)$/);
    if (mentionMatch) {
      const q = mentionMatch[1].toLowerCase();
      const items = allUsers
        .filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q))
        .slice(0, 8)
        .map(u => ({ label: `${u.firstName} ${u.lastName}`, value: `@${u.firstName} ${u.lastName}`, userId: u.id }));
      setAutocomplete(items.length ? { type: 'mention', items, startPos: cursorPos - mentionMatch[0].length } : null);
      return;
    }

    // Check for #file trigger
    const fileMatch = textBefore.match(/#([\w./-]*)$/);
    if (fileMatch) {
      const q = fileMatch[1].toLowerCase();
      const items = scriptFiles
        .filter(f => f.toLowerCase().includes(q))
        .slice(0, 8)
        .map(f => ({ label: f, value: `#${f}` }));
      setAutocomplete(items.length ? { type: 'file', items, startPos: cursorPos - fileMatch[0].length } : null);
      return;
    }

    setAutocomplete(null);
  };

  const handleAutocompleteSelect = (item) => {
    if (!autocomplete) return;
    const before = inputText.slice(0, autocomplete.startPos);
    const after = inputText.slice(inputRef.current?.selectionStart || autocomplete.startPos + 1);
    setInputText(before + item.value + ' ' + after);
    setAutocomplete(null);
    inputRef.current?.focus();
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;

    // Extract mentions and file links from text
    const mentions = [];
    const fileLinks = [];
    const mentionRegex = /@([\w][\w ]*)/g;
    let m;
    while ((m = mentionRegex.exec(text)) !== null) {
      const name = m[1].trim();
      const usr = allUsers.find(u => `${u.firstName} ${u.lastName}` === name);
      if (usr) mentions.push(usr.id);
    }
    const fileLinkRegex = /#([\w./-]+)/g;
    while ((m = fileLinkRegex.exec(text)) !== null) {
      fileLinks.push(m[1]);
    }

    if (editingMsg) {
      editMessage(editingMsg.id, text);
      setEditingMsg(null);
    } else {
      sendMessage(text, {
        threadId: threadParent?.id || undefined,
        mentions: mentions.length ? mentions : undefined,
        fileLinks: fileLinks.length ? fileLinks : undefined,
      });
    }
    setInputText('');
    setShowEmojis(false);
    setAutocomplete(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (autocomplete) { setAutocomplete(null); return; }
      if (editingMsg) { setEditingMsg(null); setInputText(''); return; }
      if (threadParent) { setThreadParent(null); return; }
    }
  };

  const handleReply = (msg) => {
    setThreadParent(msg);
    inputRef.current?.focus();
  };

  const handleEdit = (msg) => {
    setEditingMsg(msg);
    setInputText(msg.text);
    inputRef.current?.focus();
  };

  const handleDelete = (messageId) => {
    deleteMessage(messageId);
  };

  const insertEmoji = (emoji) => {
    setInputText(prev => prev + emoji);
    setShowEmojis(false);
    inputRef.current?.focus();
  };

  // ── Splitter drag handler ──
  const onSplitterMouseDown = (e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const doc = container.ownerDocument;
    const startY = e.clientY;
    const startHeight = inputAreaHeight;

    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      const containerH = container.getBoundingClientRect().height;
      const newH = Math.max(80, Math.min(containerH * 0.7, startHeight + delta));
      setInputAreaHeight(newH);
    };
    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.body.style.userSelect = '';
      doc.body.style.cursor = '';
    };
    doc.body.style.userSelect = 'none';
    doc.body.style.cursor = 'row-resize';
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Header bar */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        {threadParent && (
          <button
            onClick={() => setThreadParent(null)}
            style={{
              background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4,
              padding: '2px 8px', cursor: 'pointer', fontSize: 12,
            }}
          >
            ← Back
          </button>
        )}
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {threadParent ? `Thread: ${threadParent.userName}` : '💬 Chat'}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: connected ? '#16a34a' : '#dc2626',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: connected ? '#16a34a' : '#dc2626', display: 'inline-block',
          }} />
          {connected ? `${onlineUsers.length} online` : 'Disconnected'}
        </span>
      </div>

      {/* Online users bar */}
      {onlineUsers.length > 0 && (
        <div style={{
          padding: '4px 12px', borderBottom: '1px solid #f3f4f6',
          fontSize: 11, color: '#6b7280', display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0,
        }}>
          {onlineUsers.map(u => (
            <span key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
              {u.userName}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {displayMessages.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            {threadParent ? 'No replies yet' : 'No messages yet. Start the conversation!'}
          </div>
        )}
        {displayMessages.map(msg => (
          <ChatMessage
            key={msg.id}
            msg={msg}
            currentUserId={user?.id}
            onReply={handleReply}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onReact={sendReaction}
            threadCount={threadCounts[msg.id] || 0}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div style={{ padding: '3px 12px', fontSize: 11, color: '#6b7280', fontStyle: 'italic', flexShrink: 0 }}>
          {typingUsers.map(u => u.userName).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
        </div>
      )}

      {/* Splitter handle */}
      <div
        onMouseDown={onSplitterMouseDown}
        style={{
          height: 5, cursor: 'row-resize', flexShrink: 0,
          background: '#e5e7eb', borderTop: '1px solid #d1d5db', borderBottom: '1px solid #d1d5db',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#93c5fd'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#e5e7eb'; }}
      />

      {/* Input area */}
      <div style={{ height: inputAreaHeight, flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', borderTop: '1px solid #e5e7eb', padding: 8 }}>
        {/* Editing indicator */}
        {editingMsg && (
          <div style={{
            fontSize: 11, color: '#2563eb', marginBottom: 4,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ✏️ Editing message
            <button
              onClick={() => { setEditingMsg(null); setInputText(''); }}
              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}
            >Cancel</button>
          </div>
        )}

        {/* Thread reply indicator */}
        {threadParent && !editingMsg && (
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
            Replying to {threadParent.userName}
          </div>
        )}

        {/* Autocomplete */}
        {autocomplete && (
          <AutocompleteDropdown
            items={autocomplete.items}
            onSelect={handleAutocompleteSelect}
            type={autocomplete.type}
          />
        )}

        {/* Emoji picker */}
        {showEmojis && (
          <div style={{
            position: 'absolute', bottom: '100%', right: 8,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
            boxShadow: shadow.normal, padding: 8, display: 'flex', flexWrap: 'wrap',
            gap: 4, width: 220, marginBottom: 4, zIndex: 100,
          }}>
            {EMOJI_LIST.map(e => (
              <button key={e} onClick={() => insertEmoji(e)}
                style={{
                  background: 'none', border: 'none', fontSize: 18,
                  cursor: 'pointer', padding: 2, borderRadius: 4,
                }}
                onMouseEnter={ev => { ev.currentTarget.style.background = '#f3f4f6'; }}
                onMouseLeave={ev => { ev.currentTarget.style.background = 'none'; }}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flex: 1, minHeight: 0 }}>
          <button
            onClick={() => setShowEmojis(v => !v)}
            title="Emoji"
            style={{
              background: showEmojis ? '#dbeafe' : '#f3f4f6',
              border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 8px',
              cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
          >
            😊
          </button>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={threadParent ? 'Reply in thread…' : 'Type a message… (@mention, #file)'}
            style={{
              flex: 1, resize: 'none', padding: '6px 10px',
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13,
              fontFamily: 'inherit', lineHeight: 1.4,
              height: '100%',
              outline: 'none',
            }}
            onFocus={() => setShowEmojis(false)}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            style={{
              background: inputText.trim() ? '#2563eb' : '#9ca3af',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '6px 14px', cursor: inputText.trim() ? 'pointer' : 'default',
              fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap',
            }}
          >
            {editingMsg ? 'Save' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
