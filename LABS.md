# Labs Feature Specification

## Overview

Labs are the core organizational unit in Measure. Each lab represents an analysis project with its own scripts, results, and settings. Labs are stored on disk (not in the database) and support multi-user sharing.

## Disk Structure

```
backend/labs/<id>/
├── lab.json          # Lab metadata
├── scripts/          # User scripts (Python, R, JS, SQL, Shell, workflows)
├── results/          # Execution results (numbered subfolders)
│   └── <resultId>/
│       ├── progress.json   # Execution status and timing
│       ├── stdout.log      # Script stdout
│       ├── stderr.log      # Script stderr
│       └── ...             # Output files
└── state/            # Per-user UI state
    └── <userId>.json
```

### `lab.json`

```json
{
  "id": "5",
  "name": "Price Analysis",
  "description": "Analyze pricing trends",
  "ownerId": 1,
  "sharedWith": [3, 7],
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-02-01T14:22:00.000Z"
}
```

## API Endpoints

All endpoints require JWT authentication. Access requires ownership or shared access.

### Lab CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/labs` | List own labs |
| GET | `/api/v1/labs/shared` | List shared labs |
| POST | `/api/v1/labs` | Create new lab |
| GET | `/api/v1/labs/:id` | Get lab metadata |
| PATCH | `/api/v1/labs/:id` | Update name/description (owner only) |
| DELETE | `/api/v1/labs/:id` | Delete lab (owner only) |
| POST | `/api/v1/labs/:id/clone` | Clone lab (deep-copy scripts, new owner) |

### Sharing

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/labs/:id/share` | Share with user |
| DELETE | `/api/v1/labs/:id/share/:userId` | Unshare |

### Scripts (File Management)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/labs/:id/scripts` | List script files |
| GET | `/api/v1/labs/:id/scripts/content?file=…` | Read file content |
| PUT | `/api/v1/labs/:id/scripts/content` | Save file content |
| POST | `/api/v1/labs/:id/scripts/upload` | Upload file |
| POST | `/api/v1/labs/:id/scripts/folder` | Create folder |
| GET | `/api/v1/labs/:id/scripts/download?file=…` | Download file (`&inline=1` for in-browser) |
| DELETE | `/api/v1/labs/:id/scripts?file=…` | Delete file |
| DELETE | `/api/v1/labs/:id/scripts/folder?path=…` | Delete folder |
| GET | `/api/v1/labs/:id/scripts/folder/zip?path=…` | Download folder as ZIP |

### Script Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/labs/:id/scripts/debug` | Create new result run from workflow |

### Results

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/labs/:id/results` | List all results |
| POST | `/api/v1/labs/:id/results/:resultId/debug` | Execute/re-run result |
| POST | `/api/v1/labs/:id/results/:resultId/abort` | Abort running result |
| GET | `/api/v1/labs/:id/results/:resultId/files` | List result files |
| GET | `/api/v1/labs/:id/results/:resultId/files/content?file=…` | Read result file |
| PUT | `/api/v1/labs/:id/results/:resultId/files/content` | Save result file |
| POST | `/api/v1/labs/:id/results/:resultId/files/upload` | Upload to result |
| GET | `/api/v1/labs/:id/results/:resultId/files/download?file=…` | Download result file (`&inline=1` for in-browser) |
| DELETE | `/api/v1/labs/:id/results/:resultId/files?file=…` | Delete result file |

### Per-User State

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/labs/:id/state` | Get UI state |
| PUT | `/api/v1/labs/:id/state` | Save UI state |
| GET | `/api/v1/labs/:id/debug-state` | Get debug (breakpoints) state |
| PUT | `/api/v1/labs/:id/debug-state` | Save debug state |

### Backup

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/labs/:id/backup` | Trigger backup |

## Frontend UI

### Lab Browser (App.jsx)

Two sub-tabs: **My Labs** and **Shared Labs**. Each lab row has **Clone** and **Enter** buttons. Double-click opens lab. My Labs has create/delete + detail/sharing panel.

### Lab Workspace (LabWorkspaceTab)

Each opened lab gets a tab with sub-panes:

- **Scripts** — file manager + inline editors (Monaco/SQL) + run/debug workflow
- **Results** — result picker + status + file browser for output files
- **Settings** — lab name, description, sharing, backup

### Key Behaviors

- **Auto-save before workflow run** — all dirty files are saved automatically
- **Browser close warning** — warns if any lab has unsaved files
- **Tab close** — only warns if the lab has unsaved files
- **Clone** — deep-copies scripts folder, creates fresh results/state, new owner

## Script Execution

Commands determined by file extension via `config.json`:

```json
{
  "scripts": {
    "commands": {
      ".py": "labs/.venv/bin/python",
      ".js": "node",
      ".sh": "bash",
      ".r": "Rscript"
    }
  }
}
```

Results are stored in numbered subfolders. Progress is tracked via `progress.json`.

## Security

- Access checks on every endpoint (owner or shared user)
- Path traversal protection on all file operations
- Owner-only: delete lab, update metadata
- Script execution sandboxed to lab directory
