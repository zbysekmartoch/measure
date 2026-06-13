import { Router } from 'express';
import { promises as fs, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { getSecurePath, listFiles, createUploadMiddleware, getDefaultDepth, copyRecursive } from '../utils/file-manager.js';
import { writeRuntimeEnvironmentFile } from '../utils/runtime-environment.js';
import { isReadonlyPath } from '../utils/file-locks.js';
import { getDebugStatus, endDebugSession } from '../debug/debug-engine.js';
import { startWorkflowRun, abortWorkflowRun } from '../workflow/workflow-runner.js';
import { getUserStore } from '../users/index.js';
import {
  createOfficeViewDocumentKey,
  ensureOfficeEditSession,
  ensureOfficeConfigured,
  getOfficeDocumentServerUrl,
  getOfficeDocumentType,
  getOfficeFileExtension,
  isOfficeFilePath,
  listOfficeSessionsForScope,
  resolveOfficeAppUrl,
  signOfficeAccessToken,
  signOfficeDocumentConfig,
  syncAllOfficeSessionsForLab,
  syncOfficeSessionForFile,
} from '../utils/office.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root folder for all labs. Each lab has its own subfolder with metadata and files.
const LABS_ROOT = path.resolve(__dirname, '../../labs');
// Backup destination folder.
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');
// Backup shell script.
const BACKUP_SCRIPT = path.resolve(__dirname, '../../scripts/backup-lab.sh');

const router = Router();

// Path to shared aliases registry (shortName → labId).
const ALIASES_FILE = path.join(LABS_ROOT, 'aliases.json');

// Ensure base labs folder exists (called before listing/creating).
async function ensureLabsRoot() {
  await fs.mkdir(LABS_ROOT, { recursive: true });
}

// ── Aliases (shortName) helpers ───────────────────────────────────────────────

/** Read aliases.json → { alias: labId, ... } */
async function readAliases() {
  try {
    const raw = await fs.readFile(ALIASES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Write aliases.json */
async function writeAliases(aliases) {
  await fs.writeFile(ALIASES_FILE, JSON.stringify(aliases, null, 2), 'utf-8');
}

/** Resolve a shortName alias to a lab id. Returns null if not found. */
export async function resolveAlias(alias) {
  const aliases = await readAliases();
  return aliases[alias] ?? null;
}

// Resolve lab folder path from lab id (id is a string like "1", "2", …).
function getLabPath(id) {
  return path.join(LABS_ROOT, String(id));
}

// Calculate total size of a directory recursively (in bytes).
async function getDirectorySize(dirPath) {
  let totalSize = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      const stat = await fs.stat(entryPath);
      totalSize += stat.size;
    }
  }
  return totalSize;
}

// Read lab metadata from lab.json.
async function readLabMetadata(labPath) {
  const data = await fs.readFile(path.join(labPath, 'lab.json'), 'utf-8');
  return JSON.parse(data);
}

// Persist lab metadata to lab.json.
async function writeLabMetadata(labPath, metadata) {
  await fs.writeFile(path.join(labPath, 'lab.json'), JSON.stringify(metadata, null, 2), 'utf-8');
}

function normalizeBackupIgnoredFolders(input) {
  if (!Array.isArray(input)) return [];

  const out = [];
  const seen = new Set();
  for (const item of input) {
    if (item === null || item === undefined) continue;

    const normalized = path.posix
      .normalize(String(item).trim().replace(/\\/g, '/'))
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');

    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

// Ownership and sharing checks (simple owner/shared list).
function isOwner(lab, userId) {
  return String(lab.ownerId) === String(userId);
}

function isShared(lab, userId) {
  return Array.isArray(lab.sharedWith) && lab.sharedWith.map(String).includes(String(userId));
}

// Shared users currently get the same access as owner (future: roles).
function hasAccess(lab, userId) {
  return isOwner(lab, userId) || isShared(lab, userId);
}

// Returns folder paths (relative to lab root, e.g. 'scripts/reports') shared with userId.
function getSharedFolderPaths(lab, userId) {
  const userIdStr = String(userId);
  return (lab.sharedFolders || [])
    .filter(sf => Array.isArray(sf.sharedWith) && sf.sharedWith.some(id => String(id) === userIdStr))
    .map(sf => sf.folderPath);
}

// relPath is relative to scripts root ('reports/file.txt'); sharedFolderPaths are 'scripts/reports'.
function isPathInSharedFolders(relPath, sharedFolderPaths) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return sharedFolderPaths.some(sp => {
    const folderRel = sp.replace(/^scripts\//, '').replace(/^\/+/, '');
    return normalized === folderRel || normalized.startsWith(folderRel + '/');
  });
}

// Returns { fullAccess, sharedFolderPaths } for a user on a lab's scripts.
// fullAccess=true means owner or lab-level shared user.
// fullAccess=false with non-empty sharedFolderPaths means folder-level only.
function getScriptAccess(lab, userId) {
  const fullAccess = hasAccess(lab, userId);
  const sharedFolderPaths = fullAccess ? [] : getSharedFolderPaths(lab, userId);
  return { fullAccess, sharedFolderPaths };
}

// ─── Script Stats Helpers ─────────────────────────────────────────────────────

const LOC_EXTENSIONS = { '.py': 'python', '.js': 'js', '.cjs': 'js', '.r': 'r' };

/** Walk a directory recursively and collect file stats. */
async function walkDir(dirPath) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...await walkDir(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Compute script statistics for a lab. */
async function computeScriptStats(labId) {
  const scriptsDir = path.join(getLabPath(labId), 'scripts');
  const files = await walkDir(scriptsDir);
  let lastModified = null;
  const loc = { python: 0, js: 0, r: 0 };

  await Promise.all(files.map(async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      if (!lastModified || stat.mtimeMs > lastModified) {
        lastModified = stat.mtimeMs;
      }
      const ext = path.extname(filePath).toLowerCase();
      const lang = LOC_EXTENSIONS[ext];
      if (lang) {
        const content = await fs.readFile(filePath, 'utf-8');
        loc[lang] += content.split('\n').filter(line => line.trim().length > 0).length;
      }
    } catch { /* skip unreadable files */ }
  }));

  return {
    fileCount: files.length,
    lastModified: lastModified ? new Date(lastModified).toISOString() : null,
    loc,
  };
}

// ─── Visit Logging Helpers ────────────────────────────────────────────────────

const MAX_VISITS = 100; // keep last N visits per lab

async function readVisits(labId) {
  const visitsPath = path.join(getLabPath(labId), 'visits.json');
  try {
    const raw = await fs.readFile(visitsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function recordVisit(labId, userInfo) {
  const visits = await readVisits(labId);
  visits.unshift({
    userId: userInfo.id,
    email: userInfo.email,
    firstName: userInfo.firstName,
    lastName: userInfo.lastName,
    at: new Date().toISOString(),
  });
  // Keep only the last MAX_VISITS entries
  if (visits.length > MAX_VISITS) visits.length = MAX_VISITS;
  const visitsPath = path.join(getLabPath(labId), 'visits.json');
  await fs.writeFile(visitsPath, JSON.stringify(visits, null, 2), 'utf-8');
}

// Load all labs from disk (invalid folders are ignored).
async function loadAllLabs() {
  await ensureLabsRoot();
  const entries = await fs.readdir(LABS_ROOT, { withFileTypes: true });
  const labs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const labPath = getLabPath(entry.name);
    try {
      const lab = await readLabMetadata(labPath);
      labs.push(lab);
    } catch {
      // ignore invalid labs
    }
  }
  return labs;
}

// Determine next sequential ID by scanning existing lab folders.
async function getNextId() {
  await ensureLabsRoot();
  const entries = await fs.readdir(LABS_ROOT, { withFileTypes: true });
  let max = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const n = parseInt(entry.name, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

// List labs owned by the current user (includes script stats).
router.get('/', async (req, res, next) => {
  try {
    const labs = await loadAllLabs();
    const owned = labs.filter(lab => isOwner(lab, req.userId));
    const items = await Promise.all(owned.map(async (lab) => {
      try {
        const stats = await computeScriptStats(lab.id);
        return { ...lab, stats };
      } catch {
        return { ...lab, stats: null };
      }
    }));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// List labs shared with the current user (includes script stats).
router.get('/shared', async (req, res, next) => {
  try {
    const labs = await loadAllLabs();
    const shared = labs.filter(lab => isShared(lab, req.userId));
    const items = await Promise.all(shared.map(async (lab) => {
      try {
        const stats = await computeScriptStats(lab.id);
        return { ...lab, stats };
      } catch {
        return { ...lab, stats: null };
      }
    }));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// Get all lab aliases (shortName → labId).
router.get('/aliases', async (_req, res, next) => {
  try {
    const aliases = await readAliases();
    res.json(aliases);
  } catch (e) {
    next(e);
  }
});

// List all folders that have been explicitly shared with the current user across all labs.
router.get('/shared-folders', async (req, res, next) => {
  try {
    const labs = await loadAllLabs();
    const items = [];
    for (const lab of labs) {
      const paths = getSharedFolderPaths(lab, req.userId);
      if (paths.length > 0) {
        items.push({ labId: lab.id, labName: lab.name, ownerId: lab.ownerId, folders: paths });
      }
    }
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// Create a new lab with scripts/results/state subfolders.
router.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body ?? {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const id = await getNextId();
    const labPath = getLabPath(id);

    await fs.mkdir(labPath, { recursive: true });
    await fs.mkdir(path.join(labPath, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(labPath, 'results'), { recursive: true });
    await fs.mkdir(path.join(labPath, 'state'), { recursive: true });

    const now = new Date().toISOString();
    const lab = {
      id,
      name: String(name).trim(),
      description: description ? String(description).trim() : '',
      ownerId: req.userId,
      sharedWith: [],
      backupIgnoredFolders: [],
      createdAt: now,
      updatedAt: now
    };

    await writeLabMetadata(labPath, lab);

    res.status(201).json(lab);
  } catch (e) {
    next(e);
  }
});

// Clone a lab — deep-copies scripts folder, creates new results/state folders.
// Accessible to owner and shared users.
router.post('/:id/clone', async (req, res, next) => {
  try {
    const srcLabPath = getLabPath(req.params.id);
    const srcLab = await readLabMetadata(srcLabPath);
    if (!hasAccess(srcLab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const newId = await getNextId();
    const newLabPath = getLabPath(newId);

    // Create new lab folder structure
    await fs.mkdir(newLabPath, { recursive: true });
    await fs.mkdir(path.join(newLabPath, 'results'), { recursive: true });
    await fs.mkdir(path.join(newLabPath, 'state'), { recursive: true });

    // Deep-copy scripts folder
    const srcScripts = path.join(srcLabPath, 'scripts');
    const dstScripts = path.join(newLabPath, 'scripts');
    try {
      await fs.cp(srcScripts, dstScripts, { recursive: true });
    } catch {
      // If scripts folder doesn't exist in source, just create an empty one
      await fs.mkdir(dstScripts, { recursive: true });
    }

    const now = new Date().toISOString();
    const { name: customName } = req.body ?? {};
    const newLab = {
      id: newId,
      name: customName ? String(customName).trim() : `${srcLab.name} (clone)`,
      description: srcLab.description || '',
      ownerId: req.userId,
      sharedWith: [],
      backupIgnoredFolders: normalizeBackupIgnoredFolders(srcLab.backupIgnoredFolders || []),
      createdAt: now,
      updatedAt: now,
    };

    await writeLabMetadata(newLabPath, newLab);
    res.status(201).json(newLab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Source lab not found' });
    next(e);
  }
});

// Fetch lab metadata (owner/shared access). Also records a visit.
router.get('/:id', async (req, res, next) => {
  try {
    const userStore = getUserStore();
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Ensure current_output directory exists
    await fs.mkdir(getLabCurrentOutputRoot(req.params.id), { recursive: true });
    // Record visit (best-effort, non-blocking)
    try {
      const user = await userStore.findById(req.userId);
      if (user) {
        await recordVisit(req.params.id, { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName });
      }
    } catch { /* visit logging is best-effort */ }
    res.json(lab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Get visit log for a lab (owner only).
router.get('/:id/visits', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const visits = await readVisits(req.params.id);
    res.json({ items: visits });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Get script stats for a single lab.
router.get('/:id/stats', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const stats = await computeScriptStats(req.params.id);
    res.json(stats);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Get lab folder size (owner or shared).
router.get('/:id/size', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const sizeBytes = await getDirectorySize(labPath);
    res.json({ sizeBytes });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Update lab name/description (owner only).
router.patch('/:id', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, description } = req.body ?? {};
    if (name !== undefined) lab.name = String(name).trim();
    if (description !== undefined) lab.description = String(description).trim();

    // Optional backup frequency: 'manual', 'daily', 'weekly', 'monthly', or null/undefined
    const { backupFrequency } = req.body ?? {};
    if (backupFrequency !== undefined) {
      const allowed = [null, 'manual', 'hourly', 'daily', 'weekly', 'monthly'];
      lab.backupFrequency = allowed.includes(backupFrequency) ? backupFrequency : null;
    }

    const { backupIgnoredFolders } = req.body ?? {};
    if (backupIgnoredFolders !== undefined) {
      lab.backupIgnoredFolders = normalizeBackupIgnoredFolders(backupIgnoredFolders);
    }

    // Optional shortName (alias) — must be unique across all labs
    const { shortName } = req.body ?? {};
    if (shortName !== undefined) {
      const trimmed = shortName ? String(shortName).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') : '';
      if (trimmed) {
        // Validate uniqueness
        const aliases = await readAliases();
        const existingLabId = aliases[trimmed];
        if (existingLabId && String(existingLabId) !== String(lab.id)) {
          return res.status(409).json({
            error: `Alias "${trimmed}" is already used by lab #${existingLabId}`,
            conflictLabId: existingLabId,
          });
        }
        // Remove old alias if lab had a different one
        if (lab.shortName && lab.shortName !== trimmed) {
          delete aliases[lab.shortName];
        }
        aliases[trimmed] = lab.id;
        await writeAliases(aliases);
        lab.shortName = trimmed;
      } else {
        // Remove alias
        const aliases = await readAliases();
        if (lab.shortName && aliases[lab.shortName] === lab.id) {
          delete aliases[lab.shortName];
          await writeAliases(aliases);
        }
        lab.shortName = undefined;
      }
    }

    lab.updatedAt = new Date().toISOString();

    await writeLabMetadata(labPath, lab);
    res.json(lab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Delete a lab folder recursively (owner only).
router.delete('/:id', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Remove alias from aliases.json if lab had one
    if (lab.shortName) {
      const aliases = await readAliases();
      if (aliases[lab.shortName] === lab.id) {
        delete aliases[lab.shortName];
        await writeAliases(aliases);
      }
    }
    await fs.rm(labPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Trigger a deduplicated backup of a lab (owner only).
// Creates a ZIP of the entire lab folder and stores it in backend/backups/
// unless an identical backup already exists.
router.post('/:id/backup', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ignoredFolders = normalizeBackupIgnoredFolders(lab.backupIgnoredFolders);

    // Run the backup shell script
    await new Promise((resolve, reject) => {
      execFile(BACKUP_SCRIPT, [labPath, BACKUPS_DIR, ...ignoredFolders], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    }).then((output) => {
      const skipped = output.startsWith('SKIPPED');
      res.json({ success: true, skipped, message: output });
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Share a lab with another user id (owner only).
router.post('/:id/share', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userId } = req.body ?? {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const shared = new Set((lab.sharedWith || []).map(String));
    shared.add(String(userId));
    lab.sharedWith = Array.from(shared);
    lab.updatedAt = new Date().toISOString();

    await writeLabMetadata(labPath, lab);
    res.json(lab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Remove a shared user (owner only).
router.delete('/:id/share/:userId', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetId = String(req.params.userId);
    lab.sharedWith = (lab.sharedWith || []).map(String).filter(id => id !== targetId);
    lab.updatedAt = new Date().toISOString();

    await writeLabMetadata(labPath, lab);
    res.json(lab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Share a specific folder with a set of users (owner only).
// Body: { folderPath: 'scripts/reports', userIds: ['1', '2'] }
// An empty userIds array removes the sharing entry for that folder.
router.post('/:id/folder-share', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!isOwner(lab, req.userId)) return res.status(403).json({ error: 'Access denied' });

    const { folderPath, userIds } = req.body ?? {};
    if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds must be an array' });

    const normalized = folderPath.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized.split('/').some(p => p === '..')) {
      return res.status(400).json({ error: 'Invalid folderPath' });
    }

    if (!Array.isArray(lab.sharedFolders)) lab.sharedFolders = [];

    const existingIdx = lab.sharedFolders.findIndex(sf => sf.folderPath === normalized);
    if (userIds.length === 0) {
      if (existingIdx >= 0) lab.sharedFolders.splice(existingIdx, 1);
    } else if (existingIdx >= 0) {
      lab.sharedFolders[existingIdx].sharedWith = userIds.map(String);
    } else {
      lab.sharedFolders.push({ folderPath: normalized, sharedWith: userIds.map(String) });
    }

    lab.updatedAt = new Date().toISOString();
    await writeLabMetadata(labPath, lab);
    res.json(lab);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Load per-user UI state for a lab.
router.get('/:id/state', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const statePath = path.join(labPath, 'state', `${req.userId}.json`);
    try {
      const data = await fs.readFile(statePath, 'utf-8');
      res.json(JSON.parse(data));
    } catch (e) {
      if (e.code === 'ENOENT') return res.json({});
      throw e;
    }
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Save per-user UI state for a lab.
router.put('/:id/state', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.mkdir(path.join(labPath, 'state'), { recursive: true });
    const statePath = path.join(labPath, 'state', `${req.userId}.json`);
    await fs.writeFile(statePath, JSON.stringify(req.body ?? {}, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// ─── Lab Debug State (debug.json) ─────────────────────────────────────────────

// GET /api/v1/labs/:id/debug-state — read debug.json (breakpoints, settings)
router.get('/:id/debug-state', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) return res.status(403).json({ error: 'Access denied' });

    const debugPath = path.join(labPath, 'debug.json');
    try {
      const raw = await fs.readFile(debugPath, 'utf-8');
      res.json(JSON.parse(raw));
    } catch (e) {
      if (e.code === 'ENOENT') return res.json({ breakpoints: {} });
      throw e;
    }
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// PUT /api/v1/labs/:id/debug-state — write debug.json
router.put('/:id/debug-state', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) return res.status(403).json({ error: 'Access denied' });

    const debugPath = path.join(labPath, 'debug.json');
    await fs.writeFile(debugPath, JSON.stringify(req.body ?? {}, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
});

// Helper for lab scripts root.
function getLabScriptsRoot(labId) {
  return path.join(getLabPath(labId), 'scripts');
}

// Helper for lab results root.
function getLabResultsRoot(labId) {
  return path.join(getLabPath(labId), 'results');
}

// Helper for lab current_output root (Outputs folder inside scripts).
function getLabCurrentOutputRoot(labId) {
  return path.join(getLabPath(labId), 'scripts', 'Outputs');
}

async function syncOfficeBeforeRun(labId, res) {
  const officeSync = await syncAllOfficeSessionsForLab(labId, { waitForSave: true });
  const hardFails = (officeSync.details || []).filter(
    (d) => !d.ok && !d.skipped && d.errorCode != null && ![1, 4].includes(d.errorCode),
  );
  if (hardFails.length > 0) {
    res.status(409).json({
      error: 'Cannot start workflow: failed to sync active Office documents',
      officeSync,
    });
    return null;
  }
  return officeSync;
}

function getOfficeUserDisplayName(user) {
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(user?.email || '').trim() || 'Measure User';
}

async function buildOfficeEditorConfig({
  req,
  userId,
  area,
  labId,
  resultId,
  rootPath,
  filePath,
  requestedMode = 'edit',
}) {
  ensureOfficeConfigured();

  const cleanFilePath = String(filePath || '').trim();
  if (!cleanFilePath) {
    const err = new Error('Missing file parameter');
    err.statusCode = 400;
    throw err;
  }

  if (!isOfficeFilePath(cleanFilePath)) {
    const err = new Error(`Unsupported office file type: ${getOfficeFileExtension(cleanFilePath) || 'unknown'}`);
    err.statusCode = 400;
    throw err;
  }

  const absolutePath = getSecurePath(rootPath, cleanFilePath);
  if (!absolutePath) {
    const err = new Error('Invalid file path');
    err.statusCode = 400;
    throw err;
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    const err = new Error('Path is not a file');
    err.statusCode = 400;
    throw err;
  }

  const extension = getOfficeFileExtension(cleanFilePath);
  const documentType = getOfficeDocumentType(extension);
  if (!documentType) {
    const err = new Error(`Unsupported office document type: ${extension || 'unknown'}`);
    err.statusCode = 400;
    throw err;
  }

  const mode = requestedMode === 'view' || isReadonlyPath(cleanFilePath) ? 'view' : 'edit';

  let user = null;
  try {
    user = await getUserStore().findById(userId);
  } catch {
    user = null;
  }

  const appUrl = resolveOfficeAppUrl(req);
  let documentKey = createOfficeViewDocumentKey({ area, labId, resultId, filePath: cleanFilePath });

  if (mode === 'edit') {
    const editSession = ensureOfficeEditSession({
      area,
      labId,
      resultId,
      filePath: cleanFilePath,
      user: {
        id: String(userId),
        name: getOfficeUserDisplayName(user),
        email: String(user?.email || '').trim(),
      },
    });
    documentKey = editSession.key;
  }

  const fileToken = signOfficeAccessToken({
    action: 'file',
    area,
    labId: String(labId),
    resultId: resultId ? String(resultId) : '',
    filePath: cleanFilePath,
    mode,
  });

  const callbackToken = signOfficeAccessToken({
    action: 'callback',
    area,
    labId: String(labId),
    resultId: resultId ? String(resultId) : '',
    filePath: cleanFilePath,
    mode,
  });

  const documentUrl = `${appUrl}/api/office/file?token=${encodeURIComponent(fileToken)}`;
  const callbackUrl = `${appUrl}/api/office/callback?token=${encodeURIComponent(callbackToken)}`;

  const configPayload = {
    document: {
      fileType: extension,
      key: documentKey,
      title: path.basename(cleanFilePath),
      url: documentUrl,
      permissions: {
        edit: mode === 'edit',
        comment: mode === 'edit',
        review: mode === 'edit',
        copy: true,
        print: true,
        fillForms: mode === 'edit',
      },
    },
    documentType,
    editorConfig: {
      lang: 'en',
      mode,
      user: {
        id: `measure-${userId}`,
        name: getOfficeUserDisplayName(user),
      },
      ...(mode === 'edit' && {
        callbackUrl,
        coEditing: {
          mode: 'fast',
          change: true,
        },
        customization: {
          forceSave: true,
        },
      }),
    },
    height: '100%',
    width: '100%',
  };

  return {
    config: signOfficeDocumentConfig(configPayload),
    docServerUrl: getOfficeDocumentServerUrl(),
  };
}

function isZipArchive(filePath) {
  return /\.zip$/i.test(filePath || '');
}

function isGzipArchive(filePath) {
  return /\.(gz|gzip|tgz)$/i.test(filePath || '');
}

function isSupportedArchive(filePath) {
  return isZipArchive(filePath) || isGzipArchive(filePath);
}

function normalizeArchiveEntryPath(entryPath) {
  const normalized = path.posix
    .normalize(String(entryPath || '').replace(/\\/g, '/'))
    .replace(/^\/+/, '');

  if (!normalized || normalized === '.') {
    return { type: 'skip' };
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    return { type: 'unsafe' };
  }
  return { type: 'file', relativePath: normalized };
}

function getGzipOutputRelativePath(relativeArchivePath) {
  const dir = path.dirname(relativeArchivePath);
  const fileName = path.basename(relativeArchivePath);
  let outputName = fileName;

  if (/\.tgz$/i.test(fileName)) {
    outputName = fileName.replace(/\.tgz$/i, '.tar');
  } else if (/\.gzip$/i.test(fileName)) {
    outputName = fileName.replace(/\.gzip$/i, '');
  } else if (/\.gz$/i.test(fileName)) {
    outputName = fileName.replace(/\.gz$/i, '');
  }

  if (!outputName || outputName === fileName) {
    const err = new Error('Unsupported gzip archive name');
    err.statusCode = 400;
    throw err;
  }

  return dir === '.' ? outputName : path.join(dir, outputName);
}

async function unpackZipArchive({ rootPath, relativeArchivePath, archivePath }) {
  const archiveDir = path.dirname(relativeArchivePath);
  const extracted = [];
  const skippedUnsafe = [];
  const openedArchive = await unzipper.Open.file(archivePath);

  for (const entry of openedArchive.files) {
    if (entry.type === 'Directory') continue;

    const entryPathState = normalizeArchiveEntryPath(entry.path);
    if (entryPathState.type === 'skip') continue;
    if (entryPathState.type === 'unsafe') {
      skippedUnsafe.push(entry.path);
      continue;
    }

    const relativeOutputPath = archiveDir === '.'
      ? entryPathState.relativePath
      : path.join(archiveDir, entryPathState.relativePath);
    const absoluteOutputPath = getSecurePath(rootPath, relativeOutputPath);

    if (!absoluteOutputPath) {
      skippedUnsafe.push(entry.path);
      continue;
    }

    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(absoluteOutputPath));
    extracted.push(relativeOutputPath);
  }

  return { extracted, skippedUnsafe };
}

async function unpackGzipArchive({ rootPath, relativeArchivePath, archivePath }) {
  const outputRelativePath = getGzipOutputRelativePath(relativeArchivePath);
  const outputPath = getSecurePath(rootPath, outputRelativePath);
  if (!outputPath) {
    const err = new Error('Invalid output path for extracted gzip file');
    err.statusCode = 400;
    throw err;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(outputPath));

  return { extracted: [outputRelativePath], skippedUnsafe: [] };
}

async function unpackArchiveAtRoot({ rootPath, relativeArchivePath }) {
  if (!isSupportedArchive(relativeArchivePath)) {
    const err = new Error('Unsupported archive type. Only ZIP and GZIP are supported.');
    err.statusCode = 400;
    throw err;
  }

  const archivePath = getSecurePath(rootPath, relativeArchivePath);
  if (!archivePath) {
    const err = new Error('Invalid archive path');
    err.statusCode = 400;
    throw err;
  }

  const stat = await fs.stat(archivePath);
  if (!stat.isFile()) {
    const err = new Error('Path is not a file');
    err.statusCode = 400;
    throw err;
  }

  if (isZipArchive(relativeArchivePath)) {
    return unpackZipArchive({ rootPath, relativeArchivePath, archivePath });
  }

  return unpackGzipArchive({ rootPath, relativeArchivePath, archivePath });
}

async function readJsonFile(jsonPath, { allowMissing = false } = {}) {
  try {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (allowMissing && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJsonFile(jsonPath, data) {
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function buildRunMetadata({
  userId,
  workflowFile,
  isWorkflow,
  workflowSteps,
  scriptsRoot,
  mode,
}) {
  let userName = '';
  try {
    const userStore = getUserStore();
    const user = await userStore.findById(userId);
    if (user) {
      userName = `${user.firstName} ${user.lastName}`;
    }
  } catch { /* ignore */ }

  const workflowRoot = path.dirname(workflowFile);
  const relativeScriptsRoot = path.relative(LABS_ROOT, scriptsRoot);
  const wfBaseName = path.basename(workflowFile, path.extname(workflowFile));
  const now = new Date().toISOString();

  return {
    now,
    run: {
      workflowFile: isWorkflow ? workflowFile : null, // null for single-script runs
      workflow: workflowSteps,
      name: wfBaseName,
      author: userName,
      private: true,
      mode, // "debug" | "production"
      _: 'Do not manualy overwrite keys starting with _',
      _usr_id: userId,
      _workflowRoot: workflowRoot === '.' ? '' : workflowRoot,
      _scriptsRoot: relativeScriptsRoot,
      _created: now,
    },
  };
}

// ─── Lab Results ──────────────────────────────────────────────────────────────

// List result subfolders inside a lab (each subfolder = one result run).
// Returns: { items: [{ id, name, createdAt, status, … }] }
router.get('/:id/results', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultsRoot = getLabResultsRoot(req.params.id);
    let entries;
    try {
      entries = await fs.readdir(resultsRoot, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return res.json({ items: [] });
      throw e;
    }

    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(resultsRoot, entry.name);
      const stat = await fs.stat(dirPath);

      // Try to read progress.json for richer metadata
      let progress = null;
      try {
        const raw = await fs.readFile(path.join(dirPath, '_progress.json'), 'utf-8');
        progress = JSON.parse(raw);
      } catch { /* no progress.json — that's fine */ }

      // Try to read runtime.env for run metadata (legacy fallback: environment.json)
      let run = null;
      try {
        const envJson = await readJsonFile(path.join(dirPath, 'runtime.env'));
        if (envJson?.run) run = envJson.run;
      } catch {
        try {
          const legacyEnvJson = await readJsonFile(path.join(dirPath, 'environment.json'));
          if (legacyEnvJson?.run) run = legacyEnvJson.run;
        } catch { /* no runtime/env metadata — that's fine */ }
      }

      items.push({
        id: entry.name,
        name: entry.name,
        createdAt: stat.birthtime?.toISOString() || stat.mtime?.toISOString(),
        modifiedAt: stat.mtime?.toISOString(),
        status: progress?.status || 'unknown',
        completedAt: progress?.completedAt || null,
        analysisStartedAt: progress?.analysisStartedAt || null,
        totalSteps: progress?.totalSteps || null,
        currentStep: progress?.currentStep || null,
        currentStepName: progress?.currentStepName || null,
        run,
      });
    }

    // Sort newest first
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ items, currentUserId: req.userId });
  } catch (e) {
    next(e);
  }
});

// List files inside a specific lab result subfolder (file-manager compatible).
router.get('/:id/results/:resultId/files', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const securePath = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!securePath) return res.status(400).json({ error: 'Invalid result id' });

    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const files = await listFiles(root, '', getDefaultDepth());
    res.json({ root: '', items: files, count: files.length });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Result not found' });
    next(e);
  }
});

// Build Euro/OnlyOffice editor configuration for a result file (DOCX/XLSX).
router.get('/:id/results/:resultId/files/office/editor-config', async (req, res, next) => {
  try {
    const { file, mode = 'edit' } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultsRoot = getLabResultsRoot(req.params.id);
    const resultRoot = path.join(resultsRoot, req.params.resultId);
    const secureResult = getSecurePath(resultsRoot, req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const payload = await buildOfficeEditorConfig({
      req,
      userId: req.userId,
      area: 'results',
      labId: req.params.id,
      resultId: req.params.resultId,
      rootPath: resultRoot,
      filePath: String(file),
      requestedMode: String(mode || 'edit'),
    });

    res.json(payload);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Active Office edit sessions for result files.
router.get('/:id/results/:resultId/files/office/active', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sessions = listOfficeSessionsForScope({
      area: 'results',
      labId: req.params.id,
      resultId: req.params.resultId,
    });

    res.json({ sessions });
  } catch (e) {
    next(e);
  }
});

// Manual force-save + wait for a specific result Office file.
router.post('/:id/results/:resultId/files/office/sync', async (req, res, next) => {
  try {
    const file = String(req.query.file || req.body?.file || '').trim();
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const syncResult = await syncOfficeSessionForFile({
      area: 'results',
      labId: req.params.id,
      resultId: req.params.resultId,
      filePath: file,
      waitForSave: true,
    });

    if (!syncResult.ok) {
      return res.status(409).json({ error: syncResult.error || 'Office sync failed', details: syncResult });
    }

    res.json(syncResult);
  } catch (e) {
    next(e);
  }
});

// Delete a result folder (entire subfolder).
router.delete('/:id/results/:resultId', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultsRoot = getLabResultsRoot(req.params.id);
    const securePath = getSecurePath(resultsRoot, req.params.resultId);
    if (!securePath) return res.status(400).json({ error: 'Invalid result id' });

    const resultDir = path.join(resultsRoot, req.params.resultId);
    const stat = await fs.stat(resultDir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    // Abort any running workflow for this result
    abortWorkflowRun(req.params.id, req.params.resultId);

    await fs.rm(resultDir, { recursive: true, force: true });
    res.json({ ok: true, message: `Result ${req.params.resultId} removed` });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Result not found' });
    next(e);
  }
});

// Read a file from a lab result subfolder.
router.get('/:id/results/:resultId/files/content', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const filePath = getSecurePath(resultRoot, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ file, content, size: stat.size, mtime: stat.mtime.toISOString() });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Update a file in a lab result subfolder.
router.put('/:id/results/:resultId/files/content', async (req, res, next) => {
  try {
    const { file, content } = req.body ?? {};
    if (!file || content === undefined) return res.status(400).json({ error: 'Missing file or content' });

    // Reject writes to readonly files
    if (isReadonlyPath(file)) {
      return res.status(403).json({ error: 'readonly', message: 'File is read-only' });
    }

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const filePath = getSecurePath(resultRoot, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    const stat = await fs.stat(filePath);
    res.json({ success: true, file, size: stat.size, mtime: stat.mtime.toISOString() });
  } catch (e) {
    next(e);
  }
});

// Download a file from a lab result subfolder.
router.get('/:id/results/:resultId/files/download', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const filePath = getSecurePath(resultRoot, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    // inline=1 → serve for in-browser display (PDF, images)
    if (req.query.inline === '1') {
      return res.sendFile(filePath);
    }
    res.download(filePath, path.basename(filePath));
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Unpack ZIP/GZIP archive directly inside the selected result folder.
router.post('/:id/results/:resultId/files/unpack', async (req, res, next) => {
  try {
    const { file } = req.body ?? {};
    if (!file?.trim()) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const { extracted, skippedUnsafe } = await unpackArchiveAtRoot({
      rootPath: resultRoot,
      relativeArchivePath: file.trim(),
    });

    if (extracted.length === 0) {
      return res.status(400).json({
        error: 'Archive did not contain any unpackable files',
        skippedUnsafe,
      });
    }

    res.json({
      success: true,
      file: file.trim(),
      extractedCount: extracted.length,
      extracted,
      skippedUnsafeCount: skippedUnsafe.length,
      skippedUnsafe,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Archive file not found' });
    if (e.code === 'Z_DATA_ERROR' || /invalid|central directory|signature/i.test(String(e.message || ''))) {
      return res.status(400).json({ error: 'Invalid archive file' });
    }
    next(e);
  }
});

// Delete a file from a lab result subfolder.
router.delete('/:id/results/:resultId/files', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const filePath = getSecurePath(resultRoot, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    await fs.unlink(filePath);
    res.json({ success: true, message: 'File deleted' });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Upload a file to a lab result subfolder.
router.post('/:id/results/:resultId/files/upload', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    await fs.mkdir(resultRoot, { recursive: true });
    const upload = createUploadMiddleware(resultRoot, 50 * 1024 * 1024);
    upload.single('file')(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.json({ success: true, file: req.file.filename, size: req.file.size });
    });
  } catch (e) {
    next(e);
  }
});

// Rename a file or folder inside result files.
router.post('/:id/results/:resultId/files/rename', async (req, res, next) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath?.trim() || !newPath?.trim()) {
      return res.status(400).json({ error: 'Both oldPath and newPath are required' });
    }

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultRoot = path.join(getLabResultsRoot(req.params.id), req.params.resultId);
    const secureResult = getSecurePath(getLabResultsRoot(req.params.id), req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const srcPath = getSecurePath(resultRoot, oldPath.trim());
    const dstPath = getSecurePath(resultRoot, newPath.trim());
    if (!srcPath || !dstPath) return res.status(400).json({ error: 'Invalid path' });

    try { await fs.stat(srcPath); } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'Source not found' });
      throw e;
    }
    await fs.mkdir(path.dirname(dstPath), { recursive: true });
    try { await fs.stat(dstPath); return res.status(409).json({ error: 'Destination already exists' }); }
    catch { /* good */ }

    await fs.rename(srcPath, dstPath);
    res.json({ success: true, oldPath: oldPath.trim(), newPath: newPath.trim() });
  } catch (e) {
    next(e);
  }
});

// ─── Abort / Reset a running result ────────────────────────────────────────────

/**
 * POST /api/v1/labs/:id/results/:resultId/abort
 *
 * Resets a running/pending result to "aborted" status.
 * Kills any active debug session / workflow run and updates progress.json.
 */
router.post('/:id/results/:resultId/abort', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const resultId = req.params.resultId;
    const labId = req.params.id;
    const resultDir = getSecurePath(path.join(labPath, 'results'), resultId);
    if (!resultDir) return res.status(400).json({ error: 'Invalid result id' });

    // Abort workflow run if active (this also kills debug session)
    const aborted = abortWorkflowRun(labId, resultId);

    if (!aborted) {
      // Fallback: try to kill standalone debug session
      try {
        const debugStatus = getDebugStatus();
        if (debugStatus.active && String(debugStatus.resultId) === String(resultId)) {
          endDebugSession();
        }
      } catch { /* ignore */ }
    }

    // Update progress.json
    const progressPath = path.join(resultDir, '_progress.json');
    let progress = {};
    try {
      progress = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
    } catch { /* no progress yet */ }

    progress.status = 'aborted';
    progress.completedAt = new Date().toISOString();
    progress.updatedAt = new Date().toISOString();
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2), 'utf-8');

    res.json({ ok: true, status: 'aborted' });
  } catch (e) {
    next(e);
  }
});

// ─── Lab Result Workflow Execution ─────────────────────────────────────────────

/**
 * POST /api/v1/labs/:id/results/:resultId/debug
 * Body: { debugVisible?: boolean, stopOnFailure?: boolean }
 *
 * Reads the workflow from result's runtime.env (key "run.workflow": string or string[]).
 *   - string → path to a .workflow file (relative to lab scripts), read its lines as steps
 *   - string[] → direct list of script paths (relative to lab scripts)
 *
 * Reads debug.json from the lab folder for breakpoint info.
 * Python scripts with debugVisible=true are spawned via debugpy --wait-for-client.
 *
 * Execution is delegated to WorkflowRunner which emits real-time SSE events.
 * Each script receives arguments: RESULT_ROOT, RUNTIME_ENV_PATH, LAB_ROOT.
 * stdout → output.log, stderr → output.err, debug comms → debuger.log (all in result dir).
 */
router.post('/:id/results/:resultId/debug', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const labId = req.params.id;
    const resultId = req.params.resultId;
    const resultsRoot = getLabResultsRoot(labId);
    const resultDir = path.join(resultsRoot, resultId);
    const secureResult = getSecurePath(resultsRoot, resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    // Force-save open Office docs before the workflow reads them from disk.
    const officeSync = await syncOfficeBeforeRun(labId, res);
    if (officeSync === null) return;

    const debugVisible = req.body?.debugVisible === true;
    const stopOnFailure = req.body?.stopOnFailure !== false; // default true

    const runtimeEnvPath = path.join(resultDir, 'runtime.env');

    // Read runtime.env from result to get run workflow.
    // Legacy fallback: if runtime.env is missing, migrate from environment.json once.
    let dataJson = null;
    try {
      dataJson = await readJsonFile(runtimeEnvPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return res.status(400).json({ error: 'Cannot read runtime.env in result folder' });
      }

      // Legacy migration path for old results that still only have environment.json.
      let legacyDataJson = null;
      try {
        legacyDataJson = await readJsonFile(path.join(resultDir, 'environment.json'));
      } catch {
        return res.status(400).json({ error: 'Cannot read runtime.env in result folder' });
      }

      const legacyScriptsRoot = legacyDataJson?.run?._scriptsRoot
        ? path.resolve(LABS_ROOT, legacyDataJson.run._scriptsRoot)
        : getLabScriptsRoot(labId);

      const sourceRelPath = legacyDataJson?.run?.workflowFile
        || (Array.isArray(legacyDataJson?.run?.workflow) && legacyDataJson.run.workflow.length === 1
          ? legacyDataJson.run.workflow[0]
          : null);

      if (!sourceRelPath) {
        return res.status(400).json({ error: 'Cannot build runtime.env for legacy result: missing run metadata' });
      }

      const sourceAbsPath = getSecurePath(legacyScriptsRoot, sourceRelPath);
      if (!sourceAbsPath) {
        return res.status(400).json({ error: 'Cannot build runtime.env for legacy result: invalid source path' });
      }

      try {
        await writeRuntimeEnvironmentFile({
          sourceFilePath: sourceAbsPath,
          labsRoot: LABS_ROOT,
          outputFilePath: runtimeEnvPath,
        });
      } catch (buildErr) {
        return res.status(400).json({ error: `Cannot build runtime.env for legacy result: ${buildErr.message}` });
      }

      try {
        dataJson = await readJsonFile(runtimeEnvPath);
      } catch {
        return res.status(400).json({ error: 'Cannot read runtime.env in result folder' });
      }

      // Preserve legacy run metadata if runtime merge does not include it.
      if ((!dataJson || !dataJson.run) && legacyDataJson?.run) {
        const mergedLegacy = (dataJson && typeof dataJson === 'object' && !Array.isArray(dataJson)) ? dataJson : {};
        mergedLegacy.run = legacyDataJson.run;
        dataJson = mergedLegacy;
        await writeJsonFile(runtimeEnvPath, dataJson);
      }
    }

    if (!dataJson || typeof dataJson !== 'object' || Array.isArray(dataJson)) {
      return res.status(400).json({ error: 'Invalid runtime.env: expected JSON object' });
    }

    const workflow = dataJson.run?.workflow;
    if (!workflow) {
      return res.status(400).json({ error: 'No run.workflow found in runtime.env' });
    }

    // Resolve workflowRoot from run metadata (directory of .workflow file relative to scripts)
    const workflowRoot = dataJson.run?._workflowRoot || '';

    // Resolve scriptsRoot: if run._scriptsRoot is relative, resolve against LABS_ROOT
    const scriptsRoot = dataJson.run?._scriptsRoot
      ? path.resolve(LABS_ROOT, dataJson.run._scriptsRoot)
      : getLabScriptsRoot(labId);

    let activeSteps;
    let commentedSteps = []; // steps starting with # (skipped)

    if (typeof workflow === 'string') {
      const wfPath = getSecurePath(scriptsRoot, workflow);
      if (!wfPath) return res.status(400).json({ error: 'Invalid workflow file path' });

      let wfContent;
      try {
        wfContent = await fs.readFile(wfPath, 'utf-8');
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: `Workflow file not found: ${workflow}` });
        throw e;
      }

      const allLines = wfContent.split('\n').map(s => s.trim()).filter(s => s);
      activeSteps = allLines.filter(s => !s.startsWith('#'));
      commentedSteps = allLines.filter(s => s.startsWith('#')).map(s => s.replace(/^#+\s*/, ''));
    } else if (Array.isArray(workflow)) {
      const allItems = workflow.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
      activeSteps = allItems.filter(s => !s.startsWith('#'));
      commentedSteps = allItems.filter(s => s.startsWith('#')).map(s => s.replace(/^#+\s*/, ''));
    } else {
      return res.status(400).json({ error: '"run.workflow" must be a string (path to .workflow file) or an array of script paths' });
    }

    if (activeSteps.length === 0) {
      return res.status(400).json({ error: 'run.workflow has no active steps' });
    }

    // Resolve <ALIAS>/path references to absolute script paths from other labs
    const aliases = await readAliases();
    const resolvedPaths = {}; // stepName → absolute path (only for cross-lab steps)
    for (let i = 0; i < activeSteps.length; i++) {
      const step = activeSteps[i];
      const aliasMatch = step.match(/^<([A-Z0-9_-]+)>\/(.+)$/);
      if (aliasMatch) {
        const [, alias, relPath] = aliasMatch;
        const targetLabId = aliases[alias];
        if (!targetLabId) {
          return res.status(400).json({ error: `Unknown alias <${alias}> in step "${step}"` });
        }
        const targetScriptsRoot = getLabScriptsRoot(targetLabId);
        const absPath = getSecurePath(targetScriptsRoot, relPath);
        if (!absPath) {
          return res.status(400).json({ error: `Invalid path in aliased step "${step}"` });
        }
        resolvedPaths[step] = absPath;
      }
    }

    // Read debug.json from lab for breakpoint info
    let debugState = { breakpoints: {} };
    try {
      const raw = await fs.readFile(path.join(labPath, 'debug.json'), 'utf-8');
      debugState = JSON.parse(raw);
    } catch { /* no debug.json — no breakpoints */ }

    // Determine which scripts have breakpoints
    const scriptsWithBreakpoints = new Set();
    if (debugVisible && debugState.breakpoints) {
      for (const [filePath, lines] of Object.entries(debugState.breakpoints)) {
        if (Array.isArray(lines) && lines.length > 0) {
          scriptsWithBreakpoints.add(filePath);
        }
      }
    }

    // Read progress.json for metadata
    let progress;
    try {
      const raw = await fs.readFile(path.join(resultDir, '_progress.json'), 'utf-8');
      progress = JSON.parse(raw);
    } catch {
      progress = {};
    }

    // Determine python command from config
    let pythonCmd = 'python';
    try {
      const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');
      const configData = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      const pyConfig = configData.scriptCommands?.['.py'];
      if (pyConfig?.command) {
        const cmd = pyConfig.command;
        if (cmd.startsWith('./') || cmd.startsWith('/')) {
          pythonCmd = path.isAbsolute(cmd) ? cmd : path.resolve(path.dirname(configPath), cmd);
        } else {
          pythonCmd = cmd;
        }
      }
    } catch { /* use default */ }

    // Start workflow via the workflow runner (runs in background)
    startWorkflowRun({
      labId,
      resultId,
      steps: activeSteps,
      commentedSteps,
      resultDir,
      scriptsRoot,
      workflowRoot,
      runtimeEnvPath,
      pythonCmd,
      debugVisible,
      debugScripts: scriptsWithBreakpoints,
      stopOnFailure,
      resolvedPaths,
      logFile: path.join(resultDir, 'output.log'),
      errorFile: path.join(resultDir, 'output.err'),
      debugLogFile: path.join(resultDir, 'debuger.log'),
      progressBase: progress,
    });

    // Respond immediately — execution runs in background
    res.json({
      ok: true,
      message: debugVisible && scriptsWithBreakpoints.size > 0
        ? `Execution started with debugpy for ${scriptsWithBreakpoints.size} script(s)`
        : 'Execution started (no debug)',
      steps: activeSteps,
      debugScripts: [...scriptsWithBreakpoints],
      resultId,
      stopOnFailure,
      officeSync,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Lab Script Debug (create result run) ─────────────────────────────────────

/**
 * POST /api/v1/labs/:id/scripts/debug
 * Body: { workflowFile: "path/to/workflow.workflow" }
 *
 * Creates a new sequentially numbered result subfolder inside the lab's results/,
 * creates runtime.env in the result folder from merged environment.json hierarchy,
 * Copies contents of "outputs/" folder from the workflow directory into the result (if it exists).
 * Adds a "run" key with workflow metadata, user info, and paths into runtime.env.
 *
 * Returns: { resultId, resultPath, runtimeEnvPath, progress }
 */
router.post('/:id/scripts/debug', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { workflowFile } = req.body ?? {};
    if (!workflowFile) {
      return res.status(400).json({ error: 'workflowFile is required' });
    }

    // Verify the file exists in scripts
    const scriptsRoot = getLabScriptsRoot(req.params.id);
    const wfPath = getSecurePath(scriptsRoot, workflowFile);
    if (!wfPath) return res.status(400).json({ error: 'Invalid workflow file path' });
    const wfExt = path.extname(workflowFile).toLowerCase();
    const isWorkflow = wfExt === '.workflow';
    const isSingleScript = ['.py', '.js', '.cjs', '.r'].includes(wfExt);
    if (!isWorkflow && !isSingleScript) {
      return res.status(400).json({ error: 'File must be .workflow, .py, .js, .cjs or .r' });
    }
    try {
      const wfStat = await fs.stat(wfPath);
      if (!wfStat.isFile()) return res.status(400).json({ error: 'Path is not a file' });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      throw e;
    }

    // Determine next sequential result id
    const resultsRoot = getLabResultsRoot(req.params.id);
    await fs.mkdir(resultsRoot, { recursive: true });
    let entries;
    try {
      entries = await fs.readdir(resultsRoot, { withFileTypes: true });
    } catch { entries = []; }

    const existingIds = entries
      .filter((e) => e.isDirectory())
      .map((e) => parseInt(e.name, 10))
      .filter((n) => !isNaN(n));
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

    // Create the result subfolder
    const resultDir = path.join(resultsRoot, String(nextId));
    await fs.mkdir(resultDir, { recursive: true });

    const wfDir = path.dirname(wfPath);

    // Build runtime.env in the result directory from merged environment.json files.
    const runtimeEnvPath = path.join(resultDir, 'runtime.env');
    try {
      await writeRuntimeEnvironmentFile({
        sourceFilePath: wfPath,
        labsRoot: LABS_ROOT,
        outputFilePath: runtimeEnvPath,
      });
    } catch (err) {
      return res.status(400).json({ error: `Cannot build runtime.env: ${err.message}` });
    }

    // Copy outputs folder contents from the workflow directory into the result (if it exists)
    // Folder name is configurable via config.json "outputsFolderName" (default: "Outputs")
    let outputsFolderName = 'Outputs';
    try {
      const cfgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');
      const cfgData = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
      if (cfgData.outputsFolderName) outputsFolderName = cfgData.outputsFolderName;
    } catch { /* use default */ }
    const outputsSrc = path.join(wfDir, outputsFolderName);
    try {
      const outputsStat = await fs.stat(outputsSrc);
      if (outputsStat.isDirectory()) {
        const outputEntries = await fs.readdir(outputsSrc, { withFileTypes: true });
        for (const entry of outputEntries) {
          await copyRecursive(
            path.join(outputsSrc, entry.name),
            path.join(resultDir, entry.name),
          );
        }
      }
    } catch { /* outputs/ doesn't exist — skip */ }

    // Read workflow steps — from .workflow file or single script
    let workflowSteps = [];
    if (isWorkflow) {
      try {
        const wfContent = await fs.readFile(wfPath, 'utf-8');
        workflowSteps = wfContent.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      } catch {
        workflowSteps = [workflowFile];
      }
    } else {
      // Single script — workflow is just that one script
      workflowSteps = [workflowFile];
    }

    const { now, run } = await buildRunMetadata({
      userId: req.userId,
      workflowFile,
      isWorkflow,
      workflowSteps,
      scriptsRoot,
      mode: 'debug',
    });

    let runtimeData = await readJsonFile(runtimeEnvPath, { allowMissing: true });
    if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData)) {
      runtimeData = {};
    }
    runtimeData.run = run;
    await writeJsonFile(runtimeEnvPath, runtimeData);

    // Write initial progress.json
    const progress = {
      status: 'ready',
      workflowFile,
      totalSteps: null,
      currentStep: 0,
      currentStepName: null,
      stepStartedAt: null,
      analysisStartedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await fs.writeFile(path.join(resultDir, '_progress.json'), JSON.stringify(progress, null, 2), 'utf-8');

    res.status(201).json({
      resultId: String(nextId),
      resultPath: `results/${nextId}`,
      workflowFile,
      runtimeEnvPath: `results/${nextId}/runtime.env`,
      progress,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Lab Script Run (run workflow to Outputs folder) ──────────────────────────

/**
 * POST /api/v1/labs/:id/scripts/run
 * Body: { workflowFile: "path/to/workflow.workflow", stopOnFailure?: boolean }
 *
 * Runs a workflow directly from the Scripts tab with output going to the Outputs
 * folder (alongside the .workflow file) instead of a numbered result folder.
 * Uses a virtual resultId "_output" for workflow tracking / SSE events.
 *
 * The first script argument (RESULT_ROOT) is set to the Outputs folder path.
 * The second argument is a runtime env JSON path next to the launched file:
 *   - *.workflow.env for workflows
 *   - *.py.env / *.js.env / *.cjs.env / *.r.env for single scripts
 */
router.post('/:id/scripts/run', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const labId = req.params.id;
    const { workflowFile } = req.body ?? {};
    const stopOnFailure = req.body?.stopOnFailure !== false;

    if (!workflowFile) {
      return res.status(400).json({ error: 'workflowFile is required' });
    }

    // Verify the workflow file exists in scripts
    const scriptsRoot = getLabScriptsRoot(labId);
    const wfPath = getSecurePath(scriptsRoot, workflowFile);
    if (!wfPath) return res.status(400).json({ error: 'Invalid workflow file path' });
    try {
      const wfStat = await fs.stat(wfPath);
      if (!wfStat.isFile()) return res.status(400).json({ error: 'Workflow path is not a file' });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'Workflow file not found' });
      throw e;
    }

    // Force-save open Office docs before the workflow reads them from disk.
    const officeSync = await syncOfficeBeforeRun(labId, res);
    if (officeSync === null) return;

    // Determine the Outputs folder (at lab level, inside scripts root)
    let outputsFolderName = 'Outputs';
    try {
      const cfgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');
      const cfgData = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
      if (cfgData.outputsFolderName) outputsFolderName = cfgData.outputsFolderName;
    } catch { /* use default */ }

    const outputDir = path.join(scriptsRoot, outputsFolderName);
    await fs.mkdir(outputDir, { recursive: true });

    // Parse workflow steps
    let activeSteps;
    let commentedSteps = [];

    const wfExt = path.extname(workflowFile).toLowerCase();
    const isSingleScript = ['.py', '.js', '.cjs', '.r'].includes(wfExt);
    const isWorkflow = !isSingleScript;

    if (isSingleScript) {
      // Single script — treat as a one-step workflow
      activeSteps = [workflowFile];
    } else {
      const wfContent = await fs.readFile(wfPath, 'utf-8');
      const allLines = wfContent.split('\n').map(s => s.trim()).filter(s => s);
      activeSteps = allLines.filter(s => !s.startsWith('#'));
      commentedSteps = allLines.filter(s => s.startsWith('#')).map(s => s.replace(/^#+\s*/, ''));
    }

    if (activeSteps.length === 0) {
      return res.status(400).json({ error: 'Workflow has no active steps' });
    }

    // Build runtime env next to the launched file and always overwrite it.
    const runtimeEnvPath = `${wfPath}.env`;
    try {
      await writeRuntimeEnvironmentFile({
        sourceFilePath: wfPath,
        labsRoot: LABS_ROOT,
        outputFilePath: runtimeEnvPath,
      });
    } catch (err) {
      return res.status(400).json({ error: `Cannot build runtime env file: ${err.message}` });
    }

    const { run } = await buildRunMetadata({
      userId: req.userId,
      workflowFile,
      isWorkflow,
      workflowSteps: activeSteps,
      scriptsRoot,
      mode: 'production',
    });

    let runtimeData = await readJsonFile(runtimeEnvPath, { allowMissing: true });
    if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData)) {
      runtimeData = {};
    }
    runtimeData.run = run;
    await writeJsonFile(runtimeEnvPath, runtimeData);

    // Execute strictly from run.workflow in runtime env.
    const runtimeDataFresh = await readJsonFile(runtimeEnvPath);
    const runtimeWorkflow = runtimeDataFresh?.run?.workflow;
    if (!runtimeWorkflow) {
      return res.status(400).json({ error: 'No run.workflow found in runtime env file' });
    }

    if (typeof runtimeWorkflow === 'string') {
      const wfRuntimePath = getSecurePath(scriptsRoot, runtimeWorkflow);
      if (!wfRuntimePath) return res.status(400).json({ error: 'Invalid workflow file path in run.workflow' });

      let wfRuntimeContent;
      try {
        wfRuntimeContent = await fs.readFile(wfRuntimePath, 'utf-8');
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: `Workflow file not found: ${runtimeWorkflow}` });
        throw e;
      }

      const allLines = wfRuntimeContent.split('\n').map(s => s.trim()).filter(s => s);
      activeSteps = allLines.filter(s => !s.startsWith('#'));
      commentedSteps = allLines.filter(s => s.startsWith('#')).map(s => s.replace(/^#+\s*/, ''));
    } else if (Array.isArray(runtimeWorkflow)) {
      const allItems = runtimeWorkflow.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
      activeSteps = allItems.filter(s => !s.startsWith('#'));
      commentedSteps = allItems.filter(s => s.startsWith('#')).map(s => s.replace(/^#+\s*/, ''));
    } else {
      return res.status(400).json({ error: '"run.workflow" must be a string (path to .workflow file) or an array of script paths' });
    }

    if (activeSteps.length === 0) {
      return res.status(400).json({ error: 'run.workflow has no active steps' });
    }

    // Resolve <ALIAS>/path references
    const aliases = await readAliases();
    const resolvedPaths = {};
    for (let i = 0; i < activeSteps.length; i++) {
      const step = activeSteps[i];
      const aliasMatch = step.match(/^<([A-Z0-9_-]+)>\/(.+)$/);
      if (aliasMatch) {
        const [, alias, relPath] = aliasMatch;
        const targetLabId = aliases[alias];
        if (!targetLabId) {
          return res.status(400).json({ error: `Unknown alias <${alias}> in step "${step}"` });
        }
        const targetScriptsRoot = getLabScriptsRoot(targetLabId);
        const absPath = getSecurePath(targetScriptsRoot, relPath);
        if (!absPath) {
          return res.status(400).json({ error: `Invalid path in aliased step "${step}"` });
        }
        resolvedPaths[step] = absPath;
      }
    }

    // Workflow root: directory of the .workflow file relative to scripts root
    const workflowRoot = run._workflowRoot || '';

    // Determine python command from config
    let pythonCmd = 'python';
    try {
      const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');
      const configData = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      const pyConfig = configData.scriptCommands?.['.py'];
      if (pyConfig?.command) {
        const cmd = pyConfig.command;
        if (cmd.startsWith('./') || cmd.startsWith('/')) {
          pythonCmd = path.isAbsolute(cmd) ? cmd : path.resolve(path.dirname(configPath), cmd);
        } else {
          pythonCmd = cmd;
        }
      }
    } catch { /* use default */ }

    // Use virtual resultId "_output" for SSE tracking
    const resultId = '_output';

    // Start workflow via the workflow runner (runs in background)
    startWorkflowRun({
      labId,
      resultId,
      steps: activeSteps,
      commentedSteps,
      resultDir: outputDir,
      scriptsRoot,
      workflowRoot,
      runtimeEnvPath,
      pythonCmd,
      debugVisible: false,
      debugScripts: new Set(),
      stopOnFailure,
      resolvedPaths,
      logFile: path.join(outputDir, 'output.log'),
      errorFile: path.join(outputDir, 'output.err'),
      debugLogFile: null,
      progressBase: {},
    });

    res.json({
      ok: true,
      message: 'Workflow execution started (output mode)',
      steps: activeSteps,
      resultId,
      runtimeEnvPath: `${workflowFile}.env`,
      stopOnFailure,
      officeSync,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Lab Scripts (file-manager) ───────────────────────────────────────────────

// List lab scripts folder (uses shared file-manager helpers).
router.get('/:id/scripts', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);

    const fullAccess = hasAccess(lab, req.userId);
    const sharedFolderPaths = fullAccess ? [] : getSharedFolderPaths(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { subdir } = req.query;
    const root = getLabScriptsRoot(req.params.id);
    const targetPath = getSecurePath(root, subdir || '');
    if (!targetPath) return res.status(400).json({ error: 'Invalid path' });

    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    let files;
    if (fullAccess) {
      files = await listFiles(targetPath, subdir || '', getDefaultDepth());
    } else {
      // Folder-only access: build tree directly from each shared folder (avoids complex filtering)
      const depth = getDefaultDepth();
      const folderEntries = sharedFolderPaths
        .map(sfPath => sfPath.replace(/\\/g, '/').replace(/^scripts\//, '').replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .map(folderRel => ({ folderRel, folderAbs: path.join(root, ...folderRel.split('/')) }));
      files = (await Promise.all(
        folderEntries.map(async ({ folderRel, folderAbs }) => {
          try {
            const [st, children] = await Promise.all([
              fs.stat(folderAbs),
              listFiles(folderAbs, folderRel, depth),
            ]);
            return { name: path.basename(folderRel), path: folderRel, type: 'directory', size: 0, mtime: st.mtime.toISOString(), children };
          } catch { return null; }
        })
      )).filter(Boolean);
    }
    res.json({ root: subdir || '', items: files, count: files.length, readOnly: !fullAccess });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
    next(e);
  }
});

// Build Euro/OnlyOffice editor configuration for a scripts file (DOCX/XLSX).
router.get('/:id/scripts/office/editor-config', async (req, res, next) => {
  try {
    const { file, mode = 'edit' } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(String(file), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this file' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const payload = await buildOfficeEditorConfig({
      req,
      userId: req.userId,
      area: 'scripts',
      labId: req.params.id,
      resultId: null,
      rootPath: root,
      filePath: String(file),
      requestedMode: String(mode || 'edit'),
    });

    res.json(payload);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Active Office edit sessions for scripts files.
router.get('/:id/scripts/office/active', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });

    const sessions = listOfficeSessionsForScope({
      area: 'scripts',
      labId: req.params.id,
      resultId: null,
    });

    res.json({ sessions });
  } catch (e) {
    next(e);
  }
});

// Manual force-save + wait for a specific scripts Office file.
router.post('/:id/scripts/office/sync', async (req, res, next) => {
  try {
    const file = String(req.query.file || req.body?.file || '').trim();
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(file, sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this file' });
    }

    const syncResult = await syncOfficeSessionForFile({
      area: 'scripts',
      labId: req.params.id,
      resultId: null,
      filePath: file,
      waitForSave: true,
    });

    if (!syncResult.ok) {
      return res.status(409).json({ error: syncResult.error || 'Office sync failed', details: syncResult });
    }

    res.json(syncResult);
  } catch (e) {
    next(e);
  }
});

// Read a lab script file.
router.get('/:id/scripts/content', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const fullAccess = hasAccess(lab, req.userId);
    const sharedFolderPaths = fullAccess ? [] : getSharedFolderPaths(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!fullAccess && !isPathInSharedFolders(String(file), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this file' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const filePath = getSecurePath(root, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return res.status(400).json({ error: 'Path is not a file' });

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ file, content, size: stats.size, mtime: stats.mtime.toISOString() });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Update or create a lab script file.
router.put('/:id/scripts/content', async (req, res, next) => {
  try {
    const { file, content } = req.body ?? {};
    if (!file || content === undefined) {
      return res.status(400).json({ error: 'Missing file or content parameter' });
    }

    // Reject writes to readonly files
    if (isReadonlyPath(file)) {
      return res.status(403).json({ error: 'readonly', message: 'File is read-only' });
    }

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(String(file), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const filePath = getSecurePath(root, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    // Ensure parent directory exists (allows creating new files in new folders)
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    const stats = await fs.stat(filePath);
    res.json({ success: true, file, size: stats.size, mtime: stats.mtime.toISOString() });
  } catch (e) {
    next(e);
  }
});

// Upload a new script file into the lab.
router.post('/:id/scripts/upload', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });

    const root = getLabScriptsRoot(req.params.id);
    const upload = createUploadMiddleware(root, 50 * 1024 * 1024);
    upload.single('file')(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      if (!fullAccess) {
        const uploadedRelPath = path.join(req.body.targetPath || '', req.file.filename);
        if (!isPathInSharedFolders(uploadedRelPath, sharedFolderPaths)) {
          await fs.unlink(req.file.path).catch(() => {});
          return res.status(403).json({ error: 'Access denied to this path' });
        }
      }
      res.json({ success: true, file: req.file.filename, size: req.file.size });
    });
  } catch (e) {
    next(e);
  }
});

// Delete a script file from the lab.
router.delete('/:id/scripts', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(String(file), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const filePath = getSecurePath(root, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    await fs.unlink(filePath);
    res.json({ success: true, message: 'File deleted' });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Download a single script file from the lab.
router.get('/:id/scripts/download', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const fullAccess = hasAccess(lab, req.userId);
    const sharedFolderPaths = fullAccess ? [] : getSharedFolderPaths(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!fullAccess && !isPathInSharedFolders(String(file), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this file' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const filePath = getSecurePath(root, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return res.status(400).json({ error: 'Path is not a file' });

    // inline=1 → serve for in-browser display (PDF, images)
    if (req.query.inline === '1') {
      return res.sendFile(filePath);
    }
    res.download(filePath, path.basename(filePath));
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Unpack a ZIP/GZIP archive directly inside the scripts folder.
router.post('/:id/scripts/unpack', async (req, res, next) => {
  try {
    const { file } = req.body ?? {};
    if (!file?.trim()) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(file.trim(), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const { extracted, skippedUnsafe } = await unpackArchiveAtRoot({
      rootPath: root,
      relativeArchivePath: file.trim(),
    });

    if (extracted.length === 0) {
      return res.status(400).json({
        error: 'Archive did not contain any unpackable files',
        skippedUnsafe,
      });
    }

    res.json({
      success: true,
      file: file.trim(),
      extractedCount: extracted.length,
      extracted,
      skippedUnsafeCount: skippedUnsafe.length,
      skippedUnsafe,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Archive file not found' });
    if (e.code === 'Z_DATA_ERROR' || /invalid|central directory|signature/i.test(String(e.message || ''))) {
      return res.status(400).json({ error: 'Invalid archive file' });
    }
    next(e);
  }
});

// Download an entire folder as a ZIP archive.
router.get('/:id/scripts/folder/zip', async (req, res, next) => {
  try {
    const { path: folderPath } = req.query;
    if (!folderPath) return res.status(400).json({ error: 'Missing path parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(String(folderPath), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const dirPath = getSecurePath(root, folderPath);
    if (!dirPath) return res.status(400).json({ error: 'Invalid path' });

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const zipName = folderPath.replace(/\//g, '_') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(dirPath, false);
    await archive.finalize();
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found' });
    next(e);
  }
});

// Create a new folder inside the lab's scripts directory.
router.post('/:id/scripts/folder', async (req, res, next) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath?.trim()) return res.status(400).json({ error: 'Missing path parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(folderPath.trim(), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const dirPath = getSecurePath(root, folderPath.trim());
    if (!dirPath) return res.status(400).json({ error: 'Invalid path' });

    await fs.mkdir(dirPath, { recursive: true });
    res.status(201).json({ success: true, path: folderPath.trim() });
  } catch (e) {
    next(e);
  }
});

// Rename a file or folder inside lab scripts.
router.post('/:id/scripts/rename', async (req, res, next) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath?.trim() || !newPath?.trim()) {
      return res.status(400).json({ error: 'Both oldPath and newPath are required' });
    }

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && (!isPathInSharedFolders(oldPath.trim(), sharedFolderPaths) || !isPathInSharedFolders(newPath.trim(), sharedFolderPaths))) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const srcPath = getSecurePath(root, oldPath.trim());
    const dstPath = getSecurePath(root, newPath.trim());
    if (!srcPath || !dstPath) return res.status(400).json({ error: 'Invalid path' });
    if (srcPath === root) return res.status(400).json({ error: 'Cannot rename scripts root' });

    // Ensure source exists
    try { await fs.stat(srcPath); } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'Source not found' });
      throw e;
    }

    // Ensure destination parent exists
    await fs.mkdir(path.dirname(dstPath), { recursive: true });

    // Ensure destination doesn't already exist
    try { await fs.stat(dstPath); return res.status(409).json({ error: 'Destination already exists' }); }
    catch { /* good — doesn't exist */ }

    await fs.rename(srcPath, dstPath);
    res.json({ success: true, oldPath: oldPath.trim(), newPath: newPath.trim() });
  } catch (e) {
    next(e);
  }
});

// Delete an entire folder recursively.
router.delete('/:id/scripts/folder', async (req, res, next) => {
  try {
    const { path: folderPath } = req.query;
    if (!folderPath) return res.status(400).json({ error: 'Missing path parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    const { fullAccess, sharedFolderPaths } = getScriptAccess(lab, req.userId);
    if (!fullAccess && sharedFolderPaths.length === 0) return res.status(403).json({ error: 'Access denied' });
    if (!fullAccess && !isPathInSharedFolders(String(folderPath), sharedFolderPaths)) {
      return res.status(403).json({ error: 'Access denied to this path' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const dirPath = getSecurePath(root, folderPath);
    if (!dirPath) return res.status(400).json({ error: 'Invalid path' });

    // Safety: never allow deleting the scripts root itself
    if (dirPath === root) return res.status(400).json({ error: 'Cannot delete scripts root' });

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    await fs.rm(dirPath, { recursive: true, force: true });
    res.json({ success: true, message: `Folder "${folderPath}" deleted` });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found' });
    next(e);
  }
});

// ─── Publish to current_output ────────────────────────────────────────────────

/**
 * POST /api/v1/labs/:id/results/:resultId/publish
 * Body: { path: "relative/path/to/file_or_folder" }
 *
 * Copies a file or folder from the result directory to the lab's current_output/
 * directory, preserving the relative path structure.
 */
router.post('/:id/results/:resultId/publish', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { path: itemPath } = req.body ?? {};
    if (!itemPath) return res.status(400).json({ error: 'path is required' });

    const resultsRoot = getLabResultsRoot(req.params.id);
    const resultDir = path.join(resultsRoot, req.params.resultId);
    const secureResult = getSecurePath(resultsRoot, req.params.resultId);
    if (!secureResult) return res.status(400).json({ error: 'Invalid result id' });

    const srcPath = getSecurePath(resultDir, itemPath);
    if (!srcPath) return res.status(400).json({ error: 'Invalid path' });

    const outputRoot = getLabCurrentOutputRoot(req.params.id);
    await fs.mkdir(outputRoot, { recursive: true });

    const dstPath = path.join(outputRoot, itemPath);
    await fs.mkdir(path.dirname(dstPath), { recursive: true });

    await copyRecursive(srcPath, dstPath);

    res.json({ success: true, message: `Published "${itemPath}" to current_output` });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File or folder not found' });
    next(e);
  }
});

/**
 * POST /api/v1/labs/:id/results/:resultId/load-current-output
 *
 * Copies all items from lab current_output (scripts/Outputs) into
 * the selected result directory. Existing files are overwritten.
 */
router.post('/:id/results/:resultId/load-current-output', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const resultsRoot = getLabResultsRoot(req.params.id);
    const resultDir = getSecurePath(resultsRoot, req.params.resultId);
    if (!resultDir) return res.status(400).json({ error: 'Invalid result id' });

    const resultStat = await fs.stat(resultDir);
    if (!resultStat.isDirectory()) return res.status(400).json({ error: 'Result is not a directory' });

    const outputRoot = getLabCurrentOutputRoot(req.params.id);
    await fs.mkdir(outputRoot, { recursive: true });

    const outputEntries = await fs.readdir(outputRoot, { withFileTypes: true });
    for (const entry of outputEntries) {
      await copyRecursive(
        path.join(outputRoot, entry.name),
        path.join(resultDir, entry.name),
      );
    }

    res.json({
      success: true,
      copiedCount: outputEntries.length,
      copied: outputEntries.map((entry) => entry.name),
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Result not found' });
    next(e);
  }
});

// ─── Current Output (read-only file-manager) ─────────────────────────────────

// List current_output folder.
router.get('/:id/current_output', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabCurrentOutputRoot(req.params.id);
    await fs.mkdir(root, { recursive: true });

    const { subdir } = req.query;
    const targetPath = getSecurePath(root, subdir || '');
    if (!targetPath) return res.status(400).json({ error: 'Invalid path' });

    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const files = await listFiles(targetPath, subdir || '', getDefaultDepth());
    res.json({ root: subdir || '', items: files, count: files.length });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
    next(e);
  }
});

// Build Euro/OnlyOffice editor configuration for current_output files (view-only).
router.get('/:id/current_output/office/editor-config', async (req, res, next) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabCurrentOutputRoot(req.params.id);
    await fs.mkdir(root, { recursive: true });

    const payload = await buildOfficeEditorConfig({
      req,
      userId: req.userId,
      area: 'current_output',
      labId: req.params.id,
      resultId: null,
      rootPath: root,
      filePath: String(file),
      requestedMode: 'view',
    });

    res.json(payload);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Current output has no editable Office sessions (view-only), keep shape for frontend polling.
router.get('/:id/current_output/office/active', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sessions = listOfficeSessionsForScope({
      area: 'current_output',
      labId: req.params.id,
      resultId: null,
    });

    res.json({ sessions });
  } catch (e) {
    next(e);
  }
});

// Read file content from current_output.
router.get('/:id/current_output/content', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabCurrentOutputRoot(req.params.id);
    const filePath = getSecurePath(root, req.query.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ file: req.query.file, content });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Download file from current_output.
router.get('/:id/current_output/download', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabCurrentOutputRoot(req.params.id);
    const filePath = getSecurePath(root, req.query.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const inline = req.query.inline === '1';
    if (inline) {
      res.sendFile(filePath);
    } else {
      res.download(filePath);
    }
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// Download folder as zip from current_output.
router.get('/:id/current_output/folder/zip', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabCurrentOutputRoot(req.params.id);
    const folderPath = req.query.path || '.';
    const dirPath = folderPath === '.' ? root : getSecurePath(root, folderPath);
    if (!dirPath) return res.status(400).json({ error: 'Invalid path' });

    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const zipName = folderPath === '.' ? 'current_output.zip' : `${path.basename(folderPath)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    archive.directory(dirPath, false);
    await archive.finalize();
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found' });
    next(e);
  }
});

export default router;
