// backend/src/routes/scripts.js
// Správa souborů ve složce scripts - využívá zobecněný file-manager
import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSecurePath, listFiles, createUploadMiddleware, getDefaultDepth } from '../utils/file-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolutní cesta k scripts/ složce
const SCRIPTS_ROOT = path.resolve(__dirname, '../../scripts');

const router = Router();
const publicRouter = Router(); // Router for public endpoints without auth

/**
 * GET /api/v1/scripts
 * Vypíše soubory ve složce scripts/ a podadresářích
 * Query: ?subdir=analyzy (volitelné - omezí na podadresář)
 */
router.get('/', async (req, res, next) => {
  try {
    const { subdir } = req.query;
    
    // Validuj cestu
    const targetPath = getSecurePath(SCRIPTS_ROOT, subdir || '');
    if (!targetPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Ověř že cesta existuje a je to složka
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    // Vypíš obsah
    const files = await listFiles(targetPath, subdir || '', getDefaultDepth());
    
    res.json({
      root: subdir || '',
      items: files,
      count: files.length
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Directory not found' });
    }
    next(err);
  }
});

/**
 * GET /api/v1/scripts/download
 * Download specific file (PUBLIC - no auth required for direct links)
 * Query: ?file=analyzy/script.py (required)
 */
publicRouter.get('/download', async (req, res, next) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(SCRIPTS_ROOT, file);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Ověř že soubor existuje
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }
    
    // Odešli soubor
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    next(err);
  }
});

/**
 * GET /api/v1/scripts/content
 * Načte obsah textového souboru
 * Query: ?file=analyzy/script.py (povinné)
 */
router.get('/content', async (req, res, next) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(SCRIPTS_ROOT, file);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Ověř že soubor existuje
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }
    
    // Načti obsah (UTF-8)
    const content = await fs.readFile(filePath, 'utf-8');
    
    res.json({
      file: file,
      content: content,
      size: stats.size,
      mtime: stats.mtime.toISOString()
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    next(err);
  }
});

/**
 * PUT /api/v1/scripts/content
 * Uloží změny obsahu textového souboru
 * Body: { file: string, content: string }
 */
router.put('/content', async (req, res, next) => {
  try {
    const { file, content } = req.body;
    
    if (!file || content === undefined) {
      return res.status(400).json({ error: 'Missing file or content parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(SCRIPTS_ROOT, file);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Ověř že soubor existuje (jen update existujících)
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found. Use upload to create new files.' });
      }
      throw err;
    }
    
    // Ulož obsah (UTF-8)
    await fs.writeFile(filePath, content, 'utf-8');
    
    // Vrať nové stats
    const stats = await fs.stat(filePath);
    
    res.json({
      success: true,
      file: file,
      size: stats.size,
      mtime: stats.mtime.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/scripts/upload
 * Nahraje nový soubor nebo přepíše existující
 * Form data: 
 *   - file: soubor (multipart)
 *   - targetPath: relativní cesta k cílovému adresáři (např. "analyzy")
 */
router.post('/upload', async (req, res, next) => {
  try {
    // Vytvoř upload middleware pro scripts root
    const upload = createUploadMiddleware(SCRIPTS_ROOT, 50 * 1024 * 1024);
    
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return next(err);
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const relativePath = path.join(req.body.targetPath || '', req.file.filename);
      const stats = await fs.stat(req.file.path);
      
      res.status(201).json({
        success: true,
        file: {
          name: req.file.filename,
          path: relativePath,
          size: stats.size,
          mtime: stats.mtime.toISOString()
        }
      });
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/scripts
 * Smaže soubor
 * Query: ?file=analyzy/script.py (povinné)
 */
router.delete('/', async (req, res, next) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(SCRIPTS_ROOT, file);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Ověř že soubor existuje
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }
    
    // Smaž soubor
    await fs.unlink(filePath);
    
    res.json({
      success: true,
      file: file
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    next(err);
  }
});

export default router;
export { publicRouter };
