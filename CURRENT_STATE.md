# Současný stav projektu (únor 2026) — historický

> Poznámka: Tento dokument popisuje stav před refaktorem. Aktuální stav je již zjednodušený na obecný analytický nástroj.

## Shrnutí
Projekt je v současnosti monolitický nástroj pro retailovou analýzu cen (RPA). Obsahuje obecné analytické jádro (workflow, skripty, výsledky, logy) a zároveň výraznou doménovou vrstvu (produkty/košíky/kategorie) a harvesting/integrace.

## Backend (Node.js/Express, MySQL)

### Hlavní routy a autentizace
- JWT autentizace a základní healthcheck.
- Hlavní router agreguje všechny endpointy včetně doménových modulů a harvestu.
- Viz: backend/src/routes/index.js

### Analytické jádro
- **Analýzy**: CRUD + spouštění analýzy, workflow resolution, zápis data.json, logy, progress.json, exekuce skriptů se zámkem (jen jedna analýza běží současně).
- **Workflow resolution**: `settings.workflow` může být array, multiline string, nebo název `.workflow` souboru.
- **Výstupy**: výsledky v DB + složka `results/{id}`, logy `analysis.log`/`analysis.err`, progress, public download.
- **Debug režim**: opětovný běh nad existujícím `data.json`.
- Viz: backend/src/routes/analyses.js, backend/src/routes/results.js

### Správa skriptů
- File manager pro složku `scripts/` (list, content, upload, delete).
- Public download pro přímé odkazy.
- Viz: backend/src/routes/scripts.js

### Doménové části (retail)
- **Produkty, košíky, kategorie**: API vrstvy pro produkty, košíky a strom kategorií.
- **Vazba na DB**: tabulky `product`, `basket`, `bp` a související dotazy.
- Viz: backend/src/routes/products.js, backend/src/routes/baskets.js, backend/src/routes/categories-tree.js

### Harvesting/Integrace
- Harvesters, data sources, harvest schedule + forwarding API na externí harvestery.
- Viz: backend/src/routes/harvesters.js, backend/src/routes/data-sources.js, backend/src/routes/harvest-schedule.js, backend/src/routes/harvest.js

### Dokumentace
- Backend README/API obsahují popis domény (produkty, košíky, harvest) a technologický stack.
- Viz: backend/README.md, backend/API.md

## Frontend (React/Vite)

### Tabová navigace
- Tabový UI model se zachováním stavu mezi záložkami.
- Analýzy jsou rozděleny na **Execution** a **Definition**.
- Viz: frontend/src/tabs/AnalysesTab.jsx

### Analýzy – Execution
- Seznam analýz + detail.
- **Formulář podle JSON Schema** a alternativně JSON editor (textarea).
- Vazba na workflow selector + basket selector.
- Viz: frontend/src/tabs/AnalysisExecutionTab.jsx, frontend/src/schemas/analysisSettings.js, frontend/src/components/WorkflowSelector.jsx, frontend/src/components/BasketSelector.jsx

### Analýzy – Definition
- File manager/editor nad `scripts/` s Monaco editorem.
- Viz: frontend/src/tabs/AnalysisDefinitionTab.jsx, frontend/src/components/FileManagerEditor.jsx

### Výsledky
- Seznam výsledků + detail, polling logu, stažení souborů.
- Viz: frontend/src/tabs/ResultsTab.jsx

### Doménové UI
- Produkty, košíky, kategorie a jejich komponenty.
- Viz: frontend/src/tabs/ProductsTab.jsx, frontend/src/tabs/BasketsTab.jsx, frontend/src/components/CategoryTree.jsx

### Harvesting UI
- Harvest tabs a konfigurace zdrojů/harvesterů/schedule.
- Viz: frontend/src/tabs/HarvestTab.jsx, frontend/src/tabs/HarvestersTab.jsx, frontend/src/tabs/DataSourcesTab.jsx, frontend/src/tabs/HarvestScheduleTab.jsx

### Dokumentace
- Frontend README/API stále popisuje retail doménu a harvest.
- Viz: frontend/README.md, frontend/API.md

## Důležité poznámky
- **Doména je hluboce prorostlá** do API i UI (produkty/košíky/kategorie/harvest).
- **Analytické jádro** (workflow + data.json + scripts + results) je již obecně použitelné.
- **Konfigurace analýzy** je dnes hybrid (schema form + JSON editor), ale workflow již podporuje generické kroky a data.json.
- **Dokumentační nesoulady**: frontend API dokumentace uvádí session auth a parametry `workflow_id`/`basket_ids`, zatímco backend je JWT a pracuje s `settings`.

