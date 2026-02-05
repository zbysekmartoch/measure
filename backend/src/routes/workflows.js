import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = Router();

// Získáme absolutní cestu k scripts složce
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPTS_DIR = path.join(__dirname, '../../scripts');

/**
 * Validace názvu workflow - pouze bezpečné znaky
 */
function isValidWorkflowName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * GET /api/v1/workflows
 * Vrátí seznam všech dostupných workflows
 */
router.get('/', async (req, res, next) => {
  try {
    // Načteme všechny soubory ze scripts složky
    const files = await fs.readdir(SCRIPTS_DIR);
    
    // Vyfiltrujeme pouze .workflow soubory a odstraníme příponu
    const workflows = files
      .filter(file => file.endsWith('.workflow'))
      .map(file => file.replace('.workflow', ''));
    
    res.json({ items: workflows });
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Složka workflows neexistuje
      return res.json({ items: [] });
    }
    next(e);
  }
});

/**
 * GET /api/v1/workflows/:name
 * Vrátí obsah konkrétního workflow
 */
router.get('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    
    // Validace názvu workflow
    if (!isValidWorkflowName(name)) {
      return res.status(400).json({ 
        error: 'Invalid workflow name. Only alphanumeric characters, dashes and underscores are allowed.' 
      });
    }
    
    // Sestavíme cestu k souboru
    const workflowPath = path.join(SCRIPTS_DIR, `${name}.workflow`);
    
    // Zajistíme, že cesta je stále v rámci scripts složky (ochrana proti path traversal)
    const resolvedPath = path.resolve(workflowPath);
    const resolvedScriptsDir = path.resolve(SCRIPTS_DIR);
    if (!resolvedPath.startsWith(resolvedScriptsDir)) {
      return res.status(400).json({ error: 'Invalid workflow path' });
    }
    
    // Načteme obsah souboru
    const content = await fs.readFile(workflowPath, 'utf-8');
    
    res.json({ 
      name,
      content: content.trim()
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    next(e);
  }
});

export default router;
