// src/routes/index.js – hlavní router backendu
import { Router } from 'express';
import { notFound, errorHandler } from '../middleware/error.js';
import { config } from '../config.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import analyses from './analyses.js'; 
import results from './results.js';
import workflows from './workflows.js';
import auth from './auth.js';
import sql from './sql.js';
import labs from './labs.js';
import users from './users.js';
import scripts, { publicRouter as scriptsPublic } from './scripts.js';
import resultFiles, { publicRouter as resultFilesPublic } from './result-files.js';
import { authenticateToken } from '../middleware/auth.js';
import { getSecurePath, copyRecursive } from '../utils/file-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Rozšířený healthcheck s informacemi o systému
router.get('/health', async (req, res) => {
  try {
    // Načti verzi z package.json
    const packageJsonPath = path.join(__dirname, '../../package.json');
    let version = 'unknown';
    let appName = 'rpa-backend';
    
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      version = packageJson.version || 'unknown';
      appName = packageJson.name || 'rpa-backend';
    } catch (e) {
      console.warn('Failed to read package.json:', e.message);
    }

    // Získej hostname a port
    const hostname = os.hostname();
    const port = config.port || process.env.PORT || 3000;

    res.json({ 
      ok: true,
      service: appName,
      version: version,
      build: process.env.BUILD_NUMBER || process.env.npm_package_version || version,
      server: {
        host: hostname,
        port: port,
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime()
      },
      database: {
        host: config.db.host,
 //       port: config.db.port,
        name: config.db.database,
 //       user: config.db.user
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: 'Health check failed',
      message: error.message 
    });
  }
});

// API routes - auth endpoint bez autentifikace
router.use('/v1/auth', auth);

// Public file downloads (bez auth pro direct links v prohlížeči)
import resultsPublic from './results-public.js';
router.use('/v1/results-public', resultsPublic);

// Public scripts download (bez auth pro direct links)
router.use('/v1/scripts', scriptsPublic);

// Public result files download (bez auth pro direct links)
router.use('/v1/results/:id/files', resultFilesPublic);

// Všechny ostatní v1 routes vyžadují autentifikaci
router.use('/v1/analyses', authenticateToken, analyses);
router.use('/v1/results/:id/files', authenticateToken, resultFiles); // Před obecným /results
router.use('/v1/results', authenticateToken, results);
router.use('/v1/workflows', authenticateToken, workflows);
router.use('/v1/sql', authenticateToken, sql);
router.use('/v1/labs', authenticateToken, labs);
router.use('/v1/users', authenticateToken, users);
router.use('/v1/scripts', authenticateToken, scripts);

// ─── Generic paste (copy file/folder across any file-manager root) ────────────
// Body: { sourceApi, sourcePath, targetApi, targetFolder }
// sourceApi / targetApi examples:
//   "/api/v1/scripts", "/api/v1/labs/3/scripts", "/api/v1/labs/3/results/75/files"
const SCRIPTS_ROOT = path.resolve(__dirname, '../../scripts');
const RESULTS_ROOT = path.resolve(__dirname, '../../results');
const LABS_ROOT    = path.resolve(__dirname, '../../labs');

function resolveApiRoot(apiBase) {
  // /api/v1/scripts
  if (/^\/api\/v1\/scripts$/.test(apiBase)) return SCRIPTS_ROOT;
  // /api/v1/results/:id/files
  const rm = apiBase.match(/^\/api\/v1\/results\/([^/]+)\/files$/);
  if (rm) return path.join(RESULTS_ROOT, rm[1]);
  // /api/v1/labs/:id/scripts
  const lm = apiBase.match(/^\/api\/v1\/labs\/([^/]+)\/scripts$/);
  if (lm) return path.join(LABS_ROOT, lm[1], 'scripts');
  // /api/v1/labs/:id/results/:resultId/files
  const lr = apiBase.match(/^\/api\/v1\/labs\/([^/]+)\/results\/([^/]+)\/files$/);
  if (lr) return path.join(LABS_ROOT, lr[1], 'results', lr[2]);
  return null;
}

router.post('/v1/paste', authenticateToken, async (req, res, next) => {
  try {
    const { sourceApi, sourcePath, targetApi, targetFolder } = req.body ?? {};
    if (!sourceApi || !sourcePath || !targetApi) {
      return res.status(400).json({ error: 'Missing sourceApi, sourcePath, or targetApi' });
    }

    const srcRoot = resolveApiRoot(sourceApi);
    const dstRoot = resolveApiRoot(targetApi);
    if (!srcRoot || !dstRoot) {
      return res.status(400).json({ error: 'Cannot resolve API base to filesystem root' });
    }

    const srcAbs = getSecurePath(srcRoot, sourcePath);
    if (!srcAbs) return res.status(400).json({ error: 'Invalid source path' });

    // Check source exists
    const srcStat = await fs.stat(srcAbs);

    // Determine destination path
    const baseName = path.basename(srcAbs);
    const destDir = targetFolder ? getSecurePath(dstRoot, targetFolder) : dstRoot;
    if (!destDir) return res.status(400).json({ error: 'Invalid target folder' });

    let destAbs = path.join(destDir, baseName);

    // Auto-rename if target exists: file.txt → file (copy).txt, folder → folder (copy)
    try {
      await fs.stat(destAbs);
      // exists — generate unique name
      if (srcStat.isFile()) {
        const ext = path.extname(baseName);
        const stem = path.basename(baseName, ext);
        let i = 1;
        do {
          destAbs = path.join(destDir, `${stem} (copy${i > 1 ? ' ' + i : ''})${ext}`);
          i++;
        } while (await fs.stat(destAbs).then(() => true, () => false));
      } else {
        let i = 1;
        do {
          destAbs = path.join(destDir, `${baseName} (copy${i > 1 ? ' ' + i : ''})`);
          i++;
        } while (await fs.stat(destAbs).then(() => true, () => false));
      }
    } catch { /* does not exist — good */ }

    await copyRecursive(srcAbs, destAbs);

    const relDest = path.relative(dstRoot, destAbs);
    res.json({ success: true, destination: relDest });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Source not found' });
    next(e);
  }
});

// Middleware na konec
router.use(notFound);
router.use(errorHandler);

export default router;
