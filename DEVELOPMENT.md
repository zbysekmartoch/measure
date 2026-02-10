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
│   ├── labs/                    # Lab data on disk (gitignored)
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
│   ├── vite.config.js           # Vite config (proxy to backend)
│   ├── index.html
│   └── src/
│       ├── main.jsx             # React entry point
│       ├── App.jsx              # Root component (auth gate + tab layout)
│       ├── components/
│       │   ├── AuthPage.jsx             # Login / register / reset password
│       │   ├── Toast.jsx                # Notification system
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
│       ├── i18n/translations.js      # Translation strings (cs/sk/en)
│       ├── lib/
│       │   ├── appConfig.js          # App-level constants
│       │   ├── fetchJSON.js          # Authenticated fetch wrapper
│       │   ├── gridConfig.js         # AG Grid configuration
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
- **JWT authentication** — stateless, 7-day expiry, bcrypt password hashing.
- **Security** — Helmet, CORS, rate limiting (300 req/min), path traversal protection.

### Frontend

- **React 19** SPA with Vite 7.
- **Tab-based layout** — My Labs / Shared Labs browser + dynamic lab workspace tabs.
- **Monaco Editor** — for script editing, SQL queries, and file preview.
- **AG Grid** — for SQL query results.
- **Context providers** — Auth, Language, Settings, Toast, FileClipboard.
- **State preservation** — tab content persists via CSS `display:none` toggle.
- **Dirty tracking** — global registry warns before browser close if unsaved work exists.
- **User-select disabled** on UI chrome; enabled in editors and grids.

## Database Schema

```sql
CREATE TABLE usr (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100)
);

CREATE TABLE password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES usr(id)
);
```

Lab data is stored on disk — see [LABS.md](LABS.md).

## Configuration

### `.env`

| Variable | Example |
|----------|---------|
| `PORT` | `3000` |
| `DB_HOST` | `localhost` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL credentials |
| `JWT_SECRET` | signing secret |
| `CORS_ORIGIN` | `http://localhost:5173` |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` | SMTP config |
| `FRONTEND_URL` | `http://localhost:5173` |

### `config.json`

```json
{
  "scripts": {
    "commands": {
      ".py": "labs/.venv/bin/python",
      ".js": "node",
      ".sh": "bash",
      ".r": "Rscript"
    }
  },
  "fileManager": { "defaultDepth": 0, "hiddenFilePrefixes": [".", "__"] }
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
cd frontend && npm install && npm run dev
mysql -u root -p < backend/sql/create.sql
```
