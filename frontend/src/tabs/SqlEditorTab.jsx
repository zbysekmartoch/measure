import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';

/**
 * SqlEditorTab — SQL editor with run, autocomplete, data source selection, results table.
 *
 * Props (all optional):
 *   initialSql   – pre-fill the editor with this SQL (e.g. loaded .sql file content)
 *   onSqlChange  – callback(value) fired on every editor change (for dirty tracking)
 *   extraButtons – React node rendered at the start of the toolbar (e.g. Save button)
 */
export default function SqlEditorTab({ initialSql, onSqlChange, extraButtons }) {
  const { t } = useLanguage();
  const [sql, setSql] = useState(initialSql ?? 'SELECT 1;');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dbInfo, setDbInfo] = useState(null);
  const [schema, setSchema] = useState([]);
  const [dataSources, setDataSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(() => localStorage.getItem('sqlDatasource') || '');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [editorTheme, setEditorTheme] = useState(() =>
    localStorage.getItem('monacoTheme') || 'vs-dark'
  );
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const completionRef = useRef(null);

  // Sync external initialSql when it changes (e.g. file reloaded)
  const prevInitialSql = useRef(initialSql);
  useEffect(() => {
    if (initialSql !== undefined && initialSql !== prevInitialSql.current) {
      prevInitialSql.current = initialSql;
      setSql(initialSql);
    }
  }, [initialSql]);

  // Propagate changes to parent
  const handleSqlChange = useCallback((val) => {
    const v = val ?? '';
    setSql(v);
    onSqlChange?.(v);
  }, [onSqlChange]);

  const availableThemes = [
    { value: 'vs', label: 'Light' },
    { value: 'vs-dark', label: 'Dark' },
    { value: 'hc-black', label: 'High Contrast' },
  ];

  const columns = useMemo(() => {
    if (!result?.columns?.length) return [];
    return result.columns;
  }, [result]);

  const rows = useMemo(() => {
    if (!Array.isArray(result?.rows)) return [];
    return result.rows;
  }, [result]);

  const runQuery = useCallback(async (overrideSql) => {
    const editorValue = editorRef.current?.getValue();
    const sqlToRun = (typeof overrideSql === 'string' && overrideSql.trim() !== '')
      ? overrideSql
      : (editorValue ?? sql);
    if (!String(sqlToRun).trim()) {
      setError(t('sqlEmpty') || 'SQL is empty');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const data = await fetchJSON('/api/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sqlToRun, datasource: selectedSource || undefined })
      });
      setResult(data);
    } catch (e) {
      setError(e?.message || t('sqlError') || 'SQL error');
    } finally {
      setRunning(false);
    }
  }, [sql, t, selectedSource]);

  useEffect(() => {
    fetchJSON('/api/health')
      .then((info) => setDbInfo(info?.database || null))
      .catch(() => setDbInfo(null));
  }, []);

  useEffect(() => {
    fetchJSON('/api/v1/sql/datasources')
      .then((data) => {
        const items = data?.items || [];
        setDataSources(items);
        if (selectedSource && !items.some(i => i.id === selectedSource)) {
          setSelectedSource('');
        }
      })
      .catch(() => setDataSources([]));
  }, [selectedSource]);

  useEffect(() => {
    const qs = selectedSource ? `?datasource=${encodeURIComponent(selectedSource)}` : '';
    setConnectionStatus('connecting');
    fetchJSON(`/api/v1/sql/schema${qs}`)
      .then((data) => {
        setSchema(data?.tables || []);
        setConnectionStatus('connected');
      })
      .catch(() => {
        setSchema([]);
        setConnectionStatus('error');
      });
  }, [selectedSource]);

  const handleThemeChange = useCallback((theme) => {
    setEditorTheme(theme);
    localStorage.setItem('monacoTheme', theme);
  }, []);

  const formatSourceName = useCallback((value) => {
    if (!value) return '';
    return value.split('.')[0] || value;
  }, []);

  const openInNewWindow = useCallback(() => {
    const newWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!newWindow) {
      setError(t('popupBlocked') || 'Allow pop-ups for this page');
      return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>SQL Editor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; }
    #container { height: 100vh; display: flex; flex-direction: column; }
    #toolbar { padding: 8px 12px; background: #1e1e1e; border-bottom: 1px solid #333; display: flex; gap: 12px; align-items: center; color: #ccc; }
    #toolbar select { padding: 4px 8px; border-radius: 4px; border: 1px solid #555; background: #333; color: #fff; }
    #toolbar button { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; }
    #toolbar button.run { background: #22c55e; color: #fff; }
    #toolbar button.close { background: #6b7280; color: #fff; }
    #editor { flex: 1; }
    #results { flex: 0 0 35vh; overflow: auto; border-top: 1px solid #333; background: #111; color: #fff; font-size: 12px; padding: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #333; }
    th { background: #0f172a; text-align: left; }
  </style>
</head>
<body>
  <div id="container">
    <div id="toolbar">
      <span>🧮 SQL Editor</span>
      ${selectedSource ? `<span style="font-size:12px;">Source: ${selectedSource}</span>` : '<span style="font-size:12px;">Source: default</span>'}
      <select id="themeSelect">
        <option value="vs">Light</option>
        <option value="vs-dark" selected>Dark</option>
        <option value="hc-black">High Contrast</option>
      </select>
      <button class="run" id="runBtn">▶ Run (Ctrl+Enter)</button>
      <button class="close" onclick="window.close()">✕ Close</button>
      <span id="status" style="margin-left:auto"></span>
    </div>
    <div id="editor"></div>
    <div id="results"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"><` + `/script>
  <script>
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      const editor = monaco.editor.create(document.getElementById('editor'), {
        value: ${JSON.stringify(sql)},
        language: 'sql',
        theme: 'vs-dark',
        fontSize: 13,
        minimap: { enabled: false },
        wordWrap: 'on',
        automaticLayout: true,
      });

      document.getElementById('themeSelect').addEventListener('change', (e) => {
        monaco.editor.setTheme(e.target.value);
      });

      const runQuery = async () => {
        const selection = editor.getSelection();
        let query = editor.getValue();
        if (selection && !selection.isEmpty()) {
          query = editor.getModel().getValueInRange(selection);
        }
        const status = document.getElementById('status');
        status.textContent = 'Running...';
        const res = await fetch('/api/v1/sql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${localStorage.getItem('authToken') || ''}'
          },
          body: JSON.stringify({ query, datasource: ${JSON.stringify(selectedSource || '')} || undefined })
        });
        if (!res.ok) {
          status.textContent = 'Error';
          document.getElementById('results').innerHTML = '<pre style="white-space:pre-wrap;margin:0">' + (await res.text()) + '</pre>';
          return;
        }
        const data = await res.json();
        status.textContent = 'Rows: ' + (data.rowCount || 0);
        const cols = data.columns || [];
        const rows = data.rows || [];
        if (cols.length === 0 || rows.length === 0) {
          document.getElementById('results').innerHTML = '<div style="color:#9ca3af">No results</div>';
          return;
        }
        const table = [
          '<table><thead><tr>',
          ...cols.map(c => '<th>' + c + '</th>'),
          '</tr></thead><tbody>',
          ...rows.map(r => '<tr>' + cols.map(c => '<td>' + (r[c] ?? '') + '</td>').join('') + '</tr>'),
          '</tbody></table>'
        ].join('');
        document.getElementById('results').innerHTML = table;
      };

      document.getElementById('runBtn').addEventListener('click', runQuery);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runQuery);
    });
  <` + `/script>
