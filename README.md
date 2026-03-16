# Measure

**Modular Extensible Analytical Stack for a Unified Research Environment**

Browser-based analytical workbench. Users create **labs** (analysis projects), manage files, execute scripts (Python, R, Node.js, Shell), run SQL queries, and debug scripts via DAP — all from a single web UI.

## Architecture

```
Browser (:50101)
  └── React SPA (Vite)
        ├── Labs (scripts, results, settings)
        ├── SQL Editor (Monaco + AG Grid)
        └── Debug UI (DAP over WebSocket)
              │
        Vite proxy ──► Express API (:50100)
                         ├── /api/v1/auth    (JWT)
                         ├── /api/v1/labs    (CRUD, files, execution, workflow)
                         ├── /api/v1/sql     (multi-datasource SQL)
                         ├── /api/v1/users
                         ├── /api/v1/debug   (DAP session management)
                         ├── /api/v1/paste   (cross-root file copy)
                         ├── /api/v1/clipboard (per-user file clipboard)
                         └── ws://…/dap      (Debug Adapter Protocol)
                               │
                         MySQL + SQLite + filesystem (labs/)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (ES Modules) |
| Backend | Express 4, MySQL (mysql2), SQLite (better-sqlite3), JWT, bcryptjs, pino |
| Frontend | React 19, Vite 7, Monaco Editor, AG Grid, React Markdown, KaTeX |
| Debug | WebSocket DAP proxy, debugpy |
| Email | Nodemailer (password reset) |

## Quick Start

```bash
# Backend
cd backend
cp .env.example .env   # configure DB, JWT secret, etc.
npm install
npm run dev             # starts on :50100

# Frontend (new terminal)
cd frontend
cp vite.config.js.example vite.config.js   # adjust ports if needed
npm install
npm run dev             # starts on :50101, proxies API to :50100

# Database
mysql -u root -p < backend/sql/create.sql
```

## Documentation

| Document | Description |
|----------|-------------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture, modules, data flow, conventions |
| [LABS.md](LABS.md) | Labs feature spec & API reference |
| [backend/README.md](backend/README.md) | Backend setup & configuration |
| [backend/API.md](backend/API.md) | Complete API reference |
| [backend/EMAIL_TESTING.md](backend/EMAIL_TESTING.md) | Email / password-reset setup |
| [backend/PYTHON_SETUP.md](backend/PYTHON_SETUP.md) | Python venv for lab scripts |
| [frontend/README.md](frontend/README.md) | Frontend setup & design decisions |

## Key Features

- **Labs** — multi-user analysis projects with file management, script execution, result tracking
- **File Manager** — dual-pane browser with Monaco editor, image/PDF preview, drag & drop, draggable splitter
- **File Clipboard** — server-backed copy/paste of files and folders works across all browser windows/tabs of the same user
- **Script Execution** — Python, R, Node.js, Shell with real-time SSE progress
- **SQL Editor** — Monaco editor + AG Grid results against MySQL/SQLite datasources
- **DAP Debugging** — step-through debugging with breakpoints, variables, call stack
- **Clone Lab** — deep-copy any lab (own or shared) as a starting point
- **Auth** — JWT with registration, login, email password reset
- **Sharing** — labs can be shared with other users
- **Publish** — publish result files to lab's `current_output` for external access
- **Shared Libraries** — `labs/lib/scripts/` is automatically added to PYTHONPATH for all Python scripts across labs
- **Configurable Outputs** — special outputs/template folder with custom name and visual styling via `config.json`
- **Markdown & KaTeX** — render Markdown files with math formula support

## License

Internal project — not publicly licensed.
