/**
 * Lock routes — exclusive file locking & lock request management.
 *
 * All routes require authentication (JWT).
 */
import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import {
  acquireLock,
  releaseLock,
  refreshLock,
  getLockStatus,
  getLocksForBasePath,
  createLockRequest,
  getLockRequestsForUser,
  dismissLockRequest,
  isReadonlyPath,
} from '../utils/file-locks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LABS_ROOT = path.resolve(__dirname, '../../labs');

const router = Router();

/** Helper: get user info from DB by userId. */
async function getUserInfo(userId) {
  const rows = await query(
    'SELECT id, first_name, last_name, email FROM usr WHERE id = ?',
    [userId],
  );
  if (!rows.length) return { id: userId, email: '', firstName: '', lastName: '' };
  const r = rows[0];
  return { id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name };
}

/** Read lab.json to check ownership. Returns ownerId or null. */
async function getLabOwnerId(labId) {
  if (!labId) return null;
  try {
    const raw = await fs.readFile(path.join(LABS_ROOT, String(labId), 'lab.json'), 'utf-8');
    return JSON.parse(raw).ownerId ?? null;
  } catch { return null; }
}

/** Check if userId is the lab owner for the given apiBasePath. */
async function isLabOwner(apiBasePath, userId) {
  const labId = extractLabId(apiBasePath);
  if (!labId) return false;
  const ownerId = await getLabOwnerId(labId);
  return ownerId != null && String(ownerId) === String(userId);
}

/**
 * Extract lab ID from apiBasePath like "/api/v1/labs/5/scripts".
 * Returns null if not a lab path.
 */
