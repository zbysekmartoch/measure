# Perspective.js — Data Explorer pro Measure

## Přehled

Integrace [FINOS Perspective](https://perspective.finos.org/) do aplikace Measure jako interaktivní nástroj pro prohlížení a analýzu CSV/JSON dat. Uživatel klikne na „Analyze" u CSV/JSON souboru v Results nebo Scripts panu a data se zobrazí v novém tabu **Data Explorer** s plným Perspective viewerem (pivot tabulky, grafy, filtrování, řazení, grouping).

### Co je Perspective?

Perspective je high-performance datový engine (C++ / WebAssembly) s webovým viewerem. Umožňuje:
- **Pivot tabulky** — group by, split by, aggregace (sum, avg, count…)
- **Filtrování a řazení** — interaktivní bez kódu
- **Vizualizace** — datagrid, bar/line/scatter/area chart, treemap, heatmap
- **Velké datasety** — miliony řádků díky WASM engine
- **Export** — CSV, JSON, clipboard

### Proč Perspective a ne jen AG Grid?

Measure už používá AG Grid pro jednoduché tabulky, ale Perspective přidává:
- Pivot/aggregační schopnosti (Excel-like analýza)
- Vestavěné grafy bez dalších závislostí
- WASM engine — rychlý i na 1M+ řádků
- Interaktivní UI pro exploratorní analýzu bez psaní kódu

---

## Architektura

```
┌─────────────────────────────────────────────────────────┐
│  App.jsx — tab bar                                      │
│  [My Labs] [Shared Labs] [🔬 Lab A] [📊 Data Explorer] │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────▼────────────────┐
              │   DataExplorerTab.jsx        │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ Toolbar               │  │
              │  │ [source info] [Reset] │  │
              │  │ [Export CSV] [Close]  │  │
              │  └───────────────────────┘  │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ <perspective-viewer>  │  │
              │  │                       │  │
              │  │  (WASM-powered grid   │  │
              │  │   + charts + pivot)   │  │
              │  │                       │  │
              │  └───────────────────────┘  │
              └─────────────────────────────┘
```

### Datový tok

```
1. Uživatel v LabResultsPane/LabScriptsPane vidí CSV/JSON soubor
2. Klikne na tlačítko „📊 Analyze" (context menu nebo toolbar)
3. App.jsx otevře nový top-level tab „Data Explorer"
4. DataExplorerTab.jsx:
   a) Stáhne obsah souboru z backendu (GET /api/v1/labs/:id/.../content?file=...)
   b) Detekuje formát (CSV / JSON)
   c) Načte Perspective WASM worker
   d) Vytvoří Perspective Table z dat
   e) Předá Table do <perspective-viewer>
5. Uživatel interaktivně analyzuje data (pivot, filter, chart…)
```

---

## Implementační plán

### Fáze 1: Instalace a základní komponenta

#### 1.1 Instalace závislostí

```bash
cd frontend
npm install @finos/perspective @finos/perspective-viewer @finos/perspective-viewer-datagrid @finos/perspective-viewer-d3fc
```

Balíčky:
| Balíček | Účel |
|---------|------|
| `@finos/perspective` | Core WASM engine + worker |
| `@finos/perspective-viewer` | `<perspective-viewer>` web component |
| `@finos/perspective-viewer-datagrid` | Tabulkový plugin (default view) |
| `@finos/perspective-viewer-d3fc` | Grafové pluginy (bar, line, scatter…) |

#### 1.2 Vite konfigurace

Perspective používá WASM a Web Workers. Vite potřebuje:

```js
// vite.config.js — přidat do existující konfigurace
export default defineConfig({
  // ...existující config...
  optimizeDeps: {
    exclude: [
      '@finos/perspective',
      '@finos/perspective-viewer',
      '@finos/perspective-viewer-datagrid',
      '@finos/perspective-viewer-d3fc',
    ],
  },
  worker: {
    format: 'es',
  },
});
```

> **Poznámka:** Perspective od verze 3.x dodává ESM-kompatibilní build. Pokud Vite má problémy s WASM loading, může být potřeba použít `vite-plugin-wasm` a `vite-plugin-top-level-await`:
> ```bash
> npm install -D vite-plugin-wasm vite-plugin-top-level-await
> ```

#### 1.3 Základní React wrapper

Vytvořit `frontend/src/components/PerspectiveViewer.jsx`:

```jsx
import React, { useRef, useEffect } from 'react';
import perspective from '@finos/perspective';

import '@finos/perspective-viewer';
import '@finos/perspective-viewer-datagrid';
import '@finos/perspective-viewer-d3fc';

// Perspective themes
import '@finos/perspective-viewer/dist/css/themes.css';

let worker = null;

function getWorker() {
  if (!worker) {
    worker = perspective.worker();
  }
  return worker;
}

/**
 * PerspectiveViewer — React wrapper kolem <perspective-viewer>.
 *
 * Props:
 *   data     — string (CSV) nebo Array<Object> (JSON rows)
 *   fileName — název souboru (pro zobrazení a detekci formátu)
 *   config   — volitelný objekt s Perspective viewer konfigurací
 *              (group_by, split_by, columns, filter, sort, plugin…)
 */
export default function PerspectiveViewer({ data, fileName, config }) {
  const viewerRef = useRef(null);
  const tableRef = useRef(null);

  useEffect(() => {
    if (!viewerRef.current || !data) return;

    let cancelled = false;

    async function loadData() {
      const w = getWorker();

      // Vytvoř Perspective Table
      const table = await w.table(data);
      if (cancelled) {
        table.delete();
        return;
      }

      tableRef.current = table;
      const viewer = viewerRef.current;

      // Načti tabulku do vieweru
      await viewer.load(table);

      // Aplikuj volitelnou konfiguraci
      if (config) {
        await viewer.restore(config);
      }
    }

    loadData();

    return () => {
      cancelled = true;
      // Cleanup: smaž tabulku při unmountu
      if (tableRef.current) {
        tableRef.current.delete();
        tableRef.current = null;
      }
    };
  }, [data, fileName]);

  return (
    <perspective-viewer
      ref={viewerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
```

### Fáze 2: Data Explorer tab

#### 2.1 DataExplorerTab component

Vytvořit `frontend/src/tabs/DataExplorerTab.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import PerspectiveViewer from '../components/PerspectiveViewer.jsx';
import { shadow } from '../lib/uiConfig.js';

/**
 * DataExplorerTab — top-level záložka pro interaktivní analýzu dat.
 *
 * Props:
 *   source — { labId, apiPath, fileName }
 *            apiPath = plné API path k souboru (např. /api/v1/labs/3/results/run-1/files)
 *            fileName = název souboru (output.csv)
 */
export default function DataExplorerTab({ source }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!source) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchJSON(
          `${source.apiPath}/content?file=${encodeURIComponent(source.fileName)}`
        );
        setData(res.content);
      } catch (err) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [source]);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: '#6b7280' }}>
        ⏳ Loading data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: '#dc2626' }}>
        ❌ {error}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
        borderBottom: '1px solid #e5e7eb', background: '#f9fafb',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
          📊 {source.fileName}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          Lab #{source.labId}
        </span>
      </div>

      {/* Perspective Viewer */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <PerspectiveViewer data={data} fileName={source.fileName} />
      </div>
    </div>
  );
}
```

#### 2.2 Integrace do App.jsx — nový typ tabu

Rozšířit stav a tab bar v `App.jsx`:

```jsx
// Nový stav pro Data Explorer taby
const [openExplorers, setOpenExplorers] = useState([]);
// Formát exploreru: { id: 'explorer:<labId>:<fileName>:<timestamp>',
//                     source: { labId, apiPath, fileName },
//                     label: 'output.csv' }

// Funkce pro otevření Data Exploreru (předat dolů přes props)
const openDataExplorer = useCallback((source) => {
  const id = `explorer:${source.labId}:${source.fileName}:${Date.now()}`;
  const explorer = { id, source, label: source.fileName };
  setOpenExplorers((prev) => [...prev, explorer]);
  setTab(id);
}, []);

// Funkce pro zavření
const closeDataExplorer = useCallback((explorerId) => {
  setOpenExplorers((prev) => prev.filter((e) => e.id !== explorerId));
  setTab((prev) => (prev === explorerId ? 'mine' : prev));
}, []);
```

Tab bar — za open lab taby přidat explorer taby:

```jsx
{/* Data Explorer taby */}
{openExplorers.map((explorer) => {
  const isActive = tab === explorer.id;
  return (
    <span key={explorer.id} style={{ display: 'inline-flex', alignItems: 'stretch', marginBottom: isActive ? -1 : 0, zIndex: isActive ? 1 : 0 }}>
      <button
        onClick={() => setTab(explorer.id)}
        title={`Data Explorer: ${explorer.label}`}
        style={{
          padding: '8px 12px', border: '1px solid #012345', borderBottom: 'none',
          borderRight: 'none', borderRadius: '8px 0 0 0',
          background: isActive ? '#fff' : '#f3f4f6',
          fontWeight: isActive ? 600 : 400, color: '#111827',
          maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', cursor: 'pointer', outline: 'none',
        }}
      >
        📊 {explorer.label}
      </button>
      <button
        onClick={() => closeDataExplorer(explorer.id)}
        title="Close"
        style={{
          padding: '4px 6px', border: '1px solid #012345', borderBottom: 'none',
          borderLeft: 'none', borderRadius: '0 8px 0 0',
          background: isActive ? '#fff' : '#f3f4f6',
          cursor: 'pointer', color: '#c20000', fontSize: 13,
          display: 'flex', alignItems: 'center', outline: 'none',
        }}
      >
        ×
      </button>
    </span>
  );
})}
```

Content area — přidat renderování Data Explorer tabů:

```jsx
{/* Data Explorer taby */}
{openExplorers.map((explorer) => (
  <div
    key={explorer.id}
    style={{
      display: tab === explorer.id ? 'block' : 'none',
      height: '100%',
    }}
  >
    <DataExplorerTab source={explorer.source} />
  </div>
))}
```

### Fáze 3: Tlačítko „Analyze" ve file manageru

#### 3.1 Kde přidat tlačítko

V `FilePreviewPane.jsx` — do toolbaru vedle Download / Delete — přidat podmíněné tlačítko pro CSV/JSON soubory:

```jsx
{/* Analyze — jen pro CSV a JSON soubory */}
{/\.(csv|json|tsv)$/i.test(selectedFile) && onAnalyze && (
  <button
    onClick={() => onAnalyze(selectedFile)}
    style={{
      padding: '4px 10px', background: '#7c3aed', color: '#fff',
      border: 'none', borderRadius: 6, cursor: 'pointer',
      fontSize: 12, boxShadow: shadow.small,
    }}
    title="Open in Data Explorer"
  >
    📊 Analyze
  </button>
)}
```

#### 3.2 Propojení callbacku

Callback `onAnalyze` se musí propagovat od `App.jsx` dolů přes:

```
App.jsx (openDataExplorer)
  → LabWorkspaceTab (prop: onAnalyze)
    → LabResultsPane / LabScriptsPane (prop: onAnalyze)
      → FileManagerEditor (prop: onAnalyze)
        → FilePreviewPane (prop: onAnalyze)
```

V `LabResultsPane` / `LabScriptsPane` — vytvořit handler:

```jsx
const handleAnalyze = useCallback((fileName) => {
  // apiPath závisí na kontextu — Results vs Scripts
  onAnalyze({
    labId: lab.id,
    apiPath: `/api/v1/labs/${lab.id}/results/${selectedResultId}/files`,
    fileName,
  });
}, [lab.id, selectedResultId, onAnalyze]);
```

#### 3.3 Alternativní spuštění — double-click na CSV

V `FileManagerEditor` — rozšířit `onFileDoubleClick` handler tak, aby CSV/JSON soubory automaticky nabídly analýzu (nebo rovnou otevřely Data Explorer, podle uživatelské preference).

### Fáze 4: Rozšíření a vylepšení

#### 4.1 Podpora více formátů vstupních dat

Perspective nativně podporuje:

| Formát | Detekce | Poznámka |
|--------|---------|----------|
| CSV | `.csv`, `.tsv` | `worker.table("col1,col2\n1,2")` — string s CSV |
| JSON (row-oriented) | `.json` + `Array.isArray(parsed)` | `worker.table([{a:1},{a:2}])` |
| JSON (column-oriented) | `.json` + objekt se sloupci | `worker.table({a:[1,2], b:[3,4]})` |
| Apache Arrow | `.arrow` | `worker.table(arrowBuffer)` — nejvýkonnější |

V `PerspectiveViewer.jsx` přidat detekci formátu:

```jsx
function parseData(content, fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'csv' || ext === 'tsv') {
    // Perspective akceptuje CSV string přímo
    return content;
  }

  if (ext === 'json') {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return parsed;
  }

  // Fallback — zkus jako CSV
  return content;
}
```

#### 4.2 Ukládání konfigurace vieweru

Uživatel si nastaví pivot/filtr/graf → uložit konfiguraci do lab state:

```jsx
// Uložení
const config = await viewerRef.current.save();
await fetchJSON(`/api/v1/labs/${labId}/state/perspective-${fileName}.json`, {
  method: 'PUT',
  body: JSON.stringify({ file: `perspective-${fileName}.json`, content: JSON.stringify(config) }),
});

// Obnovení při příštím otevření
const savedConfig = await fetchJSON(`/api/v1/labs/${labId}/state/content?file=perspective-${fileName}.json`);
await viewerRef.current.restore(JSON.parse(savedConfig.content));
```

#### 4.3 Export z Perspective

Perspective viewer má vestavěný export (pravý klik → Export CSV). Navíc přidat toolbar tlačítka:

```jsx
<button onClick={async () => {
  const csv = await viewerRef.current.getTable().view().to_csv();
  // Stáhni jako soubor
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analyzed_${source.fileName}`;
  a.click();
  URL.revokeObjectURL(url);
}}>
  ⬇ Export CSV
