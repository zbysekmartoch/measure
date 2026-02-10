# Measure

**Modular Extensible Analytical Stack - Unfied Research Environment**

Measure is an internal browser-based analytical workbench. Authenticated users create **labs** (analysis projects), manage files, execute scripts (Python, R, Node.js, Shell), run ad-hoc SQL queries against multiple datasources, and debug scripts via DAP — all from a single web UI.

---

## Highlights

| Feature | Description |
|---------|-------------|
| **Labs** | Multi-user analysis projects with file management, script execution, and result tracking |
| **File Manager** | Dual-pane browser: recursive tree view + Monaco-powered preview / editor |
| **Script Execution** | Run Python, R, Node.js, and Shell scripts with real-time progress via SSE |
| **SQL Editor** | Monaco SQL editor with AG Grid results against MySQL and SQLite datasources |
| **Debugging** | Full DAP (Debug Adapter Protocol) integration for step-through debugging |
| **Authentication** | JWT-based auth with registration, login, and email-based password reset |
| **Sharing** | Labs can be shared with other users with read/write access |

## Architecture

```
Browser (:5173)
  ├── React SPA (Vite + HMR)
  │     ├── AuthPage (login / register / password reset)
  │     ├── Labs Tab → Lab Workspace (scripts, results, settings, SQL)
  │     ├── Settings Tab
  │     └── Debug UI (DAP over WebSocket)
  │
  └── Vite proxy ──► Express API (:3000)
                       ├── /api/health
                       ├── /api/v1/auth     (JWT)
                       ├── /api/v1/labs     (CRUD + files + execution)
                       ├── /api/v1/sql      (multi-datasource SQL)
                       ├── /api/v1/users
                       ├── /api/v1/debug
                       ├── /api/v1/paste
                       └── ws://…/dap       (Debug Adapter Protocol)
                             │
                       MySQL (:3306) + SQLite files + filesystem (labs/)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js (ES Modules) |
| **Backend** | Express 4, MySQL (mysql2), SQLite (better-sqlite3), JWT, bcrypt |
| **Frontend** | React 19, Vite 7, Monaco Editor, AG Grid, TanStack Table |
| **Debug** | WebSocket DAP proxy, custom debug UI |
| **Email** | Nodemailer (password reset flow) |
| **Logging** | Pino |

## Quick Start

```bash
# 1. Backend
cd backend
cp .env.example .env          # configure DB, JWT secret, etc.
npm install
npm run dev                   # starts on :3000

# 2. Frontend
cd frontend
npm install
npm run dev                   # starts on :5173, proxies API to :3000
```

## Documentation

| Document | Description |
|----------|-------------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Developer guide: architecture, modules, data flow, conventions |
| [LABS.md](LABS.md) | Labs feature specification and API reference |
| [backend/README.md](backend/README.md) | Backend setup, configuration, API overview |
| [backend/API.md](backend/API.md) | Complete backend API reference |
| [backend/HEALTH_CHECK.md](backend/HEALTH_CHECK.md) | Health check endpoint and monitoring |
| [backend/EMAIL_TESTING.md](backend/EMAIL_TESTING.md) | Email / password-reset testing guide |
| [backend/PYTHON_SETUP.md](backend/PYTHON_SETUP.md) | Python virtual environment setup |
| [backend/SCRIPTS_API.md](backend/SCRIPTS_API.md) | Scripts management API for frontend developers |
| [frontend/README.md](frontend/README.md) | Frontend setup, architecture, design decisions |
| [frontend/API.md](frontend/API.md) | Frontend-facing API documentation |
| [frontend/DEPLOYMENT.md](frontend/DEPLOYMENT.md) | Deployment guide (Docker, Nginx, CI/CD) |

## Datasources

Place SQL Server or SQLite datasource configs in `backend/datasources/`. See [backend/datasources/example.sqlserver.json](backend/datasources/example.sqlserver.json) for the format.

## License

Internal project — not publicly licensed.
