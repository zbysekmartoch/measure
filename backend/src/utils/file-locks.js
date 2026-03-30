/**
 * file-locks.js — In-memory file lock manager.
 *
 * Tracks exclusive file locks and lock requests.
 * Locks auto-expire after LOCK_TTL_MS (default 30 min) to prevent stale locks.
 */

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Map<lockKey, { userId, userEmail, userName, lockedAt, expiresAt }>
// lockKey = `${apiBasePath}::${filePath}`
const locks = new Map();

// Array of { id, lockKey, fromUserId, fromUserEmail, fromUserName, createdAt }
let requestIdCounter = 0;
const lockRequests = [];

function makeLockKey(apiBasePath, filePath) {
  return `${apiBasePath}::${filePath}`;
}

/** Prune expired locks. */
function pruneExpired() {
  const now = Date.now();
  for (const [key, lock] of locks) {
    if (now > lock.expiresAt) {
      locks.delete(key);
    }
  }
}

/**
 * Check if a file path or name contains "readonly" (case-insensitive).
 */
export function isReadonlyPath(filePath) {
  return /readonly/i.test(filePath);
}

/**
 * Acquire a lock on a file. Returns { ok, lock?, error? }.
 */
export function acquireLock(apiBasePath, filePath, userId, userEmail, userName) {
  pruneExpired();
  const key = makeLockKey(apiBasePath, filePath);
  const existing = locks.get(key);
  if (existing && existing.userId !== userId) {
    return {
      ok: false,
      error: 'locked',
      lock: { ...existing },
    };
  }
  const now = Date.now();
  const lock = {
    userId,
    userEmail: userEmail || '',
    userName: userName || '',
    lockedAt: new Date(now).toISOString(),
    expiresAt: now + LOCK_TTL_MS,
  };
  locks.set(key, lock);
  return { ok: true, lock };
}

/**
 * Release a lock. Only the owner (or force) can release.
 */
export function releaseLock(apiBasePath, filePath, userId, force = false) {
  const key = makeLockKey(apiBasePath, filePath);
  const existing = locks.get(key);
  if (!existing) return { ok: true };
  if (!force && existing.userId !== userId) {
    return { ok: false, error: 'not_owner' };
  }
  locks.delete(key);
  // Also remove any pending requests for this file
  for (let i = lockRequests.length - 1; i >= 0; i--) {
    if (lockRequests[i].lockKey === key) lockRequests.splice(i, 1);
  }
  return { ok: true };
}

/**
 * Refresh (extend) a lock TTL. Called periodically by the editing user.
 */
export function refreshLock(apiBasePath, filePath, userId) {
  const key = makeLockKey(apiBasePath, filePath);
  const existing = locks.get(key);
  if (!existing || existing.userId !== userId) return false;
  existing.expiresAt = Date.now() + LOCK_TTL_MS;
  return true;
}

/**
 * Get lock status for a single file.
 */
export function getLockStatus(apiBasePath, filePath) {
  pruneExpired();
  const key = makeLockKey(apiBasePath, filePath);
  const lock = locks.get(key);
  return lock ? { locked: true, ...lock } : { locked: false };
}

/**
 * Get all locks matching a given apiBasePath prefix.
 */
export function getLocksForBasePath(apiBasePath) {
  pruneExpired();
  const result = {};
  const prefix = `${apiBasePath}::`;
  for (const [key, lock] of locks) {
    if (key.startsWith(prefix)) {
      const filePath = key.slice(prefix.length);
      result[filePath] = { ...lock };
    }
  }
  return result;
}

/**
 * Create a lock request (from another user asking the holder to release).
 */
export function createLockRequest(apiBasePath, filePath, fromUserId, fromUserEmail, fromUserName) {
  pruneExpired();
  const key = makeLockKey(apiBasePath, filePath);
  const existing = locks.get(key);
  if (!existing) return { ok: false, error: 'not_locked' };
  if (existing.userId === fromUserId) return { ok: false, error: 'self_request' };

  // Don't duplicate
  const dupe = lockRequests.find(
    (r) => r.lockKey === key && r.fromUserId === fromUserId,
  );
  if (dupe) return { ok: true, request: dupe };

  const request = {
    id: ++requestIdCounter,
    lockKey: key,
    apiBasePath,
    filePath,
    targetUserId: existing.userId,
    fromUserId,
    fromUserEmail: fromUserEmail || '',
    fromUserName: fromUserName || '',
    createdAt: new Date().toISOString(),
  };
  lockRequests.push(request);
  return { ok: true, request };
}

/**
 * Get pending lock requests targeted at a specific user.
 */
export function getLockRequestsForUser(userId) {
  pruneExpired();
  // Also prune requests for locks that no longer exist
  for (let i = lockRequests.length - 1; i >= 0; i--) {
    if (!locks.has(lockRequests[i].lockKey)) {
      lockRequests.splice(i, 1);
    }
  }
  return lockRequests.filter((r) => r.targetUserId === userId);
}

/**
 * Dismiss (remove) a lock request by id.
 */
export function dismissLockRequest(requestId, userId) {
  const idx = lockRequests.findIndex((r) => r.id === requestId && r.targetUserId === userId);
  if (idx === -1) return false;
  lockRequests.splice(idx, 1);
  return true;
}