</button>
```

#### 4.4 Téma / dark mode

Perspective podporuje themes. Přepínat na základě Monaco editor theme:

```jsx
// Na <perspective-viewer> elementu
viewerRef.current.setAttribute('theme', editorTheme === 'vs-dark' ? 'Pro Dark' : 'Pro Light');
```

#### 4.5 Velké soubory — streaming

Pro soubory > 10 MB zvážit:
1. Backend endpoint pro streamované načtení (chunked response)
2. Nebo konverzi do Apache Arrow formátu na backendu (Python: `pyarrow`)
3. Progressive loading — Perspective umí `table.update()` pro přidání dalších řádků

---

## Struktura souborů (nové/upravené)

```
frontend/src/
├── components/
│   └── PerspectiveViewer.jsx     ← NOVÝ — React wrapper
├── tabs/
│   └── DataExplorerTab.jsx       ← NOVÝ — top-level záložka
├── App.jsx                       ← UPRAVIT — přidat explorer state + taby

frontend/src/components/file-manager/
├── FilePreviewPane.jsx           ← UPRAVIT — přidat tlačítko Analyze

frontend/
├── vite.config.js                ← UPRAVIT — Perspective WASM kompatibilita
├── package.json                  ← UPRAVIT — nové závislosti
```

---

## Kroky implementace (pořadí)

| # | Krok | Soubory | Odhad složitosti |
|---|------|---------|-----------------|
| 1 | `npm install` Perspective balíčky | `package.json` | Nízká |
| 2 | Upravit Vite config pro WASM/workers | `vite.config.js` | Nízká |
| 3 | Vytvořit `PerspectiveViewer.jsx` wrapper | Nový soubor | Střední |
| 4 | Vytvořit `DataExplorerTab.jsx` | Nový soubor | Střední |
| 5 | Přidat explorer state + taby do `App.jsx` | Upravit | Střední |
| 6 | Propagovat `openDataExplorer` callback do `LabWorkspaceTab` | Upravit | Nízká |
| 7 | Přidat „Analyze" tlačítko do `FilePreviewPane.jsx` | Upravit | Nízká |
| 8 | Propojit callback přes `LabResultsPane`/`LabScriptsPane` | Upravit | Nízká |
| 9 | Testování s CSV/JSON soubory | — | — |
| 10 | Dark mode, export, uložení konfigurace | Rozšíření | Volitelné |

---

## Potenciální problémy a řešení

### WASM loading ve Vite

Perspective WASM se musí správně servírovat. Pokud Vite dev server nefunguje:

```js
// vite.config.js
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  // ...
});
```

### Web Component v Reactu

`<perspective-viewer>` je **web component** (Custom Element). React 19 má nativní podporu pro custom elements — props se mapují automaticky. Pro starší React je nutné použít `ref` callback (jak ukazuje příklad v PerspectiveViewer.jsx).

### Velikost bundlu

Perspective WASM ~ 3–5 MB (gzipped ~ 1.2 MB). Doporučuji lazy loading:

```jsx
// V DataExplorerTab.jsx — lazy import
const PerspectiveViewer = React.lazy(
  () => import('../components/PerspectiveViewer.jsx')
);

// V renderování
<Suspense fallback={<div>Loading Data Explorer…</div>}>
  <PerspectiveViewer data={data} fileName={source.fileName} />
</Suspense>
```

Tím se Perspective načte až když uživatel skutečně otevře Data Explorer, ne při prvním loadu aplikace.

### Content Security Policy (CSP)

Perspective používá `blob:` URLs pro WASM workers. Pokud backend má CSP hlavičky, přidat:
```
worker-src 'self' blob:;
script-src 'self' 'wasm-unsafe-eval';
```

---

## Alternativy k Perspective (pro referenci)

| Nástroj | Výhody | Nevýhody |
|---------|--------|----------|
| **Perspective** ✅ | WASM speed, pivot, grafy, built-in UI | Větší bundle (~3 MB) |
| **AG Grid** (už v projektu) | Už nainstalovaný | Bez pivot/grafů v community verzi |
| **Tabulator** | Lehký, flexibilní | Méně analytických funkcí |
| **Apache Superset** | Full BI platforma | Overkill, vyžaduje backend |
| **Observable Plot** | Moderní grafy | Jen vizualizace, ne tabulky |

→ **Perspective je nejlepší fit** — jeden balíček pokrývá tabulku + grafy + pivoty s výborným výkonem.
