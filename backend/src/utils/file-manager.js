// src/utils/file-manager.js
// Generic file management module - listing, reading, writing, upload, download, deletion

import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration from config.json
let fileManagerConfig = { defaultDepth: Infinity };
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
 * Returns default depth for file listing
 * @returns {number}
 */
export function getDefaultDepth() {
  return fileManagerConfig.defaultDepth;
}

/**
 * Copy a file or directory recursively from src to dest.
 * Creates parent directories as needed.
 * @param {string} src - Absolute source path
 * @param {string} dest - Absolute destination path
 */
export async function copyRecursive(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

/**
 * List of allowed extensions for viewing
 */
const ALLOWED_EXTENSIONS = [
  '.doc', '.docx', '.xls', '.xlsx', '.js', '.cjs', '.py', '.txt', '.md', 
  '.json', '.workflow', '.sql', '.sh', '.css', '.html', '.xml', '.yaml', '.yml', '.env',
  '.log', '.err', '.csv', '.r',
];

/**
 * Extensions readable as text
 */
const TEXT_EXTENSIONS = [
  '.js', '.cjs', '.py', '.txt', '.md', '.json', '.workflow', '.sql', 
  '.sh', '.css', '.html', '.xml', '.yaml', '.yml', '.env',
  '.log', '.err', '.csv', '.r',
];

/**
 * Secure path validation - prevents path traversal
 * @param {string} rootPath - Root folder (absolute path)
 * @param {string} relativePath - Relative path from rootPath
 * @returns {string|null} - Valid absolute path or null
 */
export function getSecurePath(rootPath, relativePath) {
  if (!relativePath) return rootPath;
  
  // Normalize path (remove .., ./, redundant /)
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  
  // Create absolute path
  const absolute = path.resolve(rootPath, normalized);
  
  // Verify the resulting path is under rootPath
  if (!absolute.startsWith(rootPath)) {
    return null;
  }
  
  return absolute;
}

/**
 * Recursive file and directory listing
 * @param {string} dirPath - Absolute path to directory
 * @param {string} relativeTo - Relative prefix for output
 * @param {number} maxDepth - Maximum recursion depth
 * @param {number} currentDepth - Current depth
 * @param {Object} options - Additional options
 * @param {string[]} options.allowedExtensions - Allowed extensions (default: ALLOWED_EXTENSIONS)
 * @returns {Array} - List of files and directories
 */
export async function listFiles(dirPath, relativeTo = '', maxDepth = null, currentDepth = 0, options = {}) {
  // Use configured depth if not specified (0 = unlimited)
  if (maxDepth === null || maxDepth === undefined) {
    maxDepth = fileManagerConfig.defaultDepth;
  }
  if (maxDepth === 0) maxDepth = Infinity;
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
          // Add directory
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
          // Add file (all extensions allowed)
          const ext = path.extname(entry.name).toLowerCase();
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
 * Creates multer upload middleware for the given root
 * @param {string} rootPath - Root folder for upload
 * @param {number} maxFileSize - Max file size in bytes (default 50MB)
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
          
          // Create directory if it doesn't exist
          await fs.mkdir(dirPath, { recursive: true });
          
          cb(null, dirPath);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => {
        // Use original file name
        cb(null, file.originalname);
      }
    }),
    limits: {
      fileSize: maxFileSize
    }
  });
}

/**
 * Factory for creating file management router
 * @param {Object} config
 * @param {string} config.rootPath - Absolute path to root folder
 * @param {Function} config.getRootPath - Function for dynamically determining root path from request (for results)
 * @param {string[]} config.allowedExtensions - Allowed extensions (optional)
 * @param {number} config.maxDepth - Max depth for listing (default: 2)
 * @param {number} config.maxFileSize - Max file size for upload (default: 50MB)
 * @param {boolean} config.createPublicRouter - Also create public router for download (default: false)
 */
export function createFileManagerRoutes(config) {
  const { Router } = require('express').default || require('express');
  
  const router = Router({ mergeParams: true }); // mergeParams for accessing :id from parent router
  const publicRouter = config.createPublicRouter ? Router({ mergeParams: true }) : null;
  
  const maxDepth = config.maxDepth || 2;
  const allowedExtensions = config.allowedExtensions || ALLOWED_EXTENSIONS;
  const maxFileSize = config.maxFileSize || 50 * 1024 * 1024;
  
  /**
   * Get root path - either static or dynamic
   */
  async function getRootPath(req) {
    if (config.getRootPath) {
      return await config.getRootPath(req);
    }
    return config.rootPath;
  }
  
  /**
   * GET / - List files
   * Query: ?subdir=... (optional)
   */
  router.get('/', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      const { subdir } = req.query;
      
      // Validate path
      const targetPath = getSecurePath(rootPath, subdir || '');
      if (!targetPath) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      
      // Verify the path exists and is a directory
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
      
      // List contents
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
   * GET /content - File content
   * Query: ?file=... (required)
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
      
      // Validate path
      const filePath = getSecurePath(rootPath, file);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid file path' });
      }
      
      // Verify the file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }
      
      // Read content (UTF-8)
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
   * PUT /content - Save file content
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
      
      // Validate path
      const filePath = getSecurePath(rootPath, file);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid file path' });
      }
      
      // Verify the file exists (only update existing files)
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
      
      // Save content (UTF-8)
      await fs.writeFile(filePath, content, 'utf-8');
      
      // Return new stats
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
   * GET /download - Download file
   * Query: ?file=... (required)
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
      
      // Validate path
      const filePath = getSecurePath(rootPath, file);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid file path' });
      }
      
      // Verify the file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }
      
      // Send file
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
   * POST /upload - Upload file
   * Form data: file, targetPath (optional)
   */
  // Dynamic upload middleware - must be created per-request
  router.post('/upload', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }
      
      // Create upload middleware for this root
      const upload = createUploadMiddleware(rootPath, maxFileSize);
      
      // Use middleware
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
   * POST /folder - Create new folder
   * Body: { path: string }
   */
  router.post('/folder', async (req, res, next) => {
    try {
      const rootPath = await getRootPath(req);
      if (!rootPath) {
        return res.status(404).json({ error: 'Root path not found' });
      }

      const { path: folderPath } = req.body;
      if (!folderPath?.trim()) {
        return res.status(400).json({ error: 'Missing path parameter' });
      }

      const dirPath = getSecurePath(rootPath, folderPath.trim());
      if (!dirPath) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      await fs.mkdir(dirPath, { recursive: true });

      res.status(201).json({ success: true, path: folderPath.trim() });
    } catch (err) {
      next(err);
    }
  });
  
  /**
   * DELETE / - Delete file
   * Query: ?file=... (required)
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
      
      // Validate path
      const filePath = getSecurePath(rootPath, file);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid file path' });
      }
      
      // Verify the file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }
      
      // Delete file
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
