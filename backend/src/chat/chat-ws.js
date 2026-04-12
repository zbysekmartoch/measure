/**
 * chat-ws.js — WebSocket server for real-time lab chat.
 *
 * Attaches to the HTTP server and upgrades `/chat` requests to WebSocket.
 * Each client joins a lab room identified by labId query param.
 *
 * Protocol (JSON messages):
 *   Client → Server:
 *     { type: 'join',    labId }
 *     { type: 'message', text, threadId?, mentions?, fileLinks? }
 *     { type: 'edit',    messageId, text }
 *     { type: 'delete',  messageId }
 *     { type: 'typing' }
 *
 *   Server → Client:
 *     { type: 'history',  messages }
 *     { type: 'message',  message }
 *     { type: 'edited',   message }
 *     { type: 'deleted',  messageId }
 *     { type: 'typing',   userId, userName }
 *     { type: 'presence', users }
 *     { type: 'error',    error }
 */
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { addMessage, editMessage, deleteMessage, getMessages, toggleReaction } from './chat-store.js';

/** Map<labId, Set<{ ws, userId, userName }>> */
const rooms = new Map();

function getRoom(labId) {
  if (!rooms.has(labId)) rooms.set(labId, new Set());
  return rooms.get(labId);
}

function broadcastToRoom(labId, data, excludeWs = null) {
  const room = rooms.get(labId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

function sendPresence(labId) {
  const room = rooms.get(labId);
  if (!room) return;
  const users = [...room].map(c => ({ userId: c.userId, userName: c.userName }));
  // Deduplicate by userId (user may have multiple tabs)
  const unique = [...new Map(users.map(u => [u.userId, u])).values()];
  broadcastToRoom(labId, { type: 'presence', users: unique });
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

/**
 * Attach the chat WebSocket server to an existing HTTP server.
 * @param {import('http').Server} server
 */
export function attachChatWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Hook into HTTP upgrade — handle /chat path
  const existingListeners = server.listeners('upgrade').slice();

  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/chat') {
      // Authenticate via query token
      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.userId = decoded.userId;
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      // Forward to other upgrade handlers (DAP proxy, etc.)
      for (const listener of existingListeners) {
        listener.call(server, req, socket, head);
      }
    }
  });

  wss.on('connection', async (ws, req) => {
    const userId = req.userId;
    let userName = 'Unknown';
    let labId = null;
    let client = null;

    // Look up user name
    try {
      const rows = await query('SELECT first_name, last_name FROM usr WHERE id = ?', [userId]);
      if (rows.length) {
        userName = `${rows[0].first_name} ${rows[0].last_name}`;
      }
    } catch { /* ignore */ }

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(ws, { type: 'error', error: 'Invalid JSON' });
      }

      switch (msg.type) {
        case 'join': {
          if (!msg.labId) return send(ws, { type: 'error', error: 'Missing labId' });
          // Leave previous room if any
          if (labId && client) {
            const prevRoom = rooms.get(labId);
            if (prevRoom) {
              prevRoom.delete(client);
              if (prevRoom.size === 0) rooms.delete(labId);
              else sendPresence(labId);
            }
          }
          labId = String(msg.labId);
          client = { ws, userId, userName };
          getRoom(labId).add(client);
          // Send chat history
          const messages = await getMessages(labId);
          send(ws, { type: 'history', messages });
          sendPresence(labId);
          break;
        }

        case 'message': {
          if (!labId) return send(ws, { type: 'error', error: 'Not joined to a lab' });
          if (!msg.text || !String(msg.text).trim()) return;
          const newMsg = await addMessage(labId, {
            userId,
            userName,
            text: msg.text,
            threadId: msg.threadId,
            mentions: msg.mentions,
            fileLinks: msg.fileLinks,
          });
          broadcastToRoom(labId, { type: 'message', message: newMsg });
          break;
        }

        case 'edit': {
          if (!labId) return send(ws, { type: 'error', error: 'Not joined to a lab' });
          if (!msg.messageId || !msg.text) return;
          const edited = await editMessage(labId, msg.messageId, userId, msg.text);
          if (edited) {
            broadcastToRoom(labId, { type: 'edited', message: edited });
          } else {
            send(ws, { type: 'error', error: 'Cannot edit this message' });
          }
          break;
        }

        case 'delete': {
          if (!labId) return send(ws, { type: 'error', error: 'Not joined to a lab' });
          if (!msg.messageId) return;
          const ok = await deleteMessage(labId, msg.messageId, userId);
          if (ok) {
            broadcastToRoom(labId, { type: 'deleted', messageId: msg.messageId });
          } else {
            send(ws, { type: 'error', error: 'Cannot delete this message' });
          }
          break;
        }

        case 'react': {
          if (!labId) return send(ws, { type: 'error', error: 'Not joined to a lab' });
          if (!msg.messageId || !msg.reactionKey) return;
          const reacted = await toggleReaction(labId, msg.messageId, userId, userName, msg.reactionKey);
          if (reacted) {
            broadcastToRoom(labId, { type: 'reacted', message: reacted });
          } else {
            send(ws, { type: 'error', error: 'Message not found' });
          }
          break;
        }

        case 'typing': {
          if (!labId) return;
          broadcastToRoom(labId, { type: 'typing', userId, userName }, ws);
          break;
        }

        default:
          send(ws, { type: 'error', error: `Unknown type: ${msg.type}` });
      }
    });

    ws.on('close', () => {
      if (labId && client) {
        const room = rooms.get(labId);
        if (room) {
          room.delete(client);
          if (room.size === 0) rooms.delete(labId);
          else sendPresence(labId);
        }
      }
    });

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.ping();
    }, 30_000);
    ws.on('close', () => clearInterval(pingInterval));
  });
}
