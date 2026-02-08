# DEVELOPMENT.md — Podrobný vývojářský průvodce aplikací Measure

> Poslední aktualizace: únor 2026

---

## 1. Přehled projektu

**MEASURE** (Modular Extensible Analytical Stack — UOHS Research Environment) je webová analytická platforma pro data scientisty. Umožňuje:

- Tvorbu a editaci analytických skriptů (Python, JavaScript, R, Shell)
- Spouštění vícekrokových workflow
- Prohlížení výsledků s live logem
- Ad-hoc SQL dotazy nad MySQL, SQLite a externími datasourcy
- Správu osobních a sdílených laboratoří (Labs)
- Debug režim – opakované spuštění nad existujícím `data.json`

Projekt vznikl refaktorem z původního retailového analytického nástroje (RPA). Doménová logika (produkty, košíky, kategorie, harvesting) byla odstraněna a zůstalo obecné analytické jádro.

---

## 2. Architektura

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React 19 + Vite 7)         │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ ┌─────┐ │
│  │AnalysesTab│ │LabsTab   │ │Results │ │Debug │ │Sett.│ │
│  │ Execution │ │ My/Shared│ │Tab     │ │Tab   │ │Tab  │ │
│  │ Definition│ │ Lab tabs │ │        │ │      │ │     │ │
│  └──────────┘ └──────────┘ └────────┘ └──────┘ └─────┘ │
│  ┌────────────────────────────┐ ┌──────────────────────┐ │
│  │ FileManagerEditor (Monaco) │ │ SqlEditorTab (Monaco)│ │
│  └────────────────────────────┘ └──────────────────────┘ │
│  ┌──────────────┐ ┌───────────┐ ┌──────────────────────┐ │
│  │ AuthContext   │ │ Lang/i18n │ │ SettingsContext      │ │
│  └──────────────┘ └───────────┘ └──────────────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │ Vite proxy /api → :3000
┌──────────────────────────▼──────────────────────────────┐
│                  Backend (Node.js + Express)             │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Middleware: Helmet, CORS, Rate Limit, JWT Auth       ││
│  └──────────────────────────────────────────────────────┘│
│  Routes:                                                 │
│  /api/v1/auth      – login, register, me, reset-password│
│  /api/v1/analyses  – CRUD + run                         │
│  /api/v1/results   – list, detail, log, download, debug │
│  /api/v1/workflows – list .workflow soubory             │
│  /api/v1/scripts   – file manager nad scripts/          │
│  /api/v1/sql       – ad-hoc SQL dotazy                  │
│  /api/v1/labs      – CRUD, sharing, state, scripts      │
│  /api/v1/users     – seznam uživatelů                   │
│  /api/health       – healthcheck                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Utilities: file-manager.js, email.js               │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │      MySQL/MariaDB       │
              │ Tabulky: usr, analysis,  │
              │ result, password_resets  │
              └─────────────────────────┘
              ┌─────────────────────────┐
              │      Filesystem          │
              │ backend/scripts/         │
              │ backend/results/{id}/    │
              │ backend/labs/{uuid}/     │
              │ backend/datasources/     │
              └─────────────────────────┘
