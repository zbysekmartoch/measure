// src/utils/file-manager.js
// Zobecněný modul pro správu souborů - listing, čtení, zápis, upload, download, mazání

import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Načti konfiguraci z config.json
let fileManagerConfig = { defaultDepth: 4 };
try {
  const configPath = path.resolve(__dirname, '../../config.json');
  const configData = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (configData.fileManager) {
    fileManagerConfig = { ...fileManagerConfig, ...configData.fileManager };
  }
} catch {
  console.warn('Could not load config.json for file-manager, using defaults');
}

/**
 * Vrátí výchozí hloubku pro listování souborů
 * @returns {number}
 */
export function getDefaultDepth() {
  return fileManagerConfig.defaultDepth;
}

/**
 * Seznam povolených přípon pro zobrazení
 */
const ALLOWED_EXTENSIONS = [
  '.doc', '.docx', '.xls', '.xlsx', '.js', '.cjs', '.py', '.txt', '.md', 
  '.json', '.workflow', '.sql', '.sh', '.css', '.html', '.xml', '.yaml', '.yml', '.env'
];

/**
 * Přípony které jsou čitelné jako text
 */
const TEXT_EXTENSIONS = [
  '.js', '.cjs', '.py', '.txt', '.md', '.json', '.workflow', '.sql', 
  '.sh', '.css', '.html', '.xml', '.yaml', '.yml', '.env'
];

/**
 * Bezpečná validace cesty - zamezí path traversal
 * @param {string} rootPath - Kořenová složka (absolutní cesta)
 * @param {string} relativePath - Relativní cesta od rootPath
 * @returns {string|null} - Absolutní validní cesta nebo null
 */
export function getSecurePath(rootPath, relativePath) {
  if (!relativePath) return rootPath;
  
  // Normalizuj cestu (odstraň .., ./, redundantní /)
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  
  // Vytvoř absolutní cestu
  const absolute = path.resolve(rootPath, normalized);
  
  // Ověř že výsledná cesta je pod rootPath
  if (!absolute.startsWith(rootPath)) {
    return null;
  }
  
  return absolute;
}

/**
 * Rekurzivní výpis souborů a složek
 * @param {string} dirPath - Absolutní cesta k adresáři
 * @param {string} relativeTo - Relativní prefix pro výstup
 * @param {number} maxDepth - Maximální hloubka rekurze
 * @param {number} currentDepth - Aktuální hloubka
 * @param {Object} options - Další možnosti
 * @param {string[]} options.allowedExtensions - Povolené přípony (default: ALLOWED_EXTENSIONS)
 * @returns {Array} - Seznam souborů a složek
 */
export async function listFiles(dirPath, relativeTo = '', maxDepth = null, currentDepth = 0, options = {}) {
  // Použij konfigurovanou hloubku pokud není specifikována
  if (maxDepth === null) {
    maxDepth = fileManagerConfig.defaultDepth;
  }
  const items = [];
  const allowedExts = options.allowedExtensions || ALLOWED_EXTENSIONS;
  
  if (currentDepth >= maxDepth) return items;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        if (fileManagerConfig.hiddenFilePrefixes?.some(prefix => entry.name.startsWith(prefix))) {
          continue; // Skip hidden files/folders
        }
  
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(relativeTo, entry.name);
      
      try {
        const stats = await fs.stat(fullPath);
        
        if (entry.isDirectory()) {
          // Přidej složku
          items.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            size: 0,
            mtime: stats.mtime.toISOString(),
            children: currentDepth < maxDepth - 1 
              ? await listFiles(fullPath, relativePath, maxDepth, currentDepth + 1, options)
              : []
          });
        } else if (entry.isFile()) {
          // Přidej soubor
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowedExts.includes(ext)) continue; // Filtr přípon
          items.push({
            name: entry.name,
            path: relativePath,
            type: 'file',
            extension: ext,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            isText: TEXT_EXTENSIONS.includes(ext)
          });
        }
      } catch (err) {
        console.warn(`Skipping ${relativePath}: ${err.message}`);
      }
    }
  } catch (err) {
    throw new Error(`Cannot read directory: ${err.message}`);
  }
  
  return items;
}

/**
 * Vytvoří multer upload middleware pro daný root
 * @param {string} rootPath - Kořenová složka pro upload
 * @param {number} maxFileSize - Max velikost souboru v bytech (default 50MB)
 * @returns {multer.Multer}
 */
