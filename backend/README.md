# Measure Backend

Express API server for the Measure analytical workbench.

## Setup

```bash
cp .env.example .env    # configure DB, JWT secret, email
npm install
npm run dev             # nodemon, watches src/
```

### Database

```bash
mysql -u root -p < sql/create.sql
```

### Python Environment (for lab scripts)

```bash
cd labs
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt    # from labs/requirements.txt
```

See [PYTHON_SETUP.md](PYTHON_SETUP.md) for details.

## Configuration

### `.env`

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | Environment (`development`, `production`) |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL connection |
| `JWT_SECRET` | JWT signing secret |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` | SMTP for password reset |
| `EMAIL_SECURE` | `true` or `false` for TLS |
| `EMAIL_FROM` | Sender address |
| `FRONTEND_URL` | Frontend URL for reset links |

### `config.json`

Script execution commands, file manager settings, logging. See [API.md](API.md) for details.

## Architecture

- **Express 4** with ES Modules
- **MySQL** (mysql2/promise) for users and password resets
- **SQLite** (better-sqlite3) for read-only datasource queries
- **Labs on disk** — `labs/<id>/` folders with scripts, results, state
- **DAP proxy** — WebSocket bridge to debugpy for Python debugging
- **JWT auth** — stateless, 7-day expiry, bcryptjs hashing
- **Backup scheduler** — periodic automated lab backups
- **Logging** — pino + pino-http structured JSON logging
- **Security** — Helmet, CORS, rate limiting, path traversal protection

## API Overview

See [API.md](API.md) for the complete reference.

| Group | Prefix | Description |
|-------|--------|-------------|
| Health | `/api/health` | System status (public) |
| Auth | `/api/v1/auth` | Login, register, password reset |
| Labs | `/api/v1/labs` | CRUD, sharing, clone, files, execution, workflow, publish |
| SQL | `/api/v1/sql` | Execute queries, datasources, schema |
| Users | `/api/v1/users` | List users (for sharing) |
| Clipboard | `/api/v1/clipboard` | Per-user file clipboard (GET/PUT/DELETE) |
| Paste | `/api/v1/paste` | Cross-root file copy |
| Debug | `/api/v1/debug` | Debug session status, events, stop |
| Workflow | `/api/v1/labs/:id/results/:rid/workflow` | SSE progress, state |
| DAP | `ws://…/dap` | Debug Adapter Protocol WebSocket |

## Project Structure

```
├── src/
│   ├── index.js           # Server entry point
│   ├── config.js           # Environment config loader
│   ├── db.js              # MySQL connection pool
│   ├── debug/             # DAP debug proxy
│   │   ├── dap-proxy.js   # WebSocket ↔ debugpy bridge
│   │   ├── debug-engine.js # Debug session lifecycle
│   │   └── debug-routes.js # REST + SSE debug endpoints
│   ├── middleware/
│   │   ├── auth.js        # JWT auth (header + query param)
│   │   └── error.js       # Global error handler
│   ├── routes/
│   │   ├── index.js       # Main router (health, paste, mounts)
│   │   ├── auth.js        # Authentication
│   │   ├── labs.js        # Labs (1600+ lines)
│   │   ├── sql.js         # SQL execution
│   │   └── users.js       # User listing
│   ├── utils/
│   │   ├── backup-scheduler.js  # Periodic automated lab backups
│   │   ├── email.js       # Nodemailer
│   │   └── file-manager.js # File utilities
│   └── workflow/
│       ├── workflow-routes.js  # SSE + REST workflow endpoints
│       └── workflow-runner.js  # Workflow execution engine
├── labs/                  # Lab data (gitignored)
├── backups/               # Backups (gitignored)
├── datasources/           # SQL connection configs
├── sql/                   # DDL scripts
└── config.json            # Runtime configuration
```
