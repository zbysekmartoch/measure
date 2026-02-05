# Cílový stav a postup refaktoru (únor 2026) — splněno

> Poznámka: Refaktor byl proveden. Tento dokument zůstává jako archivní plán.

## Cílový stav
Cílem je zredukovat projekt na obecný analytický nástroj:

**Zůstává**
- Autentizace (JWT) a uživatelská správa.
- Analytické jádro: workflow, spuštění skriptů, data.json, logy, progress, výsledky.
- Editor skriptů a správa souborů `scripts/`.
- Prohlížení výsledků a práce se soubory výsledků.

**Odchází kompletně**
- Harvesting a integrace (harvesters, data sources, schedule, harvest API i UI).
- Retail doména (produkty, košíky, kategorie a všechny vazby v DB i UI).

## Nový obecný model vstupů
### Základní princip
- Vstupy pro analýzu jsou **jen připojení k MySQL**.
- Žádná doména: žádné produkty/košíky/kategorie.
- `data.json` je jediný vstupní soubor pro workflow, předběžně editovaný uživatelem.

### Návrh minimální struktury data.json
> Pouze spojení, bez doménové logiky.
```json
{
  "mysql": {
    "host": "localhost",
    "port": 3306,
    "database": "analytics_db",
    "user": "user",
    "password": "secret"
  }
}
```

- `data.json` se vytvoří při spuštění analýzy z textového editoru v UI.
- Workflow skripty si `data.json` načítají samy a rozhodují o dalším zpracování.

## Konfigurace analýzy (zpočátku)
- **Pouze textový JSON editor** pro prvotní tvar `data.json`.
- Žádné schema-driven formy, žádný Basket/Workflow selector.
- Spuštění analýzy pouze zapisuje `data.json` a spustí workflow.

## Postup refaktoru

### Fáze 1 — Odstranění doménových modulů
- Backend: odebrat routy a logiku pro produkty/košíky/kategorie.
- Frontend: odstranit taby Products/Baskets/CategoryTree + související UI.
- Dokumentace: vyčistit README/API od retail části.

### Fáze 2 — Odstranění harvest/integrací
- Backend: odstranit harvesters, data-sources, harvest-schedule, harvest.
- Frontend: odstranit HarvestTab + související UI.
- Dokumentace: vyčistit harvest systém.

### Fáze 3 — Zjednodušení analýz a nastavení
- Backend: `analysis.settings` bude ukládat raw JSON (text) pro `data.json`.
- Frontend: nahradit schema-form pouze JSON text editorem.
- Odebrat `analysisSettings` schema a `BasketSelector` z Execution tabu.

### Fáze 4 — Úprava DB schématu
- Odstranit tabulky `product`, `basket`, `bp`, `category` (pokud existuje), `harvester`, `ds`, `schedule`.
- Zachovat `usr`, `analysis`, `result`.

### Fáze 5 — Konsolidace dokumentace a API kontraktu
- Aktualizovat API dokumentaci a popsat nový model `data.json`.
- Uvést, že vstupy jsou pouze MySQL připojení.
- Zpřesnit end-to-end tok: editace `data.json` → run workflow → výsledky.

## Konkrétní cílové změny v kódu (orientačně)

### Backend
- Odstranit z routeru:
  - `/v1/products`, `/v1/baskets`, `/v1/categories`
  - `/v1/harvesters`, `/v1/data-sources`, `/v1/harvest-schedule`, `/v1/harvest`
- Zjednodušit `analyses` settings: nevyžadovat schema, pouze raw JSON string.

### Frontend
- Odstranit taby:
  - Products, Baskets, Harvest (a pod-taby)
- V Execution tabu ponechat:
  - seznam analýz + JSON text editor
  - tlačítko Run
- Definition tab + Results tab zůstávají.

## Rizika a poznámky
- Přenos citlivých údajů (MySQL password) bude v `data.json` — později zvážit šifrování/sekrety.
- Doporučeno ponechat `data.json` pouze ve výsledkové složce a nepersistovat plaintext v DB (pokud není nutné).