export function createUploadMiddleware(rootPath, maxFileSize = 50 * 1024 * 1024) {
  return multer({
    storage: multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const targetPath = req.body.targetPath || '';
          const dirPath = getSecurePath(rootPath, targetPath);
          
          if (!dirPath) {
            return cb(new Error('Invalid target path'));
          }
          
          // Vytvoř složku pokud neexistuje
          await fs.mkdir(dirPath, { recursive: true });
          
          cb(null, dirPath);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => {
        // Použij původní název souboru
        cb(null, file.originalname);
      }
    }),
    limits: {
      fileSize: maxFileSize
    }
  });
}

/**
 * Factory pro vytvoření routeru pro správu souborů
 * @param {Object} config
 * @param {string} config.rootPath - Absolutní cesta ke kořenové složce
 * @param {Function} config.getRootPath - Funkce pro dynamické určení root path z requestu (pro results)
 * @param {string[]} config.allowedExtensions - Povolené přípony (volitelné)
 * @param {number} config.maxDepth - Max hloubka pro listing (default: 2)
 * @param {number} config.maxFileSize - Max velikost souboru pro upload (default: 50MB)
 * @param {boolean} config.createPublicRouter - Vytvořit i public router pro download (default: false)
 */
export function createFileManagerRoutes(config) {
  const { Router } = require('express').default || require('express');
  
  const router = Router({ mergeParams: true }); // mergeParams pro přístup k :id z parent routeru
  const publicRouter = config.createPublicRouter ? Router({ mergeParams: true }) : null;
  
  const maxDepth = config.maxDepth || 2;
  const allowedExtensions = config.allowedExtensions || ALLOWED_EXTENSIONS;
  const maxFileSize = config.maxFileSize || 50 * 1024 * 1024;
  
  /**
   * Získá root path - buď statický nebo dynamický
   */
  async function getRootPath(req) {
    if (config.getRootPath) {
      return await config.getRootPath(req);
    }
    return config.rootPath;
  }
  
  /**
   * GET / - Seznam souborů
   * Query: ?subdir=... (volitelné)
   */
  router.get('/', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { subdir } = req.query;
      
      // Validuj cestu
      const targetPath = getSecurePath(rootPath, subdir || '');
      if (!targetPath) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      
      // Ověř že cesta existuje a je to složka
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
      
      // Vypíš obsah
      const files = await listFiles(targetPath, subdir || '', maxDepth, 0, { allowedExtensions });
      
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
   * GET /content - Obsah souboru
   * Query: ?file=... (povinné)
   */
  router.get('/content', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { file } = req.query;
      
      if (!file) {
        return res.status(400).json({ error: 'Missing file parameter' });
      }
      
      // Validuj cestu
      const filePath = getSecurePath(rootPath, file);
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
   * PUT /content - Uložení obsahu souboru
   * Body: { file: string, content: string }
   */
  router.put('/content', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { file, content } = req.body;
      
      if (!file || content === undefined) {
        return res.status(400).json({ error: 'Missing file or content parameter' });
      }
      
      // Validuj cestu
      const filePath = getSecurePath(rootPath, file);
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
   * GET /download - Stažení souboru
   * Query: ?file=... (povinné)
   */
  const downloadHandler = async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { file } = req.query;
      
      if (!file) {
        return res.status(400).json({ error: 'Missing file parameter' });
      }
      
      // Validuj cestu
      const filePath = getSecurePath(rootPath, file);
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
  if (publicRouter) {
    publicRouter.get('/download', downloadHandler);
  }
  
  /**
   * POST /upload - Nahrání souboru
   * Form data: file, targetPath (volitelné)
   */
  // Dynamický upload middleware - musíme jej vytvořit per-request
  router.post('/upload', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      // Vytvoř upload middleware pro tento root
      const upload = createUploadMiddleware(rootPath, maxFileSize);
      
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
   * DELETE / - Smazání souboru
   * Query: ?file=... (povinné)
   */
  router.delete('/', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { file } = req.query;
      
      if (!file) {
        return res.status(400).json({ error: 'Missing file parameter' });
      }
      
      // Validuj cestu
      const filePath = getSecurePath(rootPath, file);
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
  
  return { router, publicRouter };
}
