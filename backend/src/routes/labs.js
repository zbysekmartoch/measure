import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import archiver from 'archiver';
import { getSecurePath, listFiles, createUploadMiddleware, getDefaultDepth, copyRecursive } from '../utils/file-manager.js';
import { getDebugStatus, endDebugSession } from '../debug/debug-engine.js';
import { startWorkflowRun, abortWorkflowRun } from '../workflow/workflow-runner.js';
import { query } from '../db.js';

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

// List labs owned by the current user.
router.get('/', async (req, res, next) => {
  try {
    const labs = await loadAllLabs();
    const items = labs.filter(lab => isOwner(lab, req.userId));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// List labs shared with the current user.
router.get('/shared', async (req, res, next) => {
  try {
    const labs = await loadAllLabs();
    const items = labs.filter(lab => isShared(lab, req.userId));
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

// Fetch lab metadata (owner/shared access).
router.get('/:id', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Ensure current_output directory exists
    await fs.mkdir(getLabCurrentOutputRoot(req.params.id), { recursive: true });
    res.json(lab);
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

    // Run the backup shell script
    await new Promise((resolve, reject) => {
      execFile(BACKUP_SCRIPT, [labPath, BACKUPS_DIR], { timeout: 120000 }, (err, stdout, stderr) => {
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

// Helper for lab current_output root.
function getLabCurrentOutputRoot(labId) {
  return path.join(getLabPath(labId), 'current_output');
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
        const raw = await fs.readFile(path.join(dirPath, 'progress.json'), 'utf-8');
        progress = JSON.parse(raw);
      } catch { /* no progress.json — that's fine */ }

      // Try to read environment.json for run metadata
      let run = null;
      try {
        const raw = await fs.readFile(path.join(dirPath, 'environment.json'), 'utf-8');
        const envJson = JSON.parse(raw);
        if (envJson.run) run = envJson.run;
      } catch { /* no environment.json or no run key — that's fine */ }

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
    const progressPath = path.join(resultDir, 'progress.json');
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
 * Reads the workflow from result's environment.json (key "workflow": string or string[]).
 *   - string → path to a .workflow file (relative to lab scripts), read its lines as steps
 *   - string[] → direct list of script paths (relative to lab scripts)
 *
 * Reads debug.json from the lab folder for breakpoint info.
 * Python scripts with debugVisible=true are spawned via debugpy --wait-for-client.
 *
 * Execution is delegated to WorkflowRunner which emits real-time SSE events.
 * Each script receives the result dir as its first argument.
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

    const debugVisible = req.body?.debugVisible === true;
    const stopOnFailure = req.body?.stopOnFailure !== false; // default true

    // Read environment.json from result to get workflow
    let dataJson;
    try {
      const raw = await fs.readFile(path.join(resultDir, 'environment.json'), 'utf-8');
      dataJson = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Cannot read environment.json in result folder' });
    }

    const workflow = dataJson.run?.workflow || dataJson.workflow;
    if (!workflow) {
      return res.status(400).json({ error: 'No workflow found in environment.json (run.workflow or workflow key)' });
    }

    // Resolve workflowRoot from run metadata (directory of .workflow file relative to scripts)
    const workflowRoot = dataJson.run?._workflowRoot || '';

    // Resolve scriptsRoot: if run._scriptsRoot is relative, resolve against LABS_ROOT
    const scriptsRoot = dataJson.run?._scriptsRoot
      ? path.resolve(LABS_ROOT, dataJson.run._scriptsRoot)
      : getLabScriptsRoot(labId);
    let activeSteps;

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
    } else if (Array.isArray(workflow)) {
      activeSteps = workflow.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
    } else {
      return res.status(400).json({ error: '"workflow" must be a string (path to .workflow file) or an array of script paths' });
    }

    if (activeSteps.length === 0) {
      return res.status(400).json({ error: 'Workflow has no active steps' });
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
      const raw = await fs.readFile(path.join(resultDir, 'progress.json'), 'utf-8');
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
      resultDir,
      scriptsRoot,
      workflowRoot,
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
 * copies environment.json from the same folder as the workflow file (if it exists) or creates {}.
 * Copies contents of "outputs/" folder from the workflow directory into the result (if it exists).
 * Adds a "run" key with workflow metadata, user info, and paths.
 *
 * Returns: { resultId, resultPath, environmentJsonCopied }
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

    // Verify the workflow file exists in scripts
    const scriptsRoot = getLabScriptsRoot(req.params.id);
    const wfPath = getSecurePath(scriptsRoot, workflowFile);
    if (!wfPath) return res.status(400).json({ error: 'Invalid workflow file path' });
    try {
      const wfStat = await fs.stat(wfPath);
      if (!wfStat.isFile()) return res.status(400).json({ error: 'Workflow path is not a file' });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'Workflow file not found' });
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

    // Copy environment.json from the SAME folder as the workflow file (or create empty {})
    let environmentJsonCopied = false;
    const wfDir = path.dirname(wfPath);
    const srcEnvJson = path.join(wfDir, 'environment.json');
    const dstEnvJson = path.join(resultDir, 'environment.json');
    let dataJson = {};
    try {
      await fs.access(srcEnvJson);
      const raw = await fs.readFile(srcEnvJson, 'utf-8');
      dataJson = JSON.parse(raw);
      environmentJsonCopied = true;
    } catch {
      // environment.json doesn't exist — create with defaults
      dataJson = {};
    }

    // Copy "outputs/" folder contents from the workflow directory into the result (if it exists)
    const outputsSrc = path.join(wfDir, 'outputs');
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

    // Read workflow steps from the .workflow file
    let workflowSteps = [];
    try {
      const wfContent = await fs.readFile(wfPath, 'utf-8');
      workflowSteps = wfContent.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } catch {
      workflowSteps = [workflowFile];
    }

    // Lookup user info (firstName, lastName) from the database
    let userName = '';
    try {
      const rows = await query('SELECT first_name, last_name FROM usr WHERE id = ?', [req.userId]);
      if (rows.length > 0) {
        userName = `${rows[0].first_name} ${rows[0].last_name}`;
      }
    } catch { /* ignore */ }

    // Workflow root: the directory of the .workflow file relative to scripts root
    const workflowRoot = path.dirname(workflowFile);

    // Relative scriptsRoot from LABS_ROOT (e.g. "5/scripts")
    const relativeScriptsRoot = path.relative(LABS_ROOT, scriptsRoot);

    // Default run name = workflow filename without extension
    const wfBaseName = path.basename(workflowFile, path.extname(workflowFile));

    // Build the "run" key
    const now = new Date().toISOString();
    dataJson.run = {
      workflowFile,                    // e.g. "new/fullAnalysis.workflow"
      workflow: workflowSteps,         // array of script paths from .workflow file
      name: wfBaseName,                // workflow name without extension
      author: userName,                // "firstName lastName"
      private: true,
      _: 'Do not manualy overwrite keys starting with _',
      _usr_id: req.userId,             // user id
      _workflowRoot: workflowRoot === '.' ? '' : workflowRoot,
      _scriptsRoot: relativeScriptsRoot,
      _created: now,
    };

    await fs.writeFile(dstEnvJson, JSON.stringify(dataJson, null, 2), 'utf-8');

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
    await fs.writeFile(path.join(resultDir, 'progress.json'), JSON.stringify(progress, null, 2), 'utf-8');

    res.status(201).json({
      resultId: String(nextId),
      resultPath: `results/${nextId}`,
      workflowFile,
      environmentJsonCopied,
      progress,
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
    if (!hasAccess(lab, req.userId)) {
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

    const files = await listFiles(targetPath, subdir || '', getDefaultDepth());
    res.json({ root: subdir || '', items: files, count: files.length });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const root = getLabScriptsRoot(req.params.id);
    const upload = createUploadMiddleware(root, 50 * 1024 * 1024);
    upload.single('file')(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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

// Download an entire folder as a ZIP archive.
router.get('/:id/scripts/folder/zip', async (req, res, next) => {
  try {
    const { path: folderPath } = req.query;
    if (!folderPath) return res.status(400).json({ error: 'Missing path parameter' });

    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
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
