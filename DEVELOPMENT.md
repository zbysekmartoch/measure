# Development Guide

## Overview

Measure is a browser-based analytical workbench. Users authenticate, create **labs** (analysis projects), manage files, execute scripts in multiple languages, run SQL queries, and debug scripts — all through a React SPA backed by an Express API.

## Project Structure

```
measure/
├── backend/
│   ├── config.json              # Runtime config (script runners, logging)
│   ├── .env                     # Secrets (DB, JWT, email)
│   ├── package.json
│   ├── datasources/             # SQL Server / SQLite connection configs
│   ├── labs/                    # Lab data on disk (individual labs gitignored)
│   ├── backups/                 # Lab backups (gitignored)
│   ├── sql/                     # Database DDL and migration scripts
│   ├── src/
│   │   ├── index.js             # Express server entry point
│   │   ├── config.js            # Environment configuration loader
│   │   ├── db.js                # MySQL connection pool
│   │   ├── debug/               # DAP debug proxy (WebSocket)
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT auth (header + query param)
│   │   │   └── error.js         # Global error handler
│   │   ├── routes/
│   │   │   ├── index.js         # Main router
│   │   │   ├── auth.js          # Login, register, password reset
│   │   │   ├── labs.js          # Labs CRUD, files, execution, debug, clone
│   │   │   ├── sql.js           # SQL execution against datasources
│   │   │   └── users.js         # User listing (for sharing)
│   │   └── utils/
│   │       ├── email.js         # Nodemailer wrapper
│   │       └── file-manager.js  # Generic file utils (list, read, write, upload)
│   └── temp/
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js.example   # Vite config template (copy to vite.config.js)
│   ├── index.html
│   └── src/
│       ├── main.jsx             # React entry point
│       ├── App.jsx              # Root component (auth gate + tab layout)
│       ├── components/
│       │   ├── AuthPage.jsx             # Login / register / reset password
│       │   ├── ConfirmResetPasswordForm.jsx  # Password reset confirmation
│       │   ├── LanguageSelector.jsx     # Language switcher UI
│       │   ├── LoginForm.jsx            # Login form
│       │   ├── RegisterForm.jsx         # Registration form
│       │   ├── ResetPasswordForm.jsx    # Password reset request form
│       │   ├── Toast.jsx                # Notification system
│       │   ├── WorkflowProgressPane.jsx # Workflow step-by-step progress
│       │   ├── ZoomableImage.jsx        # Zoom/pan image viewer
│       │   ├── FileManagerEditor.jsx    # File manager barrel export
│       │   └── file-manager/
│       │       ├── FileBrowserPane.jsx   # Tree-based file browser
│       │       ├── FilePreviewPane.jsx   # File preview / editor
│       │       ├── useFileManager.js     # File manager state hook
│       │       ├── ClipboardContext.jsx  # Cross-pane copy/paste
│       │       └── fileUtils.js          # File type detection, formatting
│       ├── context/
│       │   ├── AuthContext.jsx       # JWT auth state
│       │   ├── LanguageContext.jsx   # i18n provider
│       │   └── SettingsContext.jsx   # User preferences
│       ├── debug/
│       │   ├── dap-client.js         # WebSocket DAP client
│       │   ├── DebugEditor.jsx       # Debug code viewer with breakpoints
│       │   ├── DebugPanel.jsx        # Debug controls + variable inspection
│       │   └── useDebugSession.js    # Debug session hook
│       ├── hooks/
│       │   └── useWorkflowEvents.js  # SSE workflow progress hook
│       ├── i18n/translations.js      # Translation strings (cs/sk/en)
│       ├── lib/
│       │   ├── appConfig.js          # App-level constants
│       │   ├── fetchJSON.js          # Authenticated fetch wrapper
│       │   ├── uiConfig.js           # Centralized UI styles, icons, Monaco options
│       │   └── dirtyRegistry.js      # Global dirty-file tracking
│       └── tabs/
│           ├── LabWorkspaceTab.jsx    # Lab workspace (scripts + results + settings)
│           ├── LabScriptsPane.jsx     # Scripts file manager + run/debug
│           ├── LabResultsPane.jsx     # Results viewer
│           ├── LabSettingsPane.jsx    # Lab metadata + sharing + backup
│           ├── SettingsTab.jsx        # App settings
│           └── SqlEditorTab.jsx       # SQL editor + results grid
```

