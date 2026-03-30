/**
 * PerspectiveViewer — React wrapper around <perspective-viewer> web component.
 *
 * Props:
 *   data     — string (CSV) or Array<Object> (JSON rows) or Object (column-oriented JSON)
 *   fileName — file name (used for format detection)
 */
import React, { useRef, useEffect, useState } from 'react';
import perspective from '@finos/perspective';
import perspectiveViewer from '@finos/perspective-viewer';

import '@finos/perspective-viewer-datagrid';
import '@finos/perspective-viewer-d3fc';

import '@finos/perspective-viewer/dist/css/themes.css';

// WASM URLs — Vite handles these as static assets via ?url
import VIEWER_WASM from '@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm?url';
import SERVER_WASM from '@finos/perspective/dist/wasm/perspective-server.wasm?url';

/** One-time WASM initialization */
let initPromise = null;

function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const [viewerWasm, serverWasm] = await Promise.all([
        fetch(VIEWER_WASM),
        fetch(SERVER_WASM),
      ]);
      await perspectiveViewer.init_client(viewerWasm);
      perspective.init_server(serverWasm);
    })();
  }
  return initPromise;
}

/**
 * Detect the delimiter used in a CSV string by examining the header line.
 * Returns ',' or ';' (defaults to ',').
 */
function detectDelimiter(csvString) {
  const headerEnd = csvString.indexOf('\n');
  const header = headerEnd > 0 ? csvString.substring(0, headerEnd) : csvString;
  const semicolons = (header.match(/;/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

/**
 * Count columns in a CSV line respecting quoted fields.
 */
function countColumns(line, delimiter) {
  let count = 1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === delimiter && !inQuote) {
      count++;
    }
  }
  return count;
}

/**
 * Sanitize a CSV string: remove rows that don't match header column count.
 * Returns { csv, skippedRows }.
 */
function sanitizeCsv(csvString, delimiter) {
  const lines = csvString.split('\n');
  if (lines.length < 2) return { csv: csvString, skippedRows: 0 };

  const headerCols = countColumns(lines[0], delimiter);
  const kept = [lines[0]];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { kept.push(line); continue; }
    if (countColumns(line, delimiter) === headerCols) {
      kept.push(line);
    } else {
      skipped++;
    }
  }

  return { csv: kept.join('\n'), skippedRows: skipped };
}

/**
 * Convert a semicolon-delimited CSV to comma-delimited CSV.
 * Each field is quoted so embedded commas/semicolons are safe.
 */
function convertToCommaCsv(csvString) {
  const lines = csvString.split('\n');
  return lines.map((line) => {
    if (!line.trim()) return line;
    return line.split(';').map((field) => {
      const escaped = field.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',');
  }).join('\n');
}

/** Detect format, sanitize, and prepare data for Perspective table.
 *  Returns { data, skippedRows }. */
function prepareData(content, fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase();

  if (ext === 'csv' || ext === 'tsv') {
    const delimiter = detectDelimiter(content);
    const { csv: clean, skippedRows } = sanitizeCsv(content, delimiter);
    const data = delimiter === ';' ? convertToCommaCsv(clean) : clean;
    return { data, skippedRows };
  }

  if (ext === 'json') {
    return { data: typeof content === 'string' ? JSON.parse(content) : content, skippedRows: 0 };
  }

  return { data: content, skippedRows: 0 };
}

export default function PerspectiveViewer({ data, fileName }) {
  const viewerRef = useRef(null);
  const tableRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!viewerRef.current || !data) return;

    let cancelled = false;
    setError(null);
    setInfo(null);

    async function loadData() {
      await ensureInit();
      const client = await perspective.worker();
      const { data: prepared, skippedRows } = prepareData(data, fileName);
      const table = await client.table(prepared);

      if (cancelled) {
        table.delete();
        return;
      }

      tableRef.current = table;
      await viewerRef.current.load(table);

      const rowCount = await table.size();
      if (!cancelled) {
        setInfo({ rowCount, skippedRows });
      }
    }

    loadData().catch((err) => {
      console.error('[PerspectiveViewer] Failed to load data:', err);
      if (!cancelled) setError(err.message || String(err));
    });

    return () => {
      cancelled = true;
      if (tableRef.current) {
        tableRef.current.delete();
        tableRef.current = null;
      }
    };
  }, [data, fileName]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {info && (
        <div style={{
          padding: '4px 12px', fontSize: 12, flexShrink: 0,
          background: info.skippedRows > 0 ? '#fef3c7' : '#f0fdf4',
          color: info.skippedRows > 0 ? '#92400e' : '#166534',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>📊 {info.rowCount.toLocaleString()} rows loaded</span>
          {info.skippedRows > 0 && (
            <span>⚠️ {info.skippedRows.toLocaleString()} malformed rows skipped</span>
          )}
        </div>
      )}
      {error && (
        <div style={{
          padding: '6px 12px', fontSize: 12, flexShrink: 0,
          background: '#fee2e2', color: '#991b1b',
          borderBottom: '1px solid #fca5a5',
        }}>
          ❌ Failed to load data: {error}
        </div>
      )}
      <perspective-viewer
        ref={viewerRef}
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      />
    </div>
  );
}
