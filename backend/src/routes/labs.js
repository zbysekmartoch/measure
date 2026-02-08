import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { getSecurePath, listFiles, createUploadMiddleware, getDefaultDepth } from '../utils/file-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root folder for all labs. Each lab has its own subfolder with metadata and files.
const LABS_ROOT = path.resolve(__dirname, '../../labs');

const router = Router();

// Ensure base labs folder exists (called before listing/creating).
async function ensureLabsRoot() {
  await fs.mkdir(LABS_ROOT, { recursive: true });
}

// Resolve lab folder path from lab id (id is a string like "1", "2", …).
function getLabPath(id) {
  return path.join(LABS_ROOT, String(id));
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

// Fetch lab metadata (owner/shared access).
router.get('/:id', async (req, res, next) => {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(lab);
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
    await fs.rm(labPath, { recursive: true, force: true });
    res.json({ success: true });
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

// Helper for lab scripts root.
function getLabScriptsRoot(labId) {
  return path.join(getLabPath(labId), 'scripts');
}

// Helper for lab results root.
function getLabResultsRoot(labId) {
  return path.join(getLabPath(labId), 'results');
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
      });
    }

    // Sort newest first
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ items });
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

// ─── Lab Script Debug (create result run) ─────────────────────────────────────

/**
 * POST /api/v1/labs/:id/scripts/debug
 * Body: { workflowFile: "path/to/workflow.workflow" }
 *
 * Creates a new sequentially numbered result subfolder inside the lab's results/,
 * copies data.json from the lab's scripts root (if it exists) or creates an empty one,
 * and writes an initial progress.json.
 *
 * Returns: { resultId, resultPath, dataJsonCopied }
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

    // Copy data.json from scripts root (or create empty)
    let dataJsonCopied = false;
    const srcDataJson = path.join(scriptsRoot, 'data.json');
    const dstDataJson = path.join(resultDir, 'data.json');
    try {
      await fs.access(srcDataJson);
      await fs.copyFile(srcDataJson, dstDataJson);
      dataJsonCopied = true;
    } catch {
      // data.json doesn't exist in scripts — create empty
      await fs.writeFile(dstDataJson, '{}', 'utf-8');
    }

    // Write initial progress.json
    const now = new Date().toISOString();
    const progress = {
      status: 'pending',
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
      dataJsonCopied,
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

export default router;
