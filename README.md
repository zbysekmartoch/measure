# Measure

**Modular Extensible Analytical Stack — Unified Research Environment**

Browser-based analytical workbench. Users create **labs** (analysis projects), manage files, execute scripts (Python, R, Node.js, Shell), run SQL queries, and debug scripts via DAP — all from a single web UI.

## Architecture

```
Browser (:5173)
  └── React SPA (Vite)
        ├── Labs (scripts, results, settings)
        ├── SQL Editor (Monaco + AG Grid)
        └── Debug UI (DAP over WebSocket)
              │
        Vite proxy ──► Express API (:3000)
                         ├── /api/v1/auth    (JWT)
                         ├── /api/v1/labs    (CRUD, files, execution, debug)
                         ├── /api/v1/sql     (multi-datasource SQL)
                         ├── /api/v1/users
                         ├── /api/v1/paste   (cross-root file copy)
                         └── ws://…/dap      (Debug Adapter Protocol)
                               │
                         MySQL + SQLite + filesystem (labs/)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (ES Modules) |
| Backend | Express 4, MySQL (mysql2), SQLite (better-sqlite3), JWT, bcrypt |
| Frontend | React 19, Vite 7, Monaco Editor, AG Grid |
| Debug | WebSocket DAP proxy, debugpy |
| Email | Nodemailer (password reset) |

## Quick Start

```bash
# Backend
cd backend
cp .env.example .env   # configure DB, JWT secret, etc.
npm install
npm run dev             # starts on :3000

# Frontend (new terminal)
cd frontend
npm install
npm run dev             # starts on :5173, proxies API to :3000

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
- **File Manager** — dual-pane browser with Monaco editor, image/PDF preview, drag & drop
- **Script Execution** — Python, R, Node.js, Shell with real-time SSE progress
- **SQL Editor** — Monaco editor + AG Grid results against MySQL/SQLite datasources
- **DAP Debugging** — step-through debugging with breakpoints, variables, call stack
- **Clone Lab** — deep-copy any lab (own or shared) as a starting point
- **Auth** — JWT with registration, login, email password reset
- **Sharing** — labs can be shared with other users

## License

Internal project — not publicly licensed.
