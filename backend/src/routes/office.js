import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSecurePath } from '../utils/file-manager.js';
import {
  closeOfficeSession,
  markOfficeSessionOpened,
  markOfficeSessionSaved,
  ensureOfficeConfigured,
  verifyOfficeAccessToken,
  decodeOfficeCallbackPayload,
} from '../utils/office.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LABS_ROOT = path.resolve(__dirname, '../../labs');

const router = Router();

function getLabPath(id) {
  return path.join(LABS_ROOT, String(id));
}

function getAreaRoot(area, labId, resultId) {
  if (area === 'scripts') return path.join(getLabPath(labId), 'scripts');
  if (area === 'results') return path.join(getLabPath(labId), 'results', String(resultId || ''));
  if (area === 'current_output') return path.join(getLabPath(labId), 'scripts', 'Outputs');
  return null;
}

function resolveOfficeFileFromClaims(claims) {
  const { area, labId, resultId, filePath } = claims || {};
  if (!area || !labId || !filePath) {
    const err = new Error('Invalid office token payload');
    err.statusCode = 400;
    throw err;
  }

  const root = getAreaRoot(area, labId, resultId);
  if (!root) {
    const err = new Error('Invalid office file area');
    err.statusCode = 400;
    throw err;
  }

  const absolutePath = getSecurePath(root, filePath);
  if (!absolutePath) {
    const err = new Error('Invalid office file path');
    err.statusCode = 400;
    throw err;
  }

  return absolutePath;
}

// Document Server fetches document bytes from this endpoint.
router.get('/file', async (req, res) => {
  try {
    ensureOfficeConfigured();

    const token = req.query?.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const claims = verifyOfficeAccessToken(token);
    if (claims?.type !== 'office-access' || claims?.action !== 'file') {
      return res.status(403).json({ error: 'Invalid office token action' });
    }

    const absolutePath = resolveOfficeFileFromClaims(claims);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(absolutePath);
  } catch (e) {
    const statusCode = e.statusCode || (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' ? 401 : 500);
    return res.status(statusCode).json({ error: e.message || 'Office file fetch failed' });
  }
});

// Document Server posts save callbacks here.
router.post('/callback', async (req, res) => {
  try {
    ensureOfficeConfigured();

    const token = req.query?.token;
    if (!token) return res.json({ error: 1 });

    const claims = verifyOfficeAccessToken(token);
    if (claims?.type !== 'office-access' || claims?.action !== 'callback') {
      return res.json({ error: 1 });
    }

    const callback = decodeOfficeCallbackPayload(req.body);
    const status = Number(callback?.status);
    const fileUrl = callback?.url;
    const key = callback?.key;

    const scope = {
      area: claims.area,
      labId: claims.labId,
      resultId: claims.resultId,
      filePath: claims.filePath,
      key,
    };

    // status 1 = editor opened (start periodic force-save timer)
    if (status === 1 && key) {
      markOfficeSessionOpened(scope);
    }

    // status 2 = final save, status 6 = force-save (Ctrl+S)
    if ((status === 2 || status === 6) && fileUrl) {
      const absolutePath = resolveOfficeFileFromClaims(claims);
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Callback file fetch failed with HTTP ${response.status}`);
      }
      const payload = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(absolutePath, payload);
      markOfficeSessionSaved({ ...scope, status });
    }

    // status 2 = closed with save, status 4 = closed without save
    if (status === 2 || status === 4) {
      closeOfficeSession({ ...scope, reason: status === 2 ? 'closed_with_save' : 'closed_without_save' });
    }

    // DS requires this exact contract.
    return res.json({ error: 0 });
  } catch (e) {
    console.error('[office callback] save failed:', e.message);
    return res.json({ error: 1 });
  }
});

export default router;
