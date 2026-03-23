// src/routes/sync.js
// Sync API routes — server-side support for the Go sync agent.
// Provides manifest (file listing with hashes), download, upload, and config creation.
//
// Mounted at: /api/v1/labs/:id/sync  (via labs.js)

import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { config } from '../config.js';
import { getSecurePath } from '../utils/file-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LABS_ROOT = path.resolve(__dirname, '../../labs');

const router = Router({ mergeParams: true });

// ── helpers (duplicated from labs.js to keep module self-contained) ──────────

function getLabPath(id) { return path.join(LABS_ROOT, String(id)); }
function getLabScriptsRoot(id) { return path.join(getLabPath(id), 'scripts'); }

async function readLabMetadata(labPath) {
  return JSON.parse(await fs.readFile(path.join(labPath, 'lab.json'), 'utf-8'));
}

function hasAccess(lab, userId) {
  return (
    String(lab.ownerId) === String(userId) ||
    (Array.isArray(lab.sharedWith) && lab.sharedWith.map(String).includes(String(userId)))
  );
}

// ── file manifest helpers ───────────────────────────────────────────────────

/**
 * Recursively collect files with SHA-256 hash, size and mtime.
 * Skips sync.json itself and hidden/underscore-prefixed entries.
 */
async function collectFiles(dirPath, relativeTo = '') {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = relativeTo ? `${relativeTo}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath, relPath)));
    } else if (entry.isFile()) {
      // Skip the config file itself
      if (entry.name === 'sync.json' && !relativeTo) continue;
      try {
        const stat = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        results.push({
          path: relPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          hash,
        });
      } catch {
        // skip unreadable files
      }
    }
  }
  return results;
}

// ── access check middleware ─────────────────────────────────────────────────

async function requireLabAccess(req, res, next) {
  try {
    const labPath = getLabPath(req.params.id);
    const lab = await readLabMetadata(labPath);
    if (!hasAccess(lab, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.lab = lab;
    next();
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Lab not found' });
    next(e);
  }
}

router.use(requireLabAccess);

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-config
// Creates sync.json inside a scripts subfolder.
// Body: { folder: "relative/path", serverUrl: "https://..." }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create-config', async (req, res, next) => {
  try {
    const labId = req.params.id;
    const { folder = '', serverUrl = '' } = req.body ?? {};

    const root = getLabScriptsRoot(labId);
    const syncFolder = folder ? getSecurePath(root, folder) : root;
    if (!syncFolder) return res.status(400).json({ error: 'Invalid folder' });

    // Verify it exists
    const stat = await fs.stat(syncFolder);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    // Generate a long-lived sync token (365 days)
    const syncToken = jwt.sign(
      { userId: req.userId, type: 'sync', labId, folder },
      config.jwtSecret,
      { expiresIn: '365d' },
    );

    const syncConfig = {
      server: serverUrl,
      labId,
      folder: folder || '',
      token: syncToken,
      syncInterval: 3,
      created: new Date().toISOString(),
    };

    const syncPath = path.join(syncFolder, 'sync.json');
    await fs.writeFile(syncPath, JSON.stringify(syncConfig, null, 2), 'utf-8');

    res.json(syncConfig);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found' });
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /manifest
// Returns recursive file listing with SHA-256 hashes.
// Query: ?folder=relative/path
// ─────────────────────────────────────────────────────────────────────────────
router.get('/manifest', async (req, res, next) => {
  try {
    const labId = req.params.id;
    const { folder } = req.query;

    const root = getLabScriptsRoot(labId);
    const syncRoot = folder ? getSecurePath(root, folder) : root;
    if (!syncRoot) return res.status(400).json({ error: 'Invalid folder' });

    const files = await collectFiles(syncRoot);
    res.json({ files, serverTime: new Date().toISOString() });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found' });
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /download
// Download a single file (binary safe).
// Query: ?folder=...&file=relative/path
// ─────────────────────────────────────────────────────────────────────────────
router.get('/download', async (req, res, next) => {
  try {
    const labId = req.params.id;
    const { folder, file } = req.query;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });

    const root = getLabScriptsRoot(labId);
    const syncRoot = folder ? getSecurePath(root, folder) : root;
    if (!syncRoot) return res.status(400).json({ error: 'Invalid folder' });

    const filePath = getSecurePath(syncRoot, file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    res.download(filePath, path.basename(filePath));
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload
// Upload a modified file (only updates existing server files).
// Query: ?folder=...
// Body: multipart — field "file" + field "relativePath"
// ─────────────────────────────────────────────────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');

router.post('/upload', (req, res, next) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    try {
      const labId = req.params.id;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const relativePath = req.body.relativePath;
      if (!relativePath) return res.status(400).json({ error: 'Missing relativePath' });

      const { folder } = req.query;
      const root = getLabScriptsRoot(labId);
      const syncRoot = folder ? getSecurePath(root, folder) : root;
      if (!syncRoot) return res.status(400).json({ error: 'Invalid folder' });

      const filePath = getSecurePath(syncRoot, relativePath);
      if (!filePath) return res.status(400).json({ error: 'Invalid file path' });

      // Only allow updating existing files
      try {
        const st = await fs.stat(filePath);
        if (!st.isFile()) return res.status(400).json({ error: 'Not a file' });
      } catch (e) {
        if (e.code === 'ENOENT') {
          return res.status(404).json({ error: 'File does not exist on server. Only existing files can be synced.' });
        }
        throw e;
      }

      await fs.writeFile(filePath, req.file.buffer);
      const stat = await fs.stat(filePath);
      const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      res.json({
        success: true,
        file: relativePath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        hash,
      });
    } catch (e) {
      next(e);
    }
  });
});

export default router;
