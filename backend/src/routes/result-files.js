// backend/src/routes/result-files.js
// Správa souborů ve složce výsledků - využívá zobecněný file-manager
import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { getSecurePath, listFiles, createUploadMiddleware, getDefaultDepth } from '../utils/file-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolutní cesta k results/ složce
const RESULTS_ROOT = path.resolve(__dirname, '../../results');

const router = Router({ mergeParams: true });
const publicRouter = Router({ mergeParams: true });

/**
 * Seznam povolených přípon pro results (rozšířený)
 */
const ALLOWED_EXTENSIONS = [
  '.doc', '.docx', '.xls', '.xlsx', '.js', '.cjs', '.py', '.txt', '.md', 
  '.json', '.workflow', '.sql', '.sh', '.css', '.html', '.xml', '.yaml', '.yml', 
  '.env', '.log', '.err', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'
];

/**
 * Získá root path pro daný result ID
 * @param {string|number} resultId 
 * @returns {Promise<string|null>}
 */
async function getResultPath(resultId) {
  const id = Number(resultId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  
  // Ověř že result existuje v DB
  const rows = await query('SELECT id FROM result WHERE id = ?', [id]);
  if (rows.length === 0) {
    return null;
  }
  
  return path.join(RESULTS_ROOT, id.toString());
}

/**
 * Middleware pro validaci result ID
 */
async function validateResultId(req, res, next) {
  const resultPath = await getResultPath(req.params.id);
  if (!resultPath) {
    return res.status(404).json({ error: 'Result not found' });
  }
  req.resultPath = resultPath;
  next();
}

/**
 * GET /api/v1/results/:id/files
 * Seznam souborů ve složce výsledku
 * Query: ?subdir=img (volitelné - omezí na podadresář)
 */
router.get('/', validateResultId, async (req, res, next) => {
  try {
    const { subdir } = req.query;
    
    // Validuj cestu
    const targetPath = getSecurePath(req.resultPath, subdir || '');
    if (!targetPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Ověř že cesta existuje a je to složka
    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Složka neexistuje - vrať prázdný seznam
        return res.json({
          root: subdir || '',
          items: [],
          count: 0
        });
      }
      throw err;
    }
    
    // Vypíš obsah
    const files = await listFiles(targetPath, subdir || '', getDefaultDepth(), 0, { 
      allowedExtensions: ALLOWED_EXTENSIONS 
    });
    
    res.json({
      root: subdir || '',
      items: files,
      count: files.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/results/:id/files/content
 * Obsah textového souboru
 * Query: ?file=data.json (povinné)
 */
router.get('/content', validateResultId, async (req, res, next) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(req.resultPath, file);
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
 * PUT /api/v1/results/:id/files/content
 * Uložení obsahu textového souboru
 * Body: { file: string, content: string }
 */
router.put('/content', validateResultId, async (req, res, next) => {
  try {
    const { file, content } = req.body;
    
    if (!file || content === undefined) {
      return res.status(400).json({ error: 'Missing file or content parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(req.resultPath, file);
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
 * GET /api/v1/results/:id/files/download (auth required)
 * PUBLIC GET /api/v1/results/:id/files/download (public router)
 * Stažení souboru
 * Query: ?file=data.json (povinné)
 */
const downloadHandler = async (req, res, next) => {
  try {
    const resultPath = await getResultPath(req.params.id);
    if (!resultPath) {
      return res.status(404).json({ error: 'Result not found' });
    }
    
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(resultPath, file);
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
};

router.get('/download', downloadHandler);
publicRouter.get('/download', downloadHandler);

/**
 * POST /api/v1/results/:id/files/upload
 * Nahrání souboru
 * Form data: file, targetPath (volitelné - podadresář)
 */
router.post('/upload', validateResultId, async (req, res, next) => {
  try {
    // Vytvoř složku pro result pokud neexistuje
    await fs.mkdir(req.resultPath, { recursive: true });
    
    // Vytvoř upload middleware pro tento result
    const upload = createUploadMiddleware(req.resultPath, 50 * 1024 * 1024);
    
    // Použij middleware
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
 * DELETE /api/v1/results/:id/files
 * Smazání souboru
 * Query: ?file=data.json (povinné)
 */
router.delete('/', validateResultId, async (req, res, next) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }
    
    // Validuj cestu
    const filePath = getSecurePath(req.resultPath, file);
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