function extractLabId(apiBasePath) {
  const m = apiBasePath?.match(/\/labs\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Append a line to edit_history.csv inside the lab folder.
 * Format: soubor;od;do;kdo
 * Header is created if the file doesn't exist yet.
 */
async function appendEditHistory(labId, filePath, lockedAt, releasedAt, userName) {
  if (!labId) return;
  const csvPath = path.join(LABS_ROOT, String(labId), 'edit_history.csv');
  try {
    try {
      await fs.access(csvPath);
    } catch {
      // File doesn't exist — write BOM + header
      await fs.writeFile(csvPath, '\uFEFFfile;from;to;who\n', 'utf-8');
    }
    const line = `${filePath};${lockedAt};${releasedAt};${userName}\n`;
    await fs.appendFile(csvPath, line, 'utf-8');
  } catch {
    // Non-critical — don't fail the request
  }
}

// ─── Acquire lock ───────────────────────────────────────────────────────────

router.post('/acquire', async (req, res, next) => {
  try {
    const { apiBasePath, file } = req.body ?? {};
    if (!apiBasePath || !file) {
      return res.status(400).json({ error: 'Missing apiBasePath or file' });
    }
    if (isReadonlyPath(file)) {
      return res.status(403).json({ error: 'readonly', message: 'File is read-only' });
    }
    const user = await getUserInfo(req.userId);
    const result = acquireLock(
      apiBasePath,
      file,
      req.userId,
      user.email,
      `${user.firstName} ${user.lastName}`.trim(),
    );
    if (!result.ok) {
      return res.status(409).json(result);
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ─── Release lock ───────────────────────────────────────────────────────────

router.post('/release', async (req, res, next) => {
  try {
    const { apiBasePath, file } = req.body ?? {};
    if (!apiBasePath || !file) {
      return res.status(400).json({ error: 'Missing apiBasePath or file' });
    }
    // Read lock info before releasing (for edit history)
    const lockBefore = getLockStatus(apiBasePath, file);
    // Allow force release if the requester is the lab owner
    const isOwner = lockBefore.locked && lockBefore.userId !== req.userId
      ? await isLabOwner(apiBasePath, req.userId)
      : false;
    const result = releaseLock(apiBasePath, file, req.userId, isOwner);
    if (!result.ok) {
      return res.status(403).json(result);
    }
    // Log to edit_history.csv
    if (lockBefore.locked) {
      const labId = extractLabId(apiBasePath);
      const now = new Date().toISOString();
      appendEditHistory(labId, file, lockBefore.lockedAt, now, lockBefore.userName);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ─── Refresh lock TTL (heartbeat) ───────────────────────────────────────────

router.post('/refresh', (req, res) => {
  const { apiBasePath, file } = req.body ?? {};
  if (!apiBasePath || !file) {
    return res.status(400).json({ error: 'Missing apiBasePath or file' });
  }
  const ok = refreshLock(apiBasePath, file, req.userId);
  res.json({ ok });
});

// ─── Check lock status for a single file ────────────────────────────────────

router.get('/status', (req, res) => {
  const { apiBasePath, file } = req.query;
  if (!apiBasePath || !file) {
    return res.status(400).json({ error: 'Missing apiBasePath or file' });
  }
  const status = getLockStatus(apiBasePath, file);
  status.isMe = status.locked && status.userId === req.userId;
  res.json(status);
});

// ─── List all locks for a base path ─────────────────────────────────────────

router.get('/list', (req, res) => {
  const { apiBasePath } = req.query;
  if (!apiBasePath) {
    return res.status(400).json({ error: 'Missing apiBasePath' });
  }
  const locks = getLocksForBasePath(apiBasePath);
  // Annotate with isMe
  for (const [, lock] of Object.entries(locks)) {
    lock.isMe = lock.userId === req.userId;
  }
  res.json({ locks });
});

// ─── Request lock from holder ───────────────────────────────────────────────

router.post('/request', async (req, res, next) => {
  try {
    const { apiBasePath, file } = req.body ?? {};
    if (!apiBasePath || !file) {
      return res.status(400).json({ error: 'Missing apiBasePath or file' });
    }
    const user = await getUserInfo(req.userId);
    const result = createLockRequest(
      apiBasePath,
      file,
      req.userId,
      user.email,
      `${user.firstName} ${user.lastName}`.trim(),
    );
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ─── Get my pending lock requests (others asking me to release) ─────────────

router.get('/requests', (req, res) => {
  const requests = getLockRequestsForUser(req.userId);
  res.json({ requests });
});

// ─── Dismiss a lock request ─────────────────────────────────────────────────

router.post('/requests/:id/dismiss', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid request id' });
  const ok = dismissLockRequest(id, req.userId);
  res.json({ ok });
});

// ─── Release locks for a folder (prefix match) ─────────────────────────────

router.post('/release-folder', async (req, res, next) => {
  try {
    const { apiBasePath, folder } = req.body ?? {};
    if (!apiBasePath) {
      return res.status(400).json({ error: 'Missing apiBasePath' });
    }
    const isOwner = await isLabOwner(apiBasePath, req.userId);
    const locks = getLocksForBasePath(apiBasePath);
    const prefix = folder ? (folder + '/') : '';
    const released = [];
    for (const [filePath, lock] of Object.entries(locks)) {
      // Match files under the folder (or all if no folder specified)
      if (prefix && !filePath.startsWith(prefix) && filePath !== folder) continue;
      const canRelease = lock.userId === req.userId || isOwner;
      if (!canRelease) continue;
      const lockBefore = getLockStatus(apiBasePath, filePath);
      const result = releaseLock(apiBasePath, filePath, req.userId, isOwner);
      if (result.ok && lockBefore.locked) {
        const labId = extractLabId(apiBasePath);
        const now = new Date().toISOString();
        appendEditHistory(labId, filePath, lockBefore.lockedAt, now, lockBefore.userName);
        released.push(filePath);
      }
    }
    res.json({ ok: true, released });
  } catch (e) {
    next(e);
  }
});

// ─── Release all my locks for a base path ───────────────────────────────────

router.post('/release-all-mine', async (req, res, next) => {
  try {
    const { apiBasePath } = req.body ?? {};
    if (!apiBasePath) {
      return res.status(400).json({ error: 'Missing apiBasePath' });
    }
    const locks = getLocksForBasePath(apiBasePath);
    const released = [];
    for (const [filePath, lock] of Object.entries(locks)) {
      if (lock.userId !== req.userId) continue;
      const lockBefore = getLockStatus(apiBasePath, filePath);
      releaseLock(apiBasePath, filePath, req.userId);
      if (lockBefore.locked) {
        const labId = extractLabId(apiBasePath);
        const now = new Date().toISOString();
        appendEditHistory(labId, filePath, lockBefore.lockedAt, now, lockBefore.userName);
        released.push(filePath);
      }
    }
    res.json({ ok: true, released });
  } catch (e) {
    next(e);
  }
});

// ─── Check readonly status ──────────────────────────────────────────────────

router.get('/readonly', (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'Missing file' });
  res.json({ readonly: isReadonlyPath(file) });
});

export default router;
