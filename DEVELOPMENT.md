# Development Guide

Comprehensive developer reference for the Measure application.

---

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Architecture](#architecture)
4. [Backend Modules](#backend-modules)
5. [Frontend Modules](#frontend-modules)
6. [Database Schema](#database-schema)
7. [Configuration](#configuration)
8. [API Endpoints](#api-endpoints)
9. [Data Flow](#data-flow)
10. [Security](#security)
11. [Development Setup](#development-setup)
12. [Code Conventions](#code-conventions)
13. [Known Limitations](#known-limitations)

---

## Overview

Measure is a browser-based analytical workbench. Users authenticate, create **labs** (analysis projects), manage files (scripts and results), execute scripts in multiple languages, run SQL queries, and debug scripts — all through a React SPA backed by an Express API.

---

## Project Structure

```
measure/
├── backend/
│   ├── config.json              # Runtime configuration (script runners, logging, etc.)
│   ├── .env                     # Secrets (DB, JWT, email)
│   ├── package.json
│   ├── datasources/             # SQL Server / SQLite connection configs
│   ├── labs/                    # Lab data on disk (scripts, results, state)
│   │   └── <id>/
│   │       ├── lab.json         # Lab metadata
│   │       ├── scripts/         # User scripts
│   │       ├── results/         # Execution results
│   │       └── state/           # Per-user UI state
│   ├── sql/                     # Database DDL and migration scripts
│   ├── src/
│   │   ├── index.js             # Express server entry point
│   │   ├── config.js            # Environment configuration loader
│   │   ├── db.js                # MySQL connection pool
│   │   ├── debug/               # DAP debug proxy (WebSocket)
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT authentication middleware
│   │   │   └── error.js         # Global error handler
│   │   ├── routes/
│   │   │   ├── index.js         # Main router (mounts all sub-routers)
│   │   │   ├── auth.js          # Login, register, password reset
│   │   │   ├── labs.js          # Labs CRUD, files, execution, debugging
│   │   │   ├── sql.js           # SQL execution against datasources
│   │   │   └── users.js         # User listing (for sharing)
│   │   └── utils/
│   │       ├── email.js         # Nodemailer wrapper
│   │       └── file-manager.js  # Generic file management (list, read, write, upload, download, delete)
│   └── temp/                    # Temporary files
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js           # Vite config (proxy to backend)
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.jsx             # React entry point
│       ├── App.jsx              # Root component (auth gate + tab layout)
│       ├── components/
│       │   ├── AuthPage.jsx     # Login / register / reset password
│       │   ├── LoginForm.jsx
│       │   ├── RegisterForm.jsx
│       │   ├── ResetPasswordForm.jsx
│       │   ├── ConfirmResetPasswordForm.jsx
│       │   ├── LanguageSelector.jsx
│       │   ├── Toast.jsx        # Notification system
│       │   ├── FileManagerEditor.jsx  # File manager barrel export
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
│       │   ├── DebugEditor.jsx       # Debug code viewer
│       │   ├── DebugPanel.jsx        # Debug controls (breakpoints, variables)
│       │   └── useDebugSession.js    # Debug session hook
│       ├── i18n/
│       │   └── translations.js       # Translation strings
│       ├── lib/
│       │   ├── appConfig.js          # App-level constants
│       │   ├── fetchJSON.js          # Authenticated fetch wrapper
│       │   ├── gridConfig.js         # AG Grid configuration
│       │   ├── inferSchema.js        # Schema inference for forms
│       │   └── uiConfig.js           # Centralized UI styles (buttons, colors, shadows)
│       └── tabs/
│           ├── LabsTab.jsx           # Lab browser + dynamic sub-tabs
│           ├── LabWorkspaceTab.jsx    # Lab workspace container
│           ├── LabScriptsPane.jsx     # Scripts file manager + execution
│           ├── LabResultsPane.jsx     # Results viewer
│           ├── LabSettingsPane.jsx    # Lab metadata + sharing
│           ├── SettingsTab.jsx        # App settings
│           └── SqlEditorTab.jsx       # SQL editor + results grid
```

---

## Architecture

### Backend

- **Express 4** with ES Modules, mounted at `/api/v1/`.
- **MySQL** (mysql2/promise) for user data; **SQLite** (better-sqlite3) for read-only datasource queries.
- **Labs stored on disk** — each lab is a directory with `lab.json` metadata, `scripts/`, `results/`, and `state/` sub-folders.
- **Script execution** — spawns child processes using configurable commands from `config.json` (Python venv, Node.js, bash, Rscript).
- **DAP debugging** — WebSocket proxy between the browser and debugpy (Python DAP server).
- **JWT authentication** — stateless, 7-day expiry, bcrypt password hashing.
- **Security** — Helmet, CORS, rate limiting (300 req/min), path traversal protection.

### Frontend

- **React 19** SPA with Vite 7 (HMR in dev, static build for production).
- **Tab-based layout** — Labs tab with dynamic sub-tabs for each open lab, Settings tab.
- **Monaco Editor** — for script editing and SQL queries.
- **AG Grid** — for SQL query results and data tables.
- **Context providers** — Auth, Language, Settings, Toast, FileClipboard.
- **State preservation** — tab content persists when switching between tabs (CSS `display:none` toggle).

---

## Backend Modules

### `src/index.js` — Server Entry Point

Sets up Express with middleware (Helmet, CORS, rate limiter, JSON parsing, pino-http logging), mounts the main router, WebSocket DAP proxy, and handles graceful shutdown.

### `src/routes/auth.js` — Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | Email + password → JWT token |
| `/auth/register` | POST | Create new user (bcrypt hash) |
| `/auth/me` | GET | Verify token, return user profile |
| `/auth/reset-password` | POST | Request password reset email |
| `/auth/confirm-reset-password` | POST | Set new password with reset token |

### `src/routes/labs.js` — Labs (1200+ lines)

Handles everything related to labs: CRUD, sharing, file management (scripts & results), script execution with SSE progress, debug sessions, and ZIP downloads. See [LABS.md](LABS.md) for the full specification.

### `src/routes/sql.js` — SQL Execution

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sql` | POST | Execute SQL against a datasource |
| `/sql/datasources` | GET | List available datasources |
| `/sql/datasources/:name/schema` | GET | Get tables + columns for a datasource |

Supports MySQL (read/write) and SQLite (read-only) datasources.

### `src/routes/users.js` — User Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users` | GET | List all users (for lab sharing) |

### `src/utils/file-manager.js` — Generic File Management

Factory function `createFileManagerRoutes()` creates an Express router with endpoints for:
- `GET /` — list files (recursive tree)
- `GET /content` — read file content
- `PUT /content` — save file content
- `POST /upload` — upload file
- `POST /folder` — create new folder
- `GET /download` — download file
- `DELETE /` — delete file

Includes path traversal protection via `getSecurePath()`.

### `src/utils/email.js` — Email

Nodemailer wrapper for sending password reset emails. Supports Gmail, SMTP, Mailtrap, SendGrid.

### `src/debug/` — DAP Debug Proxy

- `debug-engine.js` — manages debugpy process lifecycle
- `debug-routes.js` — REST endpoints for debug session control
- `dap-proxy.js` — WebSocket proxy between browser and debugpy

---

## Frontend Modules

### Context Providers

| Provider | Purpose |
|----------|---------|
| `AuthContext` | JWT token storage, login/logout, user state |
| `LanguageContext` | Translation function `t()`, language switching |
| `SettingsContext` | User preferences (advanced UI toggle, etc.) |
| `Toast` | Notification system (success/error/info toasts) |
| `FileClipboardProvider` | Cross-pane file copy/paste state |

### Tab Components

| Component | Description |
|-----------|-------------|
| `LabsTab` | Lab browser (My Labs / Shared Labs), creates sub-tabs for open labs |
| `LabWorkspaceTab` | Container for a single lab: Scripts, Results, Settings sub-panes |
| `LabScriptsPane` | File manager for lab scripts + run/debug controls |
| `LabResultsPane` | Execution results viewer with file browser |
| `LabSettingsPane` | Lab name, description, sharing management |
| `SqlEditorTab` | Monaco SQL editor + datasource selector + AG Grid results |
| `SettingsTab` | App-level settings (language, advanced UI) |

### File Manager

A decomposed module in `components/file-manager/`:

- **`useFileManager`** — hook managing all file state and operations (CRUD, upload, download, paste, drag-drop)
- **`FileBrowserPane`** — recursive tree view with a virtual root folder, per-folder action buttons (new file, new folder, copy, paste, upload, download ZIP, delete)
- **`FilePreviewPane`** — file preview with Monaco editor (for text), image/PDF viewers, and action buttons (edit, save, download, delete)
- **`ClipboardContext`** — enables copy/paste across different file manager instances
- **`fileUtils`** — file type detection, icon mapping, size/date formatting

### Debug UI

- **`DebugEditor`** — Monaco-based code viewer with breakpoint gutters
- **`DebugPanel`** — step controls (continue, step over/in/out), variable inspection, call stack
- **`useDebugSession`** — React hook managing DAP WebSocket connection and debug state
- **`dap-client`** — low-level WebSocket DAP protocol client

### UI Configuration (`lib/uiConfig.js`)

Centralized button styles, colors, shadows, and icons. All inline-styled components reference this file for consistent theming.

---

## Database Schema

```sql
CREATE TABLE usr (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  first_name  VARCHAR(100),
  last_name   VARCHAR(100)
);

CREATE TABLE password_resets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token       VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES usr(id)
);
```

Lab data is stored on disk (not in MySQL) — see [LABS.md](LABS.md).

---

## Configuration

### Environment Variables (`.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | `secret` |
| `DB_NAME` | MySQL database | `measure` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `CORS_ORIGIN` | Allowed CORS origins | `http://localhost:5173` |
| `EMAIL_HOST` | SMTP host | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_USER` | SMTP username | `user@gmail.com` |
| `EMAIL_PASS` | SMTP password | `app-password` |
| `FRONTEND_URL` | Frontend URL (for reset links) | `http://localhost:5173` |

### Runtime Config (`config.json`)

Controls script execution commands, logging, file manager settings:

```json
{
  "scripts": {
    "commands": {
      ".py": "labs/.venv/bin/python",
      ".js": "node",
      ".sh": "bash",
      ".r": "Rscript",
      ".R": "Rscript"
    }
  },
  "logging": { "level": "info" },
  "fileManager": {
    "defaultDepth": 0,
    "hiddenFilePrefixes": [".", "__"]
  }
}
```

---

## API Endpoints

See [backend/API.md](backend/API.md) for the complete reference.

| Group | Prefix | Key Endpoints |
|-------|--------|---------------|
| Health | `/api/health` | System status check |
| Auth | `/api/v1/auth` | login, register, me, reset-password |
| Labs | `/api/v1/labs` | CRUD, sharing, scripts, results, execution, debug |
| SQL | `/api/v1/sql` | Execute queries, list datasources, get schema |
| Users | `/api/v1/users` | List users |
| Debug | `/api/v1/debug` | Debug session management |
| Paste | `/api/v1/paste` | Cross-root file copy |
| DAP | `ws://…/dap` | Debug Adapter Protocol WebSocket |

---

## Data Flow

### Authentication Flow

```
Browser → POST /auth/login { email, password }
       ← { token, user: { id, email, firstName, lastName } }
Browser stores token in localStorage
All subsequent requests include: Authorization: Bearer <token>
```

### Script Execution Flow

```
Browser → POST /labs/:id/scripts/run { file }
       ← SSE stream:
           data: { step, status: 'running', ... }
           data: { step, status: 'running', progress: 50, ... }
           data: { step, status: 'completed', resultId: 42 }
           [stream ends]
Browser → GET /labs/:id/results/:resultId  (fetch result files)
```

### Debug Flow

```
Browser → POST /labs/:id/scripts/debug { file }
       ← { resultId, sessionId }
Browser → WebSocket ws://…/dap?sessionId=...
       ↔ DAP messages (initialize, setBreakpoints, continue, stepOver, ...)
Browser → POST /labs/:id/debug/end { sessionId }
```

---

## Security

- **Helmet** — standard HTTP security headers
- **CORS** — configurable origin whitelist via `CORS_ORIGIN`
- **Rate limiting** — 300 requests/minute on `/api/v1/`
- **Path traversal protection** — `getSecurePath()` validates all file paths against the root
- **JWT** — stateless authentication, 7-day expiry
- **bcrypt** — 12-round password hashing
- **Graceful shutdown** — SIGINT/SIGTERM close server and DB pool

---

## Development Setup

```bash
# Prerequisites: Node.js 18+, MySQL 8+

# 1. Clone and install
git clone <repo-url>
cd measure

# 2. Backend
cd backend
cp .env.example .env   # edit with your DB credentials, JWT secret
npm install
npm run dev            # nodemon, watches src/

# 3. Frontend (in a new terminal)
cd frontend
npm install
npm run dev            # Vite dev server with HMR

# 4. Database
mysql -u root -p < backend/sql/create.sql
```

---

## Code Conventions

- **ES Modules** throughout (`import`/`export`, `"type": "module"` in package.json)
- **Functional React** — hooks only, no class components
- **Inline styles** — UI components use inline styles referencing `uiConfig.js` for consistency
- **`fetchJSON`** — all API calls go through the centralized fetch wrapper that adds JWT headers
- **Error handling** — backend uses Express error middleware; frontend uses Toast notifications
- **File naming** — PascalCase for React components, camelCase for hooks/utilities

---

## Known Limitations

- Lab data is stored on the filesystem, not in the database (no backup/replication built-in)
- File manager has a configurable depth limit for directory listing
- SQLite datasources are read-only
- No WebSocket reconnection logic in the DAP client (page refresh required)
- No real-time collaboration (single-user file editing)
