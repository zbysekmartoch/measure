import { Router } from 'express';
import { query } from '../db.js';
import { promises as fs } from 'fs';
import fsRaw from "fs";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import archiver from 'archiver';

// Získáme absolutní cestu k backend složce
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '../..');

const router = Router();

/**
 * GET /api/v1/results-public/:id/files/:filename
 * Veřejné stažení DOCX nebo XLSX souboru z výsledku (bez autentifikace)
 * Pro použití jako direct link v prohlížeči
 */
router.get('/:id/files/:filename', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const filename = req.params.filename;
    
    // Bezpečnostní kontrola - žádný path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Kontrola přípony - pouze DOCX a XLSX nebo ZIP
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.docx' && ext !== '.xlsx' && ext !== '.zip') {
      return res.status(400).json({ error: 'Only DOCX, XLSX and ZIP files are allowed' });
    }

    // Ověř, že výsledek existuje
    const rows = await query(
      `SELECT id FROM result WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Result not found' });
    }

    const filePath = path.join(BACKEND_DIR, 'results', id.toString(), filename);
    
    if (ext === '.zip') {
      // Zpracování ZIP souboru - pokud neexistuje, vytvoříme ZIP na požádání
        try {
            await fs.access(filePath);
        } catch {
          const resultDir = path.join(BACKEND_DIR, 'results', id.toString());
            // Vytvoříme ZIP archiv všech souborů v adresáři výsledku            
          
          const output = fsRaw.createWriteStream(filePath);
          const archive = archiver('zip', {
            zlib: { level: 9 }
          });

          output.on('close', () => {
            console.log(`Created ZIP archive ${filename} (${archive.pointer()} total bytes)`);
          });

          archive.on('error', (err) => {
            throw err;
          });

          archive.pipe(output);
         // archive.directory(resultDir, false);
          archive.glob("**/*", {
            cwd: resultDir,
            dot: true,
            ignore: [filename, `**/${filename}`],
            });
          await archive.finalize();
        }       
    }

    // Zkontroluj, že soubor existuje
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    // Zjisti velikost souboru
    const stats = await fs.stat(filePath);

    // Nastav správný Content-Type
    const contentType = ext === '.docx' 
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Nastav hlavičky pro download
    // RFC 5987: filename* pro non-ASCII znaky (ž, á, é, atd.)
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);

    // Streamuj soubor
    const fileStream = (await import('fs')).createReadStream(filePath);
    fileStream.pipe(res);

  } catch (e) {
    next(e);
  }
});

export default router;
