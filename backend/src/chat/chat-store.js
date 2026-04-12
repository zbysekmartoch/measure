/**
 * chat-store.js — persistent chat storage for labs.
 *
 * Each lab stores chat data in  labs/<id>/chat.json.
 * Structure:
 * {
 *   messages: [
 *     { id, userId, userName, text, threadId, mentions, fileLinks, createdAt }
 *   ]
 * }
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LABS_ROOT = path.resolve(__dirname, '../../labs');

function chatPath(labId) {
  return path.join(LABS_ROOT, String(labId), 'chat.json');
}

/** Read all chat data for a lab */
export async function readChat(labId) {
  try {
    const raw = await fs.readFile(chatPath(labId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { messages: [] };
  }
}

/** Write chat data for a lab */
async function writeChat(labId, data) {
  await fs.writeFile(chatPath(labId), JSON.stringify(data, null, 2), 'utf-8');
}

/** Add a message to a lab's chat. Returns the created message. */
export async function addMessage(labId, { userId, userName, text, threadId, mentions, fileLinks }) {
  const data = await readChat(labId);
  const message = {
    id: crypto.randomUUID(),
    userId,
    userName,
    text: String(text).slice(0, 5000), // limit message size
    threadId: threadId || null,
    mentions: Array.isArray(mentions) ? mentions : [],
    fileLinks: Array.isArray(fileLinks) ? fileLinks : [],
    createdAt: new Date().toISOString(),
  };
  data.messages.push(message);
  await writeChat(labId, data);
  return message;
}

/** Edit a message (only by the original author). Returns updated message or null. */
export async function editMessage(labId, messageId, userId, newText) {
  const data = await readChat(labId);
  const msg = data.messages.find(m => m.id === messageId);
  if (!msg || String(msg.userId) !== String(userId)) return null;
  msg.text = String(newText).slice(0, 5000);
  msg.editedAt = new Date().toISOString();
  await writeChat(labId, data);
  return msg;
}

/** Delete a message (only by the original author). Returns true on success. */
export async function deleteMessage(labId, messageId, userId) {
  const data = await readChat(labId);
  const idx = data.messages.findIndex(m => m.id === messageId);
  if (idx === -1) return false;
  if (String(data.messages[idx].userId) !== String(userId)) return false;
  data.messages.splice(idx, 1);
  await writeChat(labId, data);
  return true;
}

/** Toggle a reaction on a message. Returns updated message or null. */
export async function toggleReaction(labId, messageId, userId, userName, reactionKey) {
  const data = await readChat(labId);
  const msg = data.messages.find(m => m.id === messageId);
  if (!msg) return null;
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[reactionKey]) msg.reactions[reactionKey] = [];
  const arr = msg.reactions[reactionKey];
  const idx = arr.findIndex(r => String(r.userId) === String(userId));
  if (idx >= 0) {
    arr.splice(idx, 1);
    if (arr.length === 0) delete msg.reactions[reactionKey];
  } else {
    arr.push({ userId, userName });
  }
  await writeChat(labId, data);
  return msg;
}

/** Get messages for a lab, with optional threadId filter */
export async function getMessages(labId, { threadId, since } = {}) {
  const data = await readChat(labId);
  let msgs = data.messages;
  if (threadId) {
    msgs = msgs.filter(m => m.threadId === threadId || m.id === threadId);
  }
  if (since) {
    msgs = msgs.filter(m => m.createdAt > since);
  }
  return msgs;
}
