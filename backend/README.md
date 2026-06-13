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
| `OFFICE_ENABLED` | Enable Euro/OnlyOffice integration (`true` / `false`) |
| `DOC_SERVER_URL` | Euro/OnlyOffice Document Server base URL |
| `DOC_SERVER_JWT_SECRET` | Shared JWT secret with Document Server |
| `OFFICE_APP_URL` | Public backend URL used in DS callbacks/file URLs (optional on localhost) |
| `OFFICE_TOKEN_SECRET` | Secret for short-lived internal Office access tokens |
| `OFFICE_ACCESS_TOKEN_TTL` | Expiration for Office file/callback access tokens |
| `OFFICE_CONFIG_TOKEN_TTL` | Expiration for signed OnlyOffice config token |
| `OFFICE_FORCE_SAVE_INTERVAL_MS` | Periodic force-save interval for active edit sessions (default 30000) |
| `OFFICE_FORCE_SAVE_WAIT_TIMEOUT_MS` | Timeout when waiting for DS save callback on manual/workflow sync (default 12000) |
| `OFFICE_SESSION_PREREGISTRATION_TTL_MS` | Auto-expire pre-registered session if status=1 callback never arrives (default 120000) |
| `RATE_LIMIT_WINDOW_MS` | Optional override for `config.json.requestLimits.api.windowMs` |
| `RATE_LIMIT_MAX_PER_KEY` | Optional override for `config.json.requestLimits.api.maxPerKey` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Optional override for `config.json.requestLimits.auth.windowMs` |
| `AUTH_RATE_LIMIT_MAX_PER_IP` | Optional override for `config.json.requestLimits.auth.maxPerIp` |
| `JSON_BODY_LIMIT` | Optional override for `config.json.requestLimits.jsonBodyLimit` |
| `PERF_ACTIVE_USER_TTL_MS` | User activity window for Performance stats active users (default 30000 = 30 s) |
| `PERF_RECENT_REQUESTS_LIMIT` | Size of in-memory recent request ring buffer for Performance request details (default 500) |
| `WS_VERBOSE_LOGS` | Set to `1` to enable verbose chat WebSocket logs (default disabled) |
| `DAP_VERBOSE_LOGS` | Set to `1` to enable verbose DAP proxy logs (default disabled) |
| `EMAIL_VERBOSE_LOGS` | Set to `1` to enable verbose email subsystem info logs (default disabled) |

### `config.json`

Script execution commands, file manager settings, logging, outputs folder name. See [API.md](API.md) for details.

| Key | Default | Purpose |
|-----|---------|--------|
| `paths` | `{scripts, results}` | Folder naming |
| `scriptCommands` | See config | File extension → execution command |
| `logging` | See config | Log file names and format |
| `analysis` | See config | Timeouts and concurrency |
| `requestLimits` | See config | JSON body size + auth/API rate limit windows and maxima |
| `fileManager` | See config | File browser defaults |
| `outputsFolderName` | `"Outputs"` | Name of special outputs/template folder |

### Office Configuration Priority

Office integration values are resolved in this order:

1. `backend/.env` (or process env)
2. `backend/config.json` (`office` section)
3. `euro-office-sample-app/.env` fallback (for local dev convenience)

This means local setup works out-of-the-box if the sample app is configured and uses
the same Document Server + JWT secret.

You can verify runtime state via `GET /api/health` under `config.office`:

- `enabled` — feature toggle
- `configured` — `true` when both DS URL and JWT secret are present

#### Request limits in `config.json`

```json
{
	"requestLimits": {
		"jsonBodyLimit": "1mb",
		"auth": {
			"windowMs": 60000,
			"maxPerIp": 40
		},
		"api": {
			"windowMs": 60000,
			"maxPerKey": 1200
		}
	}
}
```

These values are shown in the frontend **Performance** tab in the **Request limits** panel.
Environment variables can still override these values for deployment-specific tuning.

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
| Performance | `/api/v1/performance` | Runtime/request metrics (`/stats`), SSE stream (`/stream`), and request details (`/requests`) |
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
