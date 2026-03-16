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
│       ├── output.log      # Script stdout
│       ├── output.err      # Script stderr
│       └── ...             # Output files
├── current_output/   # Published result files (via publish endpoint)
└── state/            # Per-user UI state
    └── <userId>.json
```

**Outputs folder:** The outputs/template folder name is configurable via `config.json` `outputsFolderName` (default: `Outputs`). This folder is visually highlighted with purple styling and a TEMPLATE badge in the file browser UI.

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

### Aliases

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/labs/aliases` | Get all lab aliases (shortName → labId) |

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
| POST | `/api/v1/labs/:id/scripts/rename` | Rename file/folder `{oldPath, newPath}` |

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
| POST | `/api/v1/labs/:id/results/:resultId/files/rename` | Rename result file/folder |
| DELETE | `/api/v1/labs/:id/results/:resultId` | Delete entire result |

### Publish & Current Output

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/labs/:id/results/:resultId/publish` | Publish file/folder to `current_output` |
| GET | `/api/v1/labs/:id/current_output` | List current_output files |
| GET | `/api/v1/labs/:id/current_output/content?file=…` | Read current_output file |
| GET | `/api/v1/labs/:id/current_output/download?file=…` | Download current_output file |
| GET | `/api/v1/labs/:id/current_output/folder/zip?path=…` | Download current_output as ZIP |

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

### Clipboard (File Copy/Paste)

Per-user file clipboard stored on the server. Works across all browser windows/tabs.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/clipboard` | Get current clipboard contents |
| PUT | `/api/v1/clipboard` | Set clipboard `{ type, path, apiBasePath }` |
| DELETE | `/api/v1/clipboard` | Clear clipboard |

### Paste (Cross-Root Copy)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/paste` | Copy file/folder between different roots `{ sourceApi, sourcePath, targetApi, targetFolder }` |

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
  "scriptCommands": {
    ".py":  { "command": "./labs/.venv/bin/python", "description": "Python scripts" },
    ".js":  { "command": "node", "description": "Node.js scripts" },
    ".cjs": { "command": "node", "description": "Node.js scripts" },
    ".sh":  { "command": "bash", "description": "Shell scripts" },
    ".r":   { "command": "Rscript", "description": "R scripts" },
    ".R":   { "command": "Rscript", "description": "R scripts" }
  }
}
```

Results are stored in numbered subfolders. Progress is tracked via `progress.json`.

### Shared Libraries (PYTHONPATH)

The `labs/lib/scripts/` directory is automatically added to Python's `PYTHONPATH` during workflow execution. This allows Python scripts in any lab to import shared modules:

```python
# In any lab's script:
from shared_utils import load_data, process_data
```

See [WORKFLOW.md](WORKFLOW.md#shared-library-lab-labslib) for details.

## Security

- Access checks on every endpoint (owner or shared user)
- Path traversal protection on all file operations
- Owner-only: delete lab, update metadata
- Script execution sandboxed to lab directory