## Architecture

### Backend

- **Express 4** with ES Modules, mounted at `/api/v1/`.
- **MySQL** (mysql2/promise) for user data; **SQLite** (better-sqlite3) for datasource queries.
- **Labs stored on disk** — each lab is a folder with `lab.json`, `scripts/`, `results/`, `state/`.
- **Script execution** — spawns child processes using configurable commands from `config.json`.
- **DAP debugging** — WebSocket proxy between browser and debugpy.
- **JWT authentication** — stateless, 7-day expiry, bcryptjs password hashing.
- **Backup scheduler** — periodic automated lab backups based on configurable frequency.
- **Logging** — pino + pino-http structured JSON logging.
- **Security** — Helmet, CORS, rate limiting (300 req/min), path traversal protection.

### Frontend

- **React 19** SPA with Vite 7.
- **Tab-based layout** — My Labs / Shared Labs browser + dynamic lab workspace tabs.
- **Monaco Editor** — for script editing, SQL queries, and file preview.
- **AG Grid** — for SQL query results.
- **Context providers** — Auth, Language, Settings, Toast, FileClipboard.
- **Markdown rendering** — React Markdown with KaTeX math formula support.
- **State preservation** — tab content persists via CSS `display:none` toggle.
- **Dirty tracking** — global registry warns before browser close if unsaved work exists.
- **User-select disabled** on UI chrome; enabled in editors and grids.
- **Standalone mode** — `?lab=<id>&standalone=1` opens a lab in popup-window mode.

## Database Schema

```sql
CREATE TABLE `usr` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Lab data is stored on disk — see [LABS.md](LABS.md).

## Configuration

### `.env`

| Variable | Example |
|----------|---------|
| `PORT` | `50100` |
| `DB_HOST` | `localhost` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL credentials |
| `JWT_SECRET` | signing secret |
| `CORS_ORIGINS` | `http://localhost:50101` (comma-separated) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` | SMTP config |
| `EMAIL_SECURE` | `true` or `false` |
| `EMAIL_FROM` | Sender address |
| `FRONTEND_URL` | `http://localhost:50101` |

### `config.json`

```json
{
  "paths": { "scripts": "scripts", "results": "results" },
  "scriptCommands": {
    ".py":  { "command": "./labs/.venv/bin/python", "description": "Python scripts" },
    ".js":  { "command": "node", "description": "Node.js scripts" },
    ".cjs": { "command": "node", "description": "Node.js scripts" },
    ".sh":  { "command": "bash", "description": "Shell scripts" },
    ".r":   { "command": "Rscript", "description": "R scripts" },
    ".R":   { "command": "Rscript", "description": "R scripts" }
  },
  "logging": { "logFileName": "analysis.log", "errorFileName": "analysis.err" },
  "analysis": { "defaultTimeout": 300000, "maxConcurrentAnalyses": 5 },
  "fileManager": { "defaultDepth": 0, "hiddenFilePrefixes": [".", "_", "node_modules"] }
}
```

## Code Conventions

- **ES Modules** throughout (`import`/`export`)
- **Functional React** — hooks only, no class components
- **Inline styles** referencing `uiConfig.js` for consistency
- **`fetchJSON`** — all API calls use the centralized fetch wrapper with auto JWT headers
- **File naming** — PascalCase for React components, camelCase for hooks/utilities

## Development Setup

```bash
# Prerequisites: Node.js 18+, MySQL 8+

cd backend && cp .env.example .env && npm install && npm run dev
cd frontend && cp vite.config.js.example vite.config.js && npm install && npm run dev
mysql -u root -p < backend/sql/create.sql
```