</body>
</html>
    `;

    newWindow.document.write(htmlContent);
    newWindow.document.close();
  }, [sql, t, selectedSource]);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const selection = editor.getSelection();
      let selectionText = '';
      if (selection && !selection.isEmpty()) {
        selectionText = editor.getModel().getValueInRange(selection);
      }
      runQuery(selectionText || undefined);
    });
  }, [runQuery]);

  useEffect(() => {
    if (!monacoRef.current) return;
    if (completionRef.current) {
      completionRef.current.dispose();
      completionRef.current = null;
    }

    const monaco = monacoRef.current;
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'INSERT', 'UPDATE', 'DELETE',
      'CREATE', 'ALTER', 'DROP', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'AS', 'AND', 'OR', 'IN', 'NOT', 'NULL'
    ];

    const tableNames = schema.map(t => t.name);
    const columnItems = schema.flatMap(t =>
      (t.columns || []).map(c => ({
        label: c.name,
        insertText: c.name,
        detail: t.name,
        kind: monaco.languages.CompletionItemKind.Field
      }))
    );

    const tableColumnItems = schema.flatMap(t =>
      (t.columns || []).map(c => ({
        label: `${t.name}.${c.name}`,
        insertText: `${t.name}.${c.name}`,
        detail: c.type,
        kind: monaco.languages.CompletionItemKind.Field
      }))
    );

    completionRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions = [
          ...keywords.map(k => ({
            label: k,
            insertText: k,
            kind: monaco.languages.CompletionItemKind.Keyword,
            range,
          })),
          ...tableNames.map(name => ({
            label: name,
            insertText: name,
            kind: monaco.languages.CompletionItemKind.Class,
            range,
          })),
          ...columnItems.map(item => ({ ...item, range })),
          ...tableColumnItems.map(item => ({ ...item, range })),
        ];

        return { suggestions };
      }
    });

    return () => {
      if (completionRef.current) {
        completionRef.current.dispose();
        completionRef.current = null;
      }
    };
  }, [schema]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {extraButtons}
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => runQuery()}
          disabled={running}
        >
          {running ? (t('sqlRunning') || 'Running...') : (t('sqlRun') || 'Run SQL')}
        </button>
        <button
          className="btn"
          type="button"
          onClick={openInNewWindow}
        >
          {t('openInNewWindow') || 'Open in new window'}
        </button>
        <select
          value={editorTheme}
          onChange={(e) => handleThemeChange(e.target.value)}
          style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px' }}
        >
          {availableThemes.map((theme) => (
            <option key={theme.value} value={theme.value}>{theme.label}</option>
          ))}
        </select>
        <select
          value={selectedSource}
          onChange={(e) => {
            const next = e.target.value;
            setSelectedSource(next);
            localStorage.setItem('sqlDatasource', next);
          }}
          style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px' }}
        >
          <option value="">{t('sqlDefaultSource') || 'Default DB'}</option>
          {dataSources.map((ds) => (
            <option key={ds.id} value={ds.id}>{formatSourceName(ds.label || ds.id)}</option>
          ))}
        </select>
        {(selectedSource || dbInfo) && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {t('sqlDb') || 'DB'}: {selectedSource ? formatSourceName(selectedSource) : `${dbInfo.host} / ${dbInfo.name}`}
          </span>
        )}
        {connectionStatus && (
          <span style={{ fontSize: 12, color: connectionStatus === 'connected' ? '#16a34a' : connectionStatus === 'connecting' ? '#6b7280' : '#dc2626' }}>
            {connectionStatus === 'connected' && (t('sqlConnected') || 'Connected')}
            {connectionStatus === 'connecting' && (t('sqlConnecting') || 'Connecting...')}
            {connectionStatus === 'error' && (t('sqlDisconnected') || 'Disconnected')}
          </span>
        )}
        {result && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {t('sqlRows') || 'Rows'}: {result.rowCount}
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 200, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={sql}
          onChange={handleSqlChange}
          onMount={handleEditorMount}
          theme={editorTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            automaticLayout: true,
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 160, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        {error ? (
          <pre style={{ margin: 0, padding: 12, color: '#dc2626', whiteSpace: 'pre-wrap' }}>{error}</pre>
        ) : rows.length === 0 ? (
          <div style={{ padding: 12, color: '#6b7280' }}>{t('sqlNoResults') || 'No results'}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((col) => (
                    <td key={col} style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>
                      {row?.[col] == null ? '' : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
