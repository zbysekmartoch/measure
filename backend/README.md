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
| `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL connection |
| `JWT_SECRET` | JWT signing secret |
| `CORS_ORIGIN` | Allowed CORS origins |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` | SMTP for password reset |
| `FRONTEND_URL` | Frontend URL for reset links |

### `config.json`

Script execution commands, file manager settings, logging. See [API.md](API.md) for details.

## Architecture

- **Express 4** with ES Modules
- **MySQL** (mysql2/promise) for users and password resets
- **SQLite** (better-sqlite3) for read-only datasource queries
- **Labs on disk** — `labs/<id>/` folders with scripts, results, state
- **DAP proxy** — WebSocket bridge to debugpy for Python debugging
- **JWT auth** — stateless, 7-day expiry, bcrypt hashing
- **Security** — Helmet, CORS, rate limiting, path traversal protection

## API Overview

See [API.md](API.md) for the complete reference.

| Group | Prefix | Description |
|-------|--------|-------------|
| Health | `/api/health` | System status (public) |
| Auth | `/api/v1/auth` | Login, register, password reset |
| Labs | `/api/v1/labs` | CRUD, sharing, clone, files, execution, debug |
| SQL | `/api/v1/sql` | Execute queries, datasources, schema |
| Users | `/api/v1/users` | List users (for sharing) |
| Paste | `/api/v1/paste` | Cross-root file copy |
| DAP | `ws://…/dap` | Debug Adapter Protocol WebSocket |

## Project Structure

```
├── src/
│   ├── index.js           # Server entry point
│   ├── config.js           # Environment config loader
│   ├── db.js              # MySQL connection pool
│   ├── debug/             # DAP debug proxy
│   ├── middleware/
│   │   ├── auth.js        # JWT auth (header + query param)
│   │   └── error.js       # Global error handler
│   ├── routes/
│   │   ├── auth.js        # Authentication
│   │   ├── labs.js        # Labs (1300+ lines)
│   │   ├── sql.js         # SQL execution
│   │   └── users.js       # User listing
│   └── utils/
│       ├── email.js       # Nodemailer
│       └── file-manager.js # File utilities
├── labs/                  # Lab data (gitignored)
├── backups/               # Backups (gitignored)
├── datasources/           # SQL connection configs
├── sql/                   # DDL scripts
└── config.json            # Runtime configuration
```
