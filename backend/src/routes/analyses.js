// backend/src/routes/analyses.js

import { Router } from 'express';
import { query } from '../db.js';

import { promises as fs } from 'fs';
import path from 'path';

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import process from 'process';

// Získáme absolutní cestu k backend složce (2 úrovně nad current file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '../..');

// Načteme konfiguraci
const configPath = path.join(BACKEND_DIR, 'config.json');
let config;
try {
  const configData = await fs.readFile(configPath, 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('Failed to load config.json, using defaults:', error.message);
  // Fallback konfigurace
  config = {
    paths: {
      scripts: "scripts",
      results: "results"
    },
    scriptCommands: {
      ".py": { command: "python", description: "Python scripts" },
      ".js": { command: "node", description: "Node.js scripts" },
      ".r": { command: "Rscript", description: "R scripts" },
      ".R": { command: "Rscript", description: "R scripts" },
      ".sh": { command: "bash", description: "Shell scripts" }
    },
    logging: {
      logFileName: "analysis.log",
      errorFileName: "analysis.err",
      timestampFormat: "ISO",
      separatorChar: "=",
      separatorLength: 80
    }
  };
}

// Zámek pro atomické provádění workflow sekvencí
// Zajišťuje, že pouze jedna analýza běží najednou, ostatní čekají ve frontě
let workflowLockPromise = Promise.resolve();

/**
 * Získá zámek pro spuštění workflow.
 * Vrací funkci release, která zámek uvolní.
 */
function acquireWorkflowLock() {
  let release;
  const myTurn = workflowLockPromise;
  workflowLockPromise = new Promise(resolve => {
    release = resolve;
  });
  return { waitForLock: myTurn, release };
}

const router = Router();

function parseSettings(row) {
  if (!row) return row;
  const out = { ...row };
  if (typeof out.settings === 'string' && out.settings.trim() !== '') {
    try { out.settings = JSON.parse(out.settings); }
    catch { out.settings = null; } // když je v DB nevalidní JSON
  }
  return out;
}

function toSettingsText(val) {
  // přijmeme objekt i string
  if (val == null) return null;
  if (typeof val === 'string') return val;      // očekáváme validní JSON string
  return JSON.stringify(val);
}

/**
 * GET /api/v1/analyses/config
 * Vrací konfiguraci analýz
 */
router.get('/config', async (req, res, next) => {
  try {
    res.json({
      supportedScriptTypes: Object.keys(config.scriptCommands).map(ext => ({
        extension: ext,
        command: config.scriptCommands[ext].command,
        description: config.scriptCommands[ext].description
      })),
      paths: config.paths,
      logging: config.logging
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/analyses
 * Volitelné: ?search=<text> (LIKE nad name)
 */
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = '';
    if (search && search.trim()) {
      where = 'WHERE name LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    const rows = await query(
      `
      SELECT id, name, created_at
      FROM analysis
      ${where}
      ORDER BY id DESC
      `,
      params
    );

    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/analyses/:id
 * Vrací detail včetně settings (parsed)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const rows = await query(
      `SELECT id, name, settings, created_at FROM analysis WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });

    res.json(parseSettings(rows[0]));
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/analyses
 * Body: { name: string, settings?: object|string|null }
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, settings } = req.body ?? {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const settingsText = toSettingsText(settings);

    const r = await query(
      `INSERT INTO analysis (name, settings) VALUES (?, ?)`,
      [String(name).trim(), settingsText]
    );

    // vraťme rovnou detail (s parsed settings)
    res.status(201).json({
      id: r.insertId,
      name: String(name).trim(),
      settings: typeof settings === 'string' ? JSON.parse(settings) : (settings ?? null),
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
  } catch (e) {
    // když by settings byl nevalidní JSON string
    if (e instanceof SyntaxError) {
      return res.status(400).json({ error: 'settings must be valid JSON' });
    }
    next(e);
  }
});

/**
 * PUT /api/v1/analyses/:id
 * Body: { name?: string, settings?: object|string|null }
 * Aktualizuje pouze poslané položky.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const { name, settings } = req.body ?? {};

    const sets = [];
    const params = [];

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
      sets.push('name = ?');
      params.push(String(name).trim());
    }
    if (settings !== undefined) {
      // povolíme null (vyprázdnění settings)
      const settingsText = toSettingsText(settings);
      // validuj, pokud byl string
      if (typeof settings === 'string') {
        try { JSON.parse(settings); } catch { return res.status(400).json({ error: 'settings must be valid JSON' }); }
      }
      sets.push('settings = ?');
      params.push(settingsText);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });

    params.push(id);
    const r = await query(
      `UPDATE analysis SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

    // vraťme aktuální stav
    const rows = await query(
      `SELECT id, name, settings, created_at FROM analysis WHERE id = ?`,
      [id]
    );
    res.json(parseSettings(rows[0]));
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/v1/analyses/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const r = await query(`DELETE FROM analysis WHERE id = ?`, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});


/**
 * POST /api/v1/analyses/:id/run
 * Spustí analýzu
 */
router.post('/:id/run', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    // Nejdřív ověříme že analýza existuje
    const rows = await query(
      'SELECT id, name, settings FROM analysis WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Analysis not found' });

    let settingsStr=rows[0].settings;
    let analysisId=rows[0].id;
    let settings = null;

    if (typeof settingsStr === 'string' && settingsStr.trim() !== '') {
      try { 
        settings = JSON.parse(settingsStr); 
        runAnalysis(analysisId,settings);

      }
      catch { settings = null; } // když je v DB nevalidní JSON
    }
    // Můžeme zde případně upravit settings před spuštěním, např. přidat timestamp
    // settings.run_at = new Date().toISOString();


    res.status(201).json({
     // id: result.insertId,
      analysis_id: id,
      status: 'pending',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
  } catch (e) {
    next(e);
  }
});


/**
 * Načte kroky workflow ze settings.workflow
 * - Pokud je pole, použije ho přímo
 * - Pokud je víceřádkový string, rozdělí na řádky
 * - Pokud je jednořádkový string, načte soubor scripts/{workflow}.workflow
 * @param {string|string[]} workflow - Hodnota settings.workflow
 * @returns {Promise<string[]>} - Pole kroků (včetně zakomentovaných, odfiltrované pouze prázdné)
 */
async function resolveWorkflowSteps(workflow) {
  if (!workflow) return [];
  
  let steps;
  
  if (Array.isArray(workflow)) {
    // Pole - použít přímo
    steps = workflow.map(s => String(s).trim());
  } else {
    const workflowStr = String(workflow).trim();
    
    // Zkontrolovat, zda je to víceřádkový string nebo jednořádkový (název souboru)
    if (workflowStr.includes('\n')) {
      // Víceřádkový string - rozdělit na řádky
      steps = workflowStr.split('\n').map(s => s.trim());
    } else if (workflowStr) {
      // Jednořádkový string - název .workflow souboru
      const workflowFilePath = path.join(BACKEND_DIR, config.paths.scripts, `${workflowStr}.workflow`);
      try {
        const workflowContent = await fs.readFile(workflowFilePath, 'utf-8');
        steps = workflowContent.split('\n').map(s => s.trim());
      } catch (err) {
        console.error(`Failed to load workflow file ${workflowFilePath}:`, err.message);
        // Zkusit jako přímý krok (zpětná kompatibilita)
        steps = [workflowStr];
      }
    } else {
      steps = [];
    }
  }
  
  // Odfiltrovat pouze prázdné řádky (komentáře ponechat - filtrují se až před prováděním)
  return steps.filter(s => s);
}

/**
 * Společná logika pro spuštění workflow kroků
 * @param {Object} options
 * @param {number} options.resultId - ID výsledku
 * @param {string[]} options.steps - Pole kroků workflow (včetně zakomentovaných)
 * @param {string} options.resultDir - Cesta ke složce s výsledky
 * @param {string} options.logFile - Cesta k log souboru
 * @param {string} options.errorFile - Cesta k error souboru
 * @param {string} options.logPrefix - Prefix pro logy (např. "[DEBUG] ")
 * @returns {Promise<boolean>} - true pokud úspěšně, false pokud selhalo
 */
async function executeWorkflowSteps({ resultId, steps, resultDir, logFile, errorFile, logPrefix = '' }) {
  // Odfiltrovat komentáře (začínající #) před prováděním
  const activeSteps = (steps || []).filter(s => !s.startsWith('#'));
  const progressFile = path.join(resultDir, 'progress.json');
  
  // Pomocná funkce pro zápis progress
  async function writeProgress(currentStep, stepName, stepStartTime, status = 'running', analysisStartTime = null) {
    const progress = {
      status,
      totalSteps: activeSteps.length,
      currentStep,
      currentStepName: stepName,
      stepStartedAt: stepStartTime,
      analysisStartedAt: analysisStartTime,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
  }
  
  // Získáme zámek - čekáme ve frontě na spuštění
  const { waitForLock, release } = acquireWorkflowLock();
  
  // Zapíšeme stav čekání před získáním zámku
  await writeProgress(0, 'Waiting for analytical engine', new Date().toISOString(), 'waiting', null);
  console.log(`${logPrefix}Waiting for analytical engine lock...`);
  
  // Čekáme na uvolnění zámku (předchozí analýza musí doběhnout)
  await waitForLock;
  
  console.log(`${logPrefix}Lock acquired, starting workflow execution`);
  
  const analysisStartTime = new Date().toISOString();
  
  try {
      if (activeSteps.length) {
      for (let i = 0; i < activeSteps.length; i++) {
        const step = activeSteps[i];
        const stepStartTime = new Date().toISOString();
        
        // Zapíšeme progress před spuštěním kroku
        await writeProgress(i + 1, step, stepStartTime, 'running', analysisStartTime);
        
        console.log(`${logPrefix}Executing step: ${step}`);
        const success = await runScript(step, resultDir, logFile, errorFile);
        
        if (!success) {
          // Zapíšeme failed progress
          await writeProgress(i + 1, step, stepStartTime, 'failed', analysisStartTime);
          
          await query(
            'UPDATE result SET status = ?, completed_at = NOW() WHERE id = ?',
            ['failed', resultId]
          );
          
          // Zapíšeme chybu do log souboru
          const failTimestamp = new Date().toISOString();
          const failSeparator = config.logging.separatorChar.repeat(config.logging.separatorLength);
          const failMsg = `\n${failSeparator}\n[${failTimestamp}] ${logPrefix}ANALYSIS FAILED at step: ${step}\n${failSeparator}\n`;
          await fs.appendFile(logFile, failMsg);
          await fs.appendFile(errorFile, failMsg);
          
          return false;
        }
      }
    }
    
    // Vše proběhlo úspěšně - zapíšeme completed progress
    const completedProgress = {
      status: 'completed',
      totalSteps: activeSteps.length,
      currentStep: activeSteps.length,
      currentStepName: activeSteps.length > 0 ? activeSteps[activeSteps.length - 1] : null,
      stepStartedAt: null,
      analysisStartedAt: analysisStartTime,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(progressFile, JSON.stringify(completedProgress, null, 2));
    
    await query(
      'UPDATE result SET status = ?, completed_at = NOW() WHERE id = ?',
      ['completed', resultId]
    );
    
    // Zapíšeme úspěch do log souboru
    const completedTimestamp = new Date().toISOString();
    const successSeparator = config.logging.separatorChar.repeat(config.logging.separatorLength);
    const successMsg = `\n${successSeparator}\n[${completedTimestamp}] ${logPrefix}ANALYSIS COMPLETED SUCCESSFULLY\nResult ID: ${resultId}\nTotal steps executed: ${activeSteps.length}\n${successSeparator}\n`;
    await fs.appendFile(logFile, successMsg);
    await fs.appendFile(errorFile, successMsg);
    
    return true;
  } finally {
    // Vždy uvolníme zámek, i když dojde k chybě
    release();
    console.log(`${logPrefix}Lock released`);
  }
}

async function runAnalysis(analysisId, settings) {
  let resultId = null;
  try {
    console.log('Running analysis with settings:', settings);
    
    // Resolvneme workflow do pole kroků (včetně zakomentovaných)
    const resolvedSteps = await resolveWorkflowSteps(settings?.workflow);
    
    // Připravíme settings s resolvnutým workflow jako pole
    const settingsForStorage = {
      ...settings,
      workflow: resolvedSteps
    };
    
    const r = await query(
      'INSERT INTO result(analysis_id, status) VALUES (?, ?)',
      [analysisId, 'pending']
    );
    resultId = r.insertId;

    // Vytvoříme složku pro výsledky
    const resultDir = path.join(BACKEND_DIR, config.paths.results, resultId.toString());
    await fs.mkdir(resultDir, { recursive: true });

    // Uložíme settings s resolvnutým workflow do data.json
    await fs.writeFile(
      path.join(resultDir, 'data.json'),
      JSON.stringify(settingsForStorage, null, 2)
    );

    // Vytvoříme log soubory
    const logFile = path.join(resultDir, config.logging.logFileName);
    const errorFile = path.join(resultDir, config.logging.errorFileName);
    
    // Inicializujeme log soubory s hlavičkou
    const startTimestamp = new Date().toISOString();
    const separator = config.logging.separatorChar.repeat(config.logging.separatorLength);
    const analysisHeader = `Analysis Execution Log - Result ID: ${resultId}\nStarted: ${startTimestamp}\nAnalysis ID: ${analysisId}\n${separator}\n\n`;
    
    await fs.writeFile(logFile, analysisHeader);
    await fs.writeFile(errorFile, analysisHeader);

    // Spustíme workflow kroky
    await executeWorkflowSteps({ resultId, steps: resolvedSteps, resultDir, logFile, errorFile });
    
  } catch (error) {
    console.error('Analysis failed:', error);
    
    // Aktualizujeme status pouze pokud máme resultId
    if (resultId) {
      await query(
        'UPDATE result SET status = ? WHERE id = ?',
        ['failed', resultId]
      );
      
      // Zapíšeme systémovou chybu do log souboru
      const errorTimestamp = new Date().toISOString();
      const errorSeparator = config.logging.separatorChar.repeat(config.logging.separatorLength);
      const errorMsg = `\n${errorSeparator}\n[${errorTimestamp}] SYSTEM ERROR: ${error.message}\nStack: ${error.stack}\n${errorSeparator}\n`;
      const resultDir = path.join(BACKEND_DIR, config.paths.results, resultId.toString());
      const logFile = path.join(resultDir, config.logging.logFileName);
      const errorFile = path.join(resultDir, config.logging.errorFileName);
      
      try {
        await fs.appendFile(logFile, errorMsg);
        await fs.appendFile(errorFile, errorMsg);
      } catch (logError) {
        console.error('Failed to write error to log files:', logError);
      }
    }
  }
}

/**
 * Spustí analýzu v debug režimu - používá existující result a jeho data.json
 * Nevytváří nový záznam v DB ani novou složku, jen aktualizuje logy
 * @param {number} resultId - ID existujícího výsledku
 */
async function runDebugAnalysis(resultId) {
  try {
    console.log('Running debug analysis for result:', resultId);
    
    // Nastavíme status na pending
    await query(
      'UPDATE result SET status = ? WHERE id = ?',
      ['pending', resultId]
    );

    // Cesta k existující složce s výsledky
    const resultDir = path.join(BACKEND_DIR, config.paths.results, resultId.toString());
    
    // Načteme settings z existujícího data.json
    const dataJsonPath = path.join(resultDir, 'data.json');
    let settings;
    try {
      const dataContent = await fs.readFile(dataJsonPath, 'utf-8');
      settings = JSON.parse(dataContent);
    } catch (err) {
      console.error('Failed to read data.json:', err);
      await query(
        'UPDATE result SET status = ?, completed_at = NOW() WHERE id = ?',
        ['failed', resultId]
      );
      return;
    }

    // Vytvoříme nové log soubory (přepíšeme staré)
    const logFile = path.join(resultDir, config.logging.logFileName);
    const errorFile = path.join(resultDir, config.logging.errorFileName);
    
    // Inicializujeme log soubory s hlavičkou (DEBUG režim)
    const startTimestamp = new Date().toISOString();
    const separator = config.logging.separatorChar.repeat(config.logging.separatorLength);
    const analysisHeader = `[DEBUG MODE] Analysis Execution Log - Result ID: ${resultId}\nStarted: ${startTimestamp}\n${separator}\n\n`;
    
    await fs.writeFile(logFile, analysisHeader);
    await fs.writeFile(errorFile, analysisHeader);

    // Spustíme workflow kroky s debug prefixem (workflow je už pole v data.json)
    await executeWorkflowSteps({ resultId, steps: settings.workflow, resultDir, logFile, errorFile, logPrefix: '[DEBUG] ' });
    
  } catch (error) {
    console.error('Debug analysis failed:', error);
    
    await query(
      'UPDATE result SET status = ? WHERE id = ?',
      ['failed', resultId]
    );
    
    // Zapíšeme systémovou chybu do log souboru
    const errorTimestamp = new Date().toISOString();
    const errorSeparator = config.logging.separatorChar.repeat(config.logging.separatorLength);
    const errorMsg = `\n${errorSeparator}\n[${errorTimestamp}] [DEBUG] SYSTEM ERROR: ${error.message}\nStack: ${error.stack}\n${errorSeparator}\n`;
    const resultDir = path.join(BACKEND_DIR, config.paths.results, resultId.toString());
    const logFile = path.join(resultDir, config.logging.logFileName);
    const errorFile = path.join(resultDir, config.logging.errorFileName);
    
    try {
      await fs.appendFile(logFile, errorMsg);
      await fs.appendFile(errorFile, errorMsg);
    } catch (logError) {
      console.error('Failed to write error to log files:', logError);
    }
  }
}

function isBareCommand(p) {
  return typeof p === "string" && !p.includes("/") && !p.includes("\\");
}

/**
 * Spustí externí skript a počká na jeho dokončení
 * @param {string} scriptPath - Relativní cesta ke skriptu od složky scripts
 * @param {string} workDir - Pracovní adresář pro skript
 * @param {string} logFile - Cesta k log souboru
 * @param {string} errorFile - Cesta k error souboru
 * @returns {Promise<boolean>} - true pokud skript uspěl, false pokud selhal
 */
async function runScript(scriptPath, workDir, logFile, errorFile) {
  const fullScriptPath = path.join(BACKEND_DIR, config.paths.scripts, scriptPath);
  const ext = path.extname(scriptPath).toLowerCase();
  
  // Zkontrolujeme, zda máme konfiguraci pro danou příponu
  const scriptConfig = config.scriptCommands[ext];
  if (!scriptConfig) {
    console.error(`Unsupported script type: ${ext}. Supported types: ${Object.keys(config.scriptCommands).join(', ')}`);
    return false;
  }

  let command;
  if (isBareCommand(scriptConfig.command)) {
    command = scriptConfig.command;
  } else {
    command = path.isAbsolute(scriptConfig.command) ? scriptConfig.command : path.resolve(BACKEND_DIR, scriptConfig.command);
  }
  const args = [fullScriptPath, workDir];
  
  const timestamp = new Date().toISOString();
  const separator = config.logging.separatorChar.repeat(config.logging.separatorLength);
  
  // Připravíme log záznamy
  const logHeader = `\n${separator}\n[${timestamp}] Starting script: ${scriptPath}\nType: ${scriptConfig.description}\nCommand: ${command} ${args.join(' ')}\n${separator}\n`;
  const errorHeader = `\n${separator}\n[${timestamp}] Starting script: ${scriptPath}\nType: ${scriptConfig.description}\nCommand: ${command} ${args.join(' ')}\n${separator}\n`;
  
  // Zapíšeme hlavičky do log souborů
  await fs.appendFile(logFile, logHeader);
  await fs.appendFile(errorFile, errorHeader);
  
  return new Promise((resolve) => {
    const childProcess = spawn(command, args, {
      cwd: workDir,
      env: {
        ...process.env,
        WORK_DIR: workDir
      }
    });

    childProcess.stdout.on('data', async (data) => {
      const output = data.toString();
      console.log(`Script output: ${output}`);
      // Zapíšeme do log souboru
      await fs.appendFile(logFile, output);
    });

    childProcess.stderr.on('data', async (data) => {
      const output = data.toString();
      console.error(`Script error: ${output}`);
      // Zapíšeme do error souboru
      await fs.appendFile(errorFile, output);
    });

    childProcess.on('error', async (error) => {
      const errorMsg = `\nFailed to start script: ${error.message}\n`;
      console.error(errorMsg);
      await fs.appendFile(errorFile, errorMsg);
      resolve(false);
    });

    childProcess.on('close', async (code) => {
      const finishTimestamp = new Date().toISOString();
      const finishSeparator = config.logging.separatorChar.repeat(config.logging.separatorLength);
      const finishMsg = `\n[${finishTimestamp}] Script finished with exit code: ${code}\n${finishSeparator}\n\n`;
      
      // Zapíšeme dokončení do obou souborů
      await fs.appendFile(logFile, finishMsg);
      await fs.appendFile(errorFile, finishMsg);
      
      resolve(code === 0);
    });
  });
}


export default router;
export { runAnalysis, runDebugAnalysis, config };