```

### Komunikační tok

1. Frontend posílá HTTP requesty přes `fetchJSON()`, automaticky přidává JWT `Authorization: Bearer <token>`.
2. Vite dev server proxy přesměrovává `/api/*` na backend port 3000.
3. Backend middleware `authenticateToken` dekóduje JWT a nastaví `req.userId`.
4. Routy pracují s MySQL (přes `mysql2/promise` pool) a souborovým systémem.

---

## 3. Technologický stack

### Frontend
| Technologie | Verze | Účel |
|---|---|---|
| React | 19.x | UI framework (hooks, functional components) |
| Vite | 7.x | Build tool, HMR, dev server s proxy |
| Monaco Editor | `@monaco-editor/react` 4.7 | Editace kódu (Python, JS, SQL, JSON…) |
| AG Grid Community | 34.x | Data gridy se sort/filter/virtualizací |
| TanStack Table | 8.x | (dostupný, ale primárně se používá AG Grid) |

### Backend
| Technologie | Verze | Účel |
|---|---|---|
| Node.js | (ES Modules) | Runtime |
| Express | 4.19 | HTTP framework |
| mysql2 | 3.11 | MySQL connection pool |
| better-sqlite3 | 11.x | SQLite pro SQL editor datasources |
| jsonwebtoken | 9.x | JWT generování a ověření |
| bcryptjs | 3.x | Hashování hesel |
| multer | 2.x | Upload souborů (multipart) |
| archiver | 7.x | ZIP export výsledků |
| nodemailer | 7.x | Email pro password reset |
| helmet | 7.x | Security HTTP headers |
| pino / pino-http | 9.x / 10.x | Strukturované logování |
| dotenv | 16.x | Environment variables |

### Analytické skripty
| Jazyk | Interpret | Konfigurace v `config.json` |
|---|---|---|
| Python | `.venv/bin/python` (lokální venv) | `.py` |
| JavaScript / CJS | `node` | `.js`, `.cjs` |
| Shell | `bash` | `.sh` |
| R | `Rscript` | `.r`, `.R` |

---

## 4. Adresářová struktura

```
measure/
├── DEVELOPMENT.md          ← tento dokument
├── README.md               ← přehled projektu
├── LABS.md                 ← specifikace Labs funkcionality
├── CURRENT_STATE.md        ← archivní popis před refaktorem
├── TARGET_STATE_AND_PLAN.md← archivní plán refaktoru (splněno)
│
├── backend/
│   ├── package.json        ← measure-backend v0.2.1, type: module
│   ├── config.json         ← runtime konfigurace (cesty, script commands, logging)
│   ├── .env                ← env proměnné (DB_HOST, JWT_SECRET, EMAIL_*)
│   ├── eslint.config.js
│   ├── API.md              ← kompletní API dokumentace
│   ├── README.md
│   ├── HEALTH_CHECK.md
│   ├── EMAIL_TESTING.md
│   ├── PYTHON_SETUP.md
│   ├── SCRIPTS_API.md
│   │
│   ├── src/
│   │   ├── index.js        ← Express app bootstrap (helmet, cors, rate limit, pino)
│   │   ├── config.js       ← konfigurace z .env (DB, CORS, JWT, email)
│   │   ├── db.js           ← MySQL connection pool (mysql2/promise)
│   │   ├── middleware/
│   │   │   ├── auth.js     ← JWT authenticateToken middleware
│   │   │   └── error.js    ← 404 + centrální error handler
│   │   ├── routes/
│   │   │   ├── index.js    ← hlavní router – mountuje všechny subrouty
│   │   │   ├── auth.js     ← login, register, /me, password reset
│   │   │   ├── analyses.js ← CRUD analýz, /run, workflow resolution, script execution
│   │   │   ├── results.js  ← list/detail/log/download(ZIP)/debug/delete výsledků
│   │   │   ├── results-public.js ← public download DOCX/XLSX/ZIP bez auth
│   │   │   ├── result-files.js   ← file manager pro results/{id}/ složku
│   │   │   ├── workflows.js     ← list .workflow souborů z scripts/
│   │   │   ├── scripts.js       ← file manager pro scripts/ (list/read/write/upload/delete)
│   │   │   ├── sql.js           ← SQL executor (MySQL + SQLite), schema introspekce, datasources
│   │   │   ├── labs.js          ← Labs CRUD, sharing, per-user state, lab scripts
│   │   │   └── users.js         ← seznam uživatelů (pro sharing v Labs)
│   │   └── utils/
│   │       ├── file-manager.js  ← getSecurePath, listFiles, createUploadMiddleware
│   │       └── email.js         ← nodemailer transport, sendPasswordResetEmail
│   │
│   ├── scripts/             ← globální analytické skripty a workflow šablony
│   │   ├── *.workflow       ← workflow definice (řádky = kroky)
│   │   ├── analyzy/         ← Python analytické skripty + venv
│   │   │   ├── setup-python-env.sh
│   │   │   ├── requirements.txt
│   │   │   ├── dbsettings.py
│   │   │   ├── export_to_csv.py
│   │   │   ├── prepare_stats.py
│   │   │   └── .venv/       ← Python virtual environment
│   │   └── reports/         ← DOCX/PDF reportovací skripty (reporter.js)
│   │
│   ├── results/             ← výstupy analýz (složka per result ID)
│   │   └── {id}/
│   │       ├── data.json    ← vstupní konfigurace analýzy
│   │       ├── progress.json← stav běhu (step, elapsed time)
│   │       ├── analysis.log ← stdout log
│   │       ├── analysis.err ← stderr log
│   │       ├── *.docx/xlsx  ← reporty
│   │       └── img/         ← vygenerované grafy
│   │
│   ├── labs/                ← laboratoře (složka per lab UUID)
│   │   └── {uuid}/
│   │       ├── lab.json     ← metadata (id, name, ownerId, sharedWith[], …)
│   │       ├── scripts/     ← skripty laboratoře
│   │       ├── results/     ← výsledky laboratoře (reserved)
│   │       └── state/       ← per-user UI stav ({userId}.json)
│   │
│   ├── datasources/         ← SQL datasource konfigurace
│   │   ├── *.sqlite         ← SQLite databáze
│   │   ├── *.sqlserver.json ← SQL Server connection config
│   │   └── *.mysql.json     ← MySQL connection config
│   │
│   ├── sql/                 ← DDL skripty
│   │   ├── create.sql       ← CREATE TABLE statements
│   │   ├── before-import.sql
│   │   ├── after-import.sql
│   │   └── migration-*.sql
│   │
│   ├── logs/                ← aplikační logy (pino)
│   └── temp/                ← dočasné soubory
│
└── frontend/
    ├── package.json         ← measure-frontend, type: module
    ├── vite.config.js       ← dev server port 5173, proxy /api → :3000
    ├── index.html           ← SPA entry point
    ├── eslint.config.js
    ├── API.md
    ├── README.md
    ├── DEPLOYMENT.md
    │
    ├── public/              ← statické assety (logo, favicon)
    │
    └── src/
        ├── main.jsx         ← ReactDOM mount, AG Grid module registrace
        ├── App.jsx          ← root component, tab navigace, context providers
        ├── App.css
        ├── index.css
        │
        ├── components/      ← znovupoužitelné UI komponenty
        │   ├── AuthPage.jsx           ← kontejner pro login/register/reset formuláře
        │   ├── LoginForm.jsx          ← přihlašovací formulář
        │   ├── RegisterForm.jsx       ← registrační formulář
        │   ├── ResetPasswordForm.jsx  ← žádost o reset hesla
        │   ├── ConfirmResetPasswordForm.jsx ← nastavení nového hesla
        │   ├── FileManagerEditor.jsx  ← souborový prohlížeč + Monaco editor (1254 ř.)
        │   ├── LanguageSelector.jsx   ← přepínač jazyka (CZ/SK/EN)
        │   └── Toast.jsx             ← notifikační systém (success/error/warning)
        │
        ├── tabs/            ← hlavní záložky aplikace
        │   ├── AnalysesTab.jsx            ← kontejner s sub-taby Execution/Definition
        │   ├── AnalysisExecutionTab.jsx   ← seznam analýz + JSON editor + Run
        │   ├── AnalysisDefinitionTab.jsx  ← File editor + SQL editor sub-taby
        │   ├── ResultsTab.jsx             ← výsledky s live logem a pollingem
        │   ├── LabsTab.jsx                ← My labs / Shared labs + dynamické lab taby
        │   ├── SqlEditorTab.jsx           ← SQL editor s Monaco, autocomplete, datasources
        │   ├── DebugTab.jsx               ← debug režim – editace result files + re-run
        │   └── SettingsTab.jsx            ← jazyk, pokročilé UI toggle
        │
        ├── context/         ← React Context providers
        │   ├── AuthContext.jsx    ← JWT auth (login/logout/register/resetPassword)
        │   ├── LanguageContext.jsx ← i18n s detekcí jazyka prohlížeče
        │   └── SettingsContext.jsx ← uživatelské preference (showAdvancedUI)
        │
        ├── hooks/           ← (prázdné – připraveno pro custom hooks)
        │
        ├── lib/             ← utility moduly
        │   ├── fetchJSON.js    ← HTTP wrapper s auto JWT injection
        │   ├── appConfig.js    ← konstanty (poll interval, toast duration)
        │   ├── gridConfig.js   ← centrální AG Grid konfigurace (styly, filtry)
        │   └── inferSchema.js  ← JSON → JSON Schema inference (historický)
        │
        ├── i18n/
        │   └── translations.js ← překlady CZ/SK/EN (~170+ klíčů)
        │
        ├── schemas/         ← (odstraněno při refaktoru)
        └── assets/          ← statické assety importované v kódu
```

---

## 5. Databázové schéma (MySQL)

Aktivní tabulky po refaktoru:

### `usr` — uživatelé
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | BIGINT UNSIGNED PK AI | ID uživatele |
| `first_name` | VARCHAR(100) | Jméno |
| `last_name` | VARCHAR(100) | Příjmení |
| `email` | VARCHAR(255) UNIQUE | E-mail (login) |
| `password_hash` | VARCHAR(255) | bcrypt hash hesla |
| `created_at` | TIMESTAMP | Datum registrace |

### `analysis` — definice analýz
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | INT PK AI | ID analýzy |
| `name` | VARCHAR(255) | Název analýzy |
| `settings` | TEXT | JSON konfigurace (workflow, parametry) |
| `created_at` | DATETIME | Datum vytvoření |

### `result` — výsledky běhů analýz
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | INT PK AI | ID výsledku |
| `analysis_id` | INT | FK na analysis.id |
| `status` | VARCHAR(255) | pending / running / completed / failed |
| `output` | VARCHAR(255) | Textový výstup (legacy) |
| `report` | TEXT | Report text (legacy) |
| `created_at` | DATETIME | Datum spuštění |
| `completed_at` | DATETIME | Datum dokončení/selhání |

### `password_resets` — tokeny pro reset hesla
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | BIGINT UNSIGNED PK AI | ID |
| `user_id` | INT | FK na usr.id |
| `token` | VARCHAR(255) UNIQUE | JWT reset token |
| `expires_at` | TIMESTAMP | Expirace tokenu |

> **Pozůstalé tabulky** z retail éry (basket, bp, product, price, imp_price, imp_product, ds, harvester, schedule) stále existují v `create.sql`, ale v kódu se nepoužívají. Mohou být odstraněny.

---

## 6. Backend – detailní popis modulů

### 6.1 Entry point (`src/index.js`)

- Vytváří Express app s middleware řetězem: `pino-http` → `helmet` → `cors` → `express.json` → `rate-limit` → `api routes` → `notFound` → `errorHandler`.
- CORS origin kontrola přes `config.corsOrigins`.
- Rate limit: 300 req/min na `/api/`.
- Graceful shutdown: odchytí SIGINT/SIGTERM, uzavře server a DB pool.

### 6.2 Konfigurace (`src/config.js`)

Načítá proměnné z `.env`:

| Proměnná | Povinná | Výchozí | Popis |
|---|---|---|---|
| `DB_HOST` | ✅ | — | MySQL host |
| `DB_PORT` | — | 3306 | MySQL port |
| `DB_USER` | ✅ | — | MySQL uživatel |
| `DB_PASSWORD` | ✅ | — | MySQL heslo |
| `DB_NAME` | ✅ | — | Název databáze |
| `PORT` | — | 3000 | Port backendu |
| `CORS_ORIGINS` | — | `""` (vše) | Čárkou oddělené origins |
| `JWT_SECRET` | — | fallback | Secret pro JWT signing |
| `EMAIL_HOST` | — | smtp.gmail.com | SMTP server |
| `EMAIL_PORT` | — | 587 | SMTP port |
| `EMAIL_USER` | — | — | SMTP uživatel |
| `EMAIL_PASSWORD` | — | — | SMTP heslo |
| `FRONTEND_URL` | — | http://localhost:5173 | URL frontendu (pro reset links) |

### 6.3 Databáze (`src/db.js`)

- `mysql2/promise` connection pool s 10 spojeními.
- `keepAlive` aktivní (10s interval).
- Export: `getPool()` a helper `query(sql, params)`.

### 6.4 Autentizace (`src/routes/auth.js` + `src/middleware/auth.js`)

- **POST `/login`** — ověří email + bcrypt hash → vrátí JWT (7 dní expirace) + user objekt.
- **POST `/register`** — hashuje heslo (bcrypt, cost 12), vloží do `usr`.
- **GET `/me`** — ověří JWT z headeru, vrátí user detail z DB.
- **POST `/reset-password`** — vygeneruje JWT reset token (1h expirace), odešle email.
- **POST `/reset-password/confirm`** — ověří token, změní heslo v DB.
- **Middleware `authenticateToken`** — dekóduje JWT z `Authorization: Bearer <token>`, nastaví `req.userId`.

### 6.5 Analýzy (`src/routes/analyses.js`) — 692 řádků, klíčový modul

#### CRUD
- **GET `/`** — seznam analýz (volitelně `?search=`).
- **GET `/:id`** — detail s parsed settings.
- **POST `/`** — vytvoření (name + optional settings JSON).
- **PUT `/:id`** — aktualizace name/settings.
- **DELETE `/:id`** — smazání.
- **GET `/config`** — vrátí podporované typy skriptů a konfiguraci.

#### Spuštění analýzy (`POST /:id/run`)

Tok:
1. Načte `analysis.settings` z DB.
2. Zavolá `runAnalysis(analysisId, settings)` (asynchronně, neblokuje response).
3. `runAnalysis`:
   a. Resolvuje workflow kroky voláním `resolveWorkflowSteps()`.
   b. Vloží nový `result` záznam se statusem `pending`.
   c. Vytvoří složku `results/{resultId}/`.
   d. Zapíše `data.json` s resolvnutým workflow.
   e. Inicializuje `analysis.log` a `analysis.err` s hlavičkou.
   f. Zavolá `executeWorkflowSteps()`.

#### Workflow Resolution (`resolveWorkflowSteps`)

`settings.workflow` může být:
- **Array** → použije se přímo.
- **Víceřádkový string** → splitne na řádky.
- **Jednořádkový string** → načte `scripts/{name}.workflow` soubor.

#### Workflow Execution (`executeWorkflowSteps`)

- **Zámek**: globální `workflowLockPromise` zajišťuje sériové provádění (fronta).
- Kroky začínající `#` jsou odfiltrované (komentáře).
- Pro každý krok volá `runScript()`.
- Zapisuje `progress.json` s aktuálním krokem, časem, statusem.
- Po dokončení/selhání aktualizuje `result.status` v DB.

#### Spuštění skriptu (`runScript`)

- Z přípony souboru zjistí interpret (z `config.json.scriptCommands`).
- Spustí `spawn(command, [fullScriptPath, workDir])`.
- `stdout` → `analysis.log`, `stderr` → `analysis.err`.
- Vrátí `true` pokud exit code = 0.

#### Debug režim (`runDebugAnalysis`)

- Nečte settings z DB, ale z existujícího `data.json` v result složce.
- Nevytváří nový result záznam — aktualizuje existující.
- Přepíše log soubory s `[DEBUG MODE]` prefixem.
- Exportováno a voláno z `results.js`.

### 6.6 Výsledky (`src/routes/results.js`) — 352 řádků

- **GET `/`** — seznam výsledků (volitelně `?analysis_id=`), JOIN s `analysis.name`.
- **GET `/:id`** — detail + `progress.json` + seznam DOCX/XLSX souborů.
- **GET `/:id/log`** — plain text obsah `analysis.log`.
- **GET `/:id/download`** — ZIP celé results složky.
- **POST `/:id/debug`** — spustí debug analýzu (deleguje na `runDebugAnalysis`).
- **DELETE `/:id`** — smaže result z DB + `rm -rf` result složku.

### 6.7 Skripty (`src/routes/scripts.js`) — 262 řádků

File manager nad `backend/scripts/`:
- **GET `/`** — rekurzivní listing (volitelně `?subdir=`).
- **GET `/content?file=`** — čtení obsahu souboru (UTF-8).
- **PUT `/content`** — zápis obsahu (`{ file, content }`).
- **POST `/upload`** — multipart upload (až 50 MB).
- **DELETE `/?file=`** — smazání souboru.
- **GET `/download?file=`** — public download (bez auth).

### 6.8 SQL editor (`src/routes/sql.js`)

- **GET `/datasources`** — seznam datasources z `backend/datasources/` (SQLite soubory + JSON config soubory).
- **GET `/schema?datasource=`** — introspekce tabulek a sloupců (SHOW TABLES/COLUMNS pro MySQL, PRAGMA pro SQLite).
- **POST `/`** — exekuce SQL dotazu (`{ query, datasource }`). Vrátí `{ rows, columns, rowCount, source }`.

Podporované datasource typy:
- **default** — hlavní MySQL z `.env` konfigurace.
- **SQLite** — `.sqlite`, `.db`, `.sqlite3` soubory v `datasources/`.
- **MySQL/SQL Server JSON** — `*.mysql.json`, `*.sqlserver.json` s connection credentials.

### 6.9 Laboratoře (`src/routes/labs.js`) — 408 řádků

Viz také [LABS.md](LABS.md).

Data uložena na disku v `backend/labs/{uuid}/`:

#### Endpointy
| Endpoint | Method | Popis | Oprávnění |
|---|---|---|---|
| `/` | GET | Moje laboratoře | auth |
| `/shared` | GET | Sdílené se mnou | auth |
| `/` | POST | Vytvoření lab | auth |
| `/:id` | GET | Detail lab | owner/shared |
| `/:id` | PATCH | Úprava name/desc | owner |
| `/:id` | DELETE | Smazání lab | owner |
| `/:id/share` | POST | Sdílení s uživatelem | owner |
| `/:id/share/:userId` | DELETE | Zrušení sdílení | owner |
| `/:id/state` | GET | Per-user UI stav | owner/shared |
| `/:id/state` | PUT | Uložení UI stavu | owner/shared |
| `/:id/scripts` | GET | Seznam skriptů | owner/shared |
| `/:id/scripts/content` | GET | Čtení skriptu | owner/shared |
| `/:id/scripts/content` | PUT | Zápis skriptu | owner/shared |
| `/:id/scripts/upload` | POST | Upload skriptu | owner/shared |
| `/:id/scripts` | DELETE | Smazání skriptu | owner/shared |

#### Datový model (`lab.json`)
```json
{
  "id": "8534c87a-59c2-4a23-b480-3924c383c9ec",
  "name": "Analýza cenového indexu",
  "description": "Popis laboratoře",
  "ownerId": 1,
  "sharedWith": [2, 3],
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-02-01T14:30:00.000Z"
}
```

### 6.10 Utility moduly

#### `file-manager.js`
Zobecněný modul používaný jak pro `scripts/` tak pro `results/{id}/` a `labs/{id}/scripts/`:
- `getSecurePath(root, relative)` — ochrana proti path traversal.
- `listFiles(dir, prefix, maxDepth)` — rekurzivní výpis s filtrováním přípon; hloubka neomezená (default `0` = Infinity).
- `createUploadMiddleware(root, maxSize)` — multer storage s dynamickou destination.
- `copyRecursive(src, dest)` — rekurzivní kopírování souborů/složek.
- Konfigurováno z `config.json` (`fileManager.defaultDepth` (0=unlimited), `hiddenFilePrefixes`).

#### `email.js` (142 řádků)
- Nodemailer transport (lazy init).
- `sendPasswordResetEmail(email, token)` — HTML šablona s reset linkem.

### 6.11 Workflows (`src/routes/workflows.js`)

- **GET `/`** — vrací seznam `.workflow` souborů z `scripts/` (bez přípony).
- **GET `/:name`** — obsah konkrétního workflow souboru.

Formát `.workflow` souboru:
```
# komentář (přeskočeno při spuštění)
analyzy/prepare_stats.py
analyzy/export_to_csv.py
reports/reporter.js
```
Každý řádek = cesta ke skriptu relativně k `scripts/`.

---

## 7. Frontend – detailní popis modulů

### 7.1 Entry point a hlavní komponenty

**`main.jsx`** — mount Reactu, registrace AG Grid modulů, import globálních stylů.

**`App.jsx`** — kořenový component:
- Vnořené providery: `LanguageProvider` → `SettingsProvider` → `AuthProvider` → `ToastProvider`.
- Pokud uživatel není přihlášen, zobrazí `AuthPage`.
- Po přihlášení zobrazí tabový layout s hlavními záložkami.
- Tab switching přes `display:none` (nikoliv conditional rendering) — zachovává stav komponent.
- Detekce `?lab=<id>` v URL → automaticky otevře Labs tab.

### 7.2 Tabový systém

| Tab ID | Komponenta | Viditelnost | Popis |
|---|---|---|---|
| `analytika` | `AnalysesTab` | Vždy | Hlavní analytický modul |
| `labs` | `LabsTab` | Vždy | Laboratoře |
| `vysledky` | `ResultsTab` | Vždy | Prohlížeč výsledků |
| `debug` | `DebugTab` | Jen advanced UI | Debug/re-run analýz |
| `nastaveni` | `SettingsTab` | Vždy | Nastavení uživatele |

### 7.3 AnalysesTab

Kontejner se dvěma sub-taby:
- **Execution** (`AnalysisExecutionTab`) — vždy viditelný:
  - Vlevo: AG Grid seznam analýz (ID, název, datum).
  - Vpravo: detail vybrané analýzy — název + JSON textarea pro `settings`.
  - Auto-save: při změně se po debounce automaticky uloží.
  - Tlačítko Run → `POST /api/v1/analyses/:id/run`.
  - Tlačítko „+ Přidat analýzu" nad gridem.

- **Definition** (`AnalysisDefinitionTab`) — jen advanced UI:
  - File editor → `FileManagerEditor` nad `/api/v1/scripts`.
  - SQL editor → `SqlEditorTab`.

### 7.4 LabsTab (370 řádků)

Implementuje dynamické tab rozhraní pro laboratoře:

**Hlavní taby:**
- **My labs** — seznam vlastních, + Create / - Remove, editace názvu/popisu, sharing panel.
- **Shared labs** — read-only seznam sdílených, tlačítko Enter.

**Dynamické lab taby:**
- Kliknutím „Enter" se otevře nový tab `lab:{id}`.
- Každý lab tab zobrazuje `FileManagerEditor` (scoped na lab scripts) + `SqlEditorTab`.
- Tlačítka: close (✕), open in new window (▢).
- Otevření v novém okně přidá `?lab=<id>` do URL.

**Sharing:**
- Seznam uživatelů s checkboxy (multi-select).
- Toggle `POST/DELETE /api/v1/labs/:id/share`.

### 7.5 ResultsTab (612 řádků)

Dual-panel layout:
- **Levý panel**: AG Grid se seznamem výsledků (ID, analýza, status, datum).
- **Pravý panel**: detail výsledku:
  - Status badge (completed/failed/pending/running).
  - Progress info (krok X/Y, elapsed time).
  - Live log viewer s auto-scrollem a error highlighting.
  - Seznam DOCX/XLSX souborů ke stažení.
  - Tlačítko „Download ZIP" pro celý result.
  - Tlačítko „Debug" (re-run).

**Polling:**
- Pokud `status === 'pending' || 'running'`: polluje log a detail každých 5 sekund.
- Při změně výsledku se polling automaticky zastaví/restartuje.

### 7.6 SqlEditorTab (420 řádků)

- Monaco editor pro SQL s motivy (Light/Dark/High Contrast).
- Datasource selector (dropdown) — výchozí MySQL + external SQLite/JSON datasources.
- Schema introspekce → Monaco autocomplete (tabulky + sloupce).
- Spuštění Ctrl+Enter nebo tlačítkem.
- Výsledky v tabulce s dynamickými sloupci.
- Connection status indikátor (connected/connecting/error).
- Tlačítko „Open in new window" — plně funkční standalone SQL editor.

### 7.7 FileManagerEditor — decomposed file-manager module

Znovupoužitelný file browser + kódový editor (decomposed into `file-manager/` submodules):

**Props:**
- `apiBasePath` — base API cesta (např. `/api/v1/scripts` nebo `/api/v1/labs/:id/scripts`).
- `showUpload`, `showDelete`, `readOnly` — ovládání funkcí.
- `showModificationDate`, `title`, `refreshTrigger`.
- `onDebugWorkflow` — callback pro debug `.workflow` souborů.

**Funkce:**
- **Recursive tree view** — proper nested folder/file tree (unlimited depth).
- **Copy / Paste** across any file-manager instance via `FileClipboardProvider` context.
- Monaco editor s syntax highlighting dle přípony souboru.
- Drag & drop upload do konkrétní složky.
- Detekce změn (diff oproti uloženému obsahu).
- Náhled obrázků (PNG, JPG, SVG…) a PDF.
- Otevření editoru v novém okně (standalone).
- Theme přepínání sdílené přes localStorage.
- 🐛 Debug button on `.workflow` files.

### 7.8 DebugTab (492 řádků)

- Dropdown výběr existujícího výsledku.
- Dvoupanelový split (draggable splitter):
  - Levý: `FileManagerEditor` nad result files (editovatelné).
  - Pravý: log viewer.
- Tlačítko „Run & Debug" → `POST /api/v1/results/:id/debug`.
- Polling statusu a logu při běhu.

### 7.9 Context providers

#### AuthContext
- State: `user`, `isAuthenticated`, `loading`.
- Methods: `login()`, `logout()`, `register()`, `resetPassword()`.
- JWT token v `localStorage('authToken')`.
- Auto-ověření při mountu přes `GET /me`.

#### LanguageContext
- Podporované jazyky: `cz` (čeština), `sk` (slovenština), `en` (angličtina).
- Auto-detekce jazyka prohlížeče.
- Funkce `t(key, params)` s interpolací `{param}`.
- ~170+ překladových klíčů.

#### SettingsContext
- `showAdvancedUI` toggle — persistován v localStorage.
- Ovládá viditelnost: Definition tab, Debug tab, ID sloupce v gridech.

### 7.10 Utility knihovny

#### `fetchJSON.js`
- Wrapper nad `fetch()`.
- Auto-inject `Authorization: Bearer` z localStorage.
- Parsování JSON response.
- Robustní error handling s HTTP statusem a response body.

#### `gridConfig.js` (167 řádků)
- `defaultColDef` — sortable, resizable, tooltips.
- `commonGridProps` — theme, rowHeight, virtualization settings.
- `gridThemeStyles` — CSS custom properties pro konzistentní styling.
- Filter konfigurace (text, number, date).

#### `appConfig.js`
- `RESULT_LOG_POLL_INTERVAL_MS = 5000`
- `TOAST_DURATION_MS = 4000`

---

## 8. Konfigurace runtime (`backend/config.json`)

```json
{
  "paths": {
    "scripts": "scripts",
    "results": "results"
  },
  "scriptCommands": {
    ".py": { "command": "./scripts/analyzy/.venv/bin/python" },
    ".js": { "command": "node" },
    ".cjs": { "command": "node" },
    ".sh": { "command": "bash" },
    ".r": { "command": "Rscript" },
    ".R": { "command": "Rscript" }
  },
  "logging": {
    "logFileName": "analysis.log",
    "errorFileName": "analysis.err",
    "timestampFormat": "ISO",
    "separatorChar": "=",
    "separatorLength": 80
  },
  "analysis": {
    "defaultTimeout": 300000,
    "maxConcurrentAnalyses": 5
  },
  "fileManager": {
    "defaultDepth": 0,
    "hiddenFilePrefixes": [".", "_", "node_modules"]
  }
}
```

> Pozn.: `maxConcurrentAnalyses` je v konfiguraci, ale aktuální implementace používá globální zámek (sériové provádění).

---

## 9. API endpointy — kompletní přehled

### Veřejné (bez auth)
| Method | Endpoint | Popis |
|---|---|---|
| GET | `/api/health` | Healthcheck + verze + server info |
| POST | `/api/v1/auth/login` | Přihlášení |
| POST | `/api/v1/auth/register` | Registrace |
| POST | `/api/v1/auth/reset-password` | Žádost o reset hesla |
| POST | `/api/v1/auth/reset-password/confirm` | Potvrzení nového hesla |
| GET | `/api/v1/scripts/download?file=` | Public download skriptu |
| GET | `/api/v1/results-public/:id/files/:filename` | Public download DOCX/XLSX/ZIP |
| GET | `/api/v1/results/:id/files/download?file=` | Public download result file |

### Chráněné (vyžadují JWT)
| Method | Endpoint | Popis |
|---|---|---|
| GET | `/api/v1/auth/me` | Info o přihlášeném uživateli |
| GET | `/api/v1/analyses` | Seznam analýz |
| GET | `/api/v1/analyses/config` | Konfigurace (podporované typy skriptů) |
| GET | `/api/v1/analyses/:id` | Detail analýzy |
| POST | `/api/v1/analyses` | Vytvoření analýzy |
| PUT | `/api/v1/analyses/:id` | Aktualizace analýzy |
| DELETE | `/api/v1/analyses/:id` | Smazání analýzy |
| POST | `/api/v1/analyses/:id/run` | Spuštění analýzy |
| GET | `/api/v1/results` | Seznam výsledků |
| GET | `/api/v1/results/:id` | Detail výsledku |
| GET | `/api/v1/results/:id/log` | Log výsledku (plain text) |
| GET | `/api/v1/results/:id/download` | ZIP download výsledku |
| POST | `/api/v1/results/:id/debug` | Debug re-run |
| DELETE | `/api/v1/results/:id` | Smazání výsledku |
| GET | `/api/v1/results/:id/files` | Seznam souborů výsledku |
| GET | `/api/v1/results/:id/files/content` | Obsah souboru výsledku |
| PUT | `/api/v1/results/:id/files/content` | Zápis souboru výsledku |
| POST | `/api/v1/results/:id/files/upload` | Upload do výsledku |
| DELETE | `/api/v1/results/:id/files` | Smazání souboru výsledku |
| GET | `/api/v1/workflows` | Seznam workflow šablon |
| GET | `/api/v1/workflows/:name` | Obsah workflow |
| GET | `/api/v1/scripts` | Seznam skriptů |
| GET | `/api/v1/scripts/content` | Obsah skriptu |
| PUT | `/api/v1/scripts/content` | Zápis skriptu |
| POST | `/api/v1/scripts/upload` | Upload skriptu |
| DELETE | `/api/v1/scripts` | Smazání skriptu |
| GET | `/api/v1/sql/datasources` | Seznam datasources |
| GET | `/api/v1/sql/schema` | DB schema introspekce |
| POST | `/api/v1/sql` | Exekuce SQL dotazu |
| GET | `/api/v1/labs` | Moje laboratoře |
| GET | `/api/v1/labs/shared` | Sdílené laboratoře |
| POST | `/api/v1/labs` | Vytvoření laboratoře |
| GET | `/api/v1/labs/:id` | Detail laboratoře |
| PATCH | `/api/v1/labs/:id` | Úprava laboratoře |
| DELETE | `/api/v1/labs/:id` | Smazání laboratoře |
| POST | `/api/v1/labs/:id/share` | Sdílení laboratoře |
| DELETE | `/api/v1/labs/:id/share/:userId` | Zrušení sdílení |
| GET | `/api/v1/labs/:id/state` | Per-user UI stav |
| PUT | `/api/v1/labs/:id/state` | Uložení UI stavu |
| GET | `/api/v1/labs/:id/scripts` | Seznam lab skriptů |
| GET | `/api/v1/labs/:id/scripts/content` | Obsah lab skriptu |
| PUT | `/api/v1/labs/:id/scripts/content` | Zápis lab skriptu |
| POST | `/api/v1/labs/:id/scripts/upload` | Upload lab skriptu |
| DELETE | `/api/v1/labs/:id/scripts` | Smazání lab skriptu |
| GET | `/api/v1/users` | Seznam uživatelů |

---

## 10. Klíčové datové toky

### 10.1 Přihlášení uživatele
```
Frontend                              Backend
LoginForm.jsx                         auth.js
    │ POST /auth/login                    │
    │ {email, password}  ────────────►    │ query: SELECT usr WHERE email=?
    │                                     │ bcrypt.compare(password, hash)
    │ ◄──────────────────────────────     │ jwt.sign({userId}, secret, 7d)
    │ {token, user}                       │
    │ localStorage.setItem('authToken')   │
    │ setUser(user)                       │
```

### 10.2 Spuštění analýzy
```
Frontend                              Backend
AnalysisExecutionTab                  analyses.js
    │ POST /analyses/:id/run              │
    │ ◄── 201 {status: 'pending'}         │
    │                                     │ runAnalysis() [async, fire-and-forget]
    │                                     │   ├── resolveWorkflowSteps()
    │                                     │   ├── INSERT result (pending)
    │                                     │   ├── mkdir results/{id}/
    │                                     │   ├── write data.json
    │                                     │   ├── write log headers
    │                                     │   └── executeWorkflowSteps()
    │                                     │       ├── acquireWorkflowLock() [čekání ve frontě]
    │                                     │       ├── for each step:
    │                                     │       │   ├── write progress.json
    │                                     │       │   ├── runScript(step) [spawn]
    │                                     │       │   │   stdout → analysis.log
    │                                     │       │   │   stderr → analysis.err
    │                                     │       │   └── if exit≠0 → failed
    │                                     │       ├── UPDATE result SET status=completed
    │                                     │       └── release lock
    │                                     │
ResultsTab                            results.js
    │ GET /results/:id ──────────────►    │ detail + progress.json
    │ GET /results/:id/log ──────────►    │ plain text log
    │  [polling every 5s while pending]   │
```

### 10.3 Vytvoření a práce s Lab
```
Frontend                              Backend
LabsTab                               labs.js
    │ POST /labs {name, desc}             │
    │ ◄── 201 {id, name, ownerId, ...}   │ mkdir labs/{uuid}/
    │                                     │ mkdir scripts/, results/, state/
    │                                     │ write lab.json
    │                                     │
    │ [user opens lab]                    │
    │ GET /labs/:id/scripts ─────────►    │ listFiles(labs/{id}/scripts/)
    │ FileManagerEditor scoped            │
    │                                     │
    │ PUT /labs/:id/scripts/content       │ write file in labs/{id}/scripts/
    │ PUT /labs/:id/state                 │ write state/{userId}.json
```

---

## 11. Bezpečnostní opatření

| Oblast | Implementace |
|---|---|
| **Autentizace** | JWT (HS256), 7 dní expirace, bcrypt cost 12 |
| **Autorizace** | `authenticateToken` middleware na všech `/v1/*` routách (kromě auth) |
| **CORS** | Konfigurovatelný allowlist origins |
| **Rate limiting** | 300 req/min na `/api/` |
| **HTTP headers** | Helmet (CSP, HSTS, X-Frame-Options, …) |
| **Path traversal** | `getSecurePath()` — normalizace + prefix check |
| **SQL injection** | Parametrizované dotazy (`mysql2 execute` / `better-sqlite3 prepare`) |
| **File upload** | Multer s 50 MB limitem, destination validation |
| **Labs access** | Owner/shared kontrola na každém lab endpointu |
| **Public downloads** | Omezeny na DOCX/XLSX/ZIP přípony |

---

## 12. Spuštění vývojového prostředí

### Prerekvizity
- Node.js 18+
- MySQL/MariaDB
- Python 3.x (pro analytické skripty)

### Backend
```bash
cd backend
cp .env.example .env   # upravit DB credentials a JWT_SECRET
npm install
npm run dev             # nodemon --watch src
```

### Frontend
```bash
cd frontend
npm install
npm run dev             # vite dev server na :5173
```

### Python analytické prostředí
```bash
cd backend/scripts/analyzy
./setup-python-env.sh   # vytvoří .venv a nainstaluje requirements.txt
```

### Databáze
```bash
mysql -u root -p < backend/sql/create.sql
```

---

## 13. Konvence a vzory v kódu

### Backend
- **ES Modules** (`type: "module"` v package.json) — `import/export`.
- **Async/await** všude, žádné callbacky.
- Chyby propagovány přes `next(e)` do centrálního error handleru.
- Logování přes `console.log/error` + pino-http request logging.
- Konfigurace: env proměnné (`.env`) + runtime JSON (`config.json`).

### Frontend
- **Funkcionální komponenty** s hooks (žádné class components).
- **Context API** pro globální stav (žádný Redux/Zustand).
- **AG Grid** pro tabulky, **Monaco Editor** pro kód.
- **Inline styly** (žádný CSS-in-JS framework, žádný Tailwind).
- Tab switching přes `display: none/block` pro zachování stavu.
- `fetchJSON()` jako jediný HTTP komunikační bod.

### Pojmenování
- Backend routes: kebab-case URL, camelCase v kódu.
- Frontend: PascalCase pro komponenty, camelCase pro funkce/proměnné.
- DB sloupce: snake_case.
- Překlady: camelCase klíče v `translations.js`.

---

## 14. Známé limitace a technický dluh

1. **Sériová exekuce workflow** — globální zámek umožňuje jen jednu analýzu najednou (config má `maxConcurrentAnalyses`, ale není implementováno).
2. **Plaintext credentials** — `data.json` obsahuje MySQL přihlašovací údaje v plaintextu.
3. **Pozůstalé DB tabulky** — retail tabulky (product, basket, price, harvester, …) stále existují.
4. **Žádné testy** — chybí unit i e2e testy.
5. **Lab results/workflow** — Labs mají `results/` složku, ale spouštění workflow v kontextu labu ještě není implementováno.
6. **Lab state persistence** — State endpointy existují, ale UI je zatím plně nevyužívá.
7. **Inline CSS** — veškeré styly jsou inline, žádný design systém.
8. **Lokalizace** — české chybové hlášky v auth endpointech (backend) vs anglické v ostatních.
9. **Žádný RBAC** — sdílení labů nemá role (read vs write).
10. **Chybí pagination** — seznamy analýz/výsledků nemají stránkování.

---

## 15. Plánované rozšíření (viz LABS.md)

- Persistace editor stavu (otevřené soubory, aktivní taby) přes `/state` endpointy.
- Spouštění workflow v kontextu laboratoře (lab-scoped execution).
- Prohlížení výsledků v rámci laboratoře.
- Role pro sdílené laboratoře (read-only vs editor).
- Možnost spouštět skripty z jiných sdílených laboratoří.
