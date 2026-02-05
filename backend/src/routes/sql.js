import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const router = Router();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASOURCES_DIR = path.resolve(__dirname, '../../datasources');

const SQLITE_EXTENSIONS = new Set(['.sqlite', '.db', '.sqlite3']);

function isSafeDataSourceId(id) {
  return id && !id.includes('..') && !path.isAbsolute(id);
}

async function listDataSources() {
  const entries = await fs.readdir(DATASOURCES_DIR, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const ext = path.extname(name).toLowerCase();
    if (SQLITE_EXTENSIONS.has(ext)) {
      items.push({ id: name, label: name, type: 'sqlite' });
      continue;
    }
    if (name.endsWith('.sqlserver.json') || name.endsWith('.mysql.json')) {
      items.push({ id: name, label: name, type: 'mysql' });
    }
  }
  return items;
}

async function resolveDataSource(id) {
  if (!id) {
    return { type: 'mysql', config: config.db, label: 'default' };
  }
  if (!isSafeDataSourceId(id)) {
    throw new Error('Invalid datasource id');
  }

  const resolved = path.resolve(DATASOURCES_DIR, id);
  if (!resolved.startsWith(DATASOURCES_DIR)) {
    throw new Error('Invalid datasource path');
  }

  const ext = path.extname(resolved).toLowerCase();
  if (SQLITE_EXTENSIONS.has(ext)) {
    return { type: 'sqlite', path: resolved, label: id };
  }

  if (id.endsWith('.sqlserver.json') || id.endsWith('.mysql.json')) {
    const content = await fs.readFile(resolved, 'utf-8');
    const cfg = JSON.parse(content);
    return {
      type: (cfg.type || 'mysql'),
      config: {
        host: cfg.host,
        port: cfg.port || 3306,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database
      },
      label: id
    };
  }

  throw new Error('Unsupported datasource');
}

router.get('/datasources', async (req, res) => {
  try {
    const items = await listDataSources();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Datasources error' });
  }
});

router.get('/schema', async (req, res) => {
  try {
    const datasource = await resolveDataSource(req.query.datasource);
    const tables = [];

    if (datasource.type === 'sqlite') {
      const db = new Database(datasource.path, { readonly: true });
      const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      for (const row of tableRows) {
        const name = row.name;
        const columnRows = db.prepare(`PRAGMA table_info('${name}')`).all();
        const columns = columnRows.map(col => ({ name: col.name, type: col.type }));
        tables.push({ name, columns });
      }
      db.close();
    } else if (datasource.type === 'mysql') {
      const conn = await mysql.createConnection(datasource.config);
      const [tableRows] = await conn.query('SHOW TABLES');
      const tableNames = (tableRows || []).map(row => Object.values(row)[0]);
      for (const name of tableNames) {
        const [columnRows] = await conn.query(`SHOW COLUMNS FROM \`${name}\``);
        const columns = (columnRows || []).map(col => ({ name: col.Field, type: col.Type }));
        tables.push({ name, columns });
      }
      await conn.end();
    } else {
      return res.status(400).json({ error: 'Unsupported datasource type' });
    }

    res.json({ tables, source: datasource.label });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Schema error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { query, datasource: datasourceId } = req.body ?? {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const raw = String(query).trim();
    const sql = raw.replace(/;\s*$/, '');
    const datasource = await resolveDataSource(datasourceId);

    if (datasource.type === 'sqlite') {
      const db = new Database(datasource.path, { readonly: true });
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all();
        const columns = stmt.columns().map(c => c.name);
        db.close();
        return res.json({ rows, columns, rowCount: rows.length, source: datasource.label });
      }

      const info = stmt.run();
      db.close();
      return res.json({
        rows: [],
        columns: [],
        rowCount: info?.changes || 0,
        source: datasource.label
      });
    }

    if (datasource.type === 'mysql') {
      const conn = await mysql.createConnection(datasource.config);
      const [rows, fields] = await conn.query(sql);
      await conn.end();
      const columns = Array.isArray(fields) ? fields.map(f => f.name) : [];
      const rowCount = Array.isArray(rows) ? rows.length : (rows?.affectedRows || 0);
      return res.json({
        rows: Array.isArray(rows) ? rows : [],
        columns,
        rowCount,
        source: datasource.label
      });
    }

    return res.status(400).json({ error: 'Unsupported datasource type' });
  } catch (e) {
    const message = e?.message || 'SQL error';
    res.status(400).json({ error: message });
  }
});

export default router;
