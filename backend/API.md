# Measure Backend API Reference

Base URL: `/api/v1/` (authenticated endpoints require `Authorization: Bearer <token>`)

Authentication also accepts `?token=<jwt>` query parameter (for SSE, downloads, embeds).

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | System status, version, DB info, config (includes `outputsFolderName`) |

`/api/health` now includes `config.office` with runtime readiness:

- `enabled`
- `configured`
- `documentServerUrl`
- `appUrl`

## Authentication (`/api/v1/auth`)

| Method | Endpoint | Auth | Body | Description |
|--------|----------|------|------|-------------|
| POST | `/auth/login` | No | `{email, password}` | Returns `{token, user}` |
| POST | `/auth/register` | No | `{firstName, lastName, email, password}` | Create user |
| GET | `/auth/me` | Yes | — | Current user profile |
| POST | `/auth/reset-password` | No | `{email}` | Send reset email |
| POST | `/auth/reset-password/confirm` | No | `{token, newPassword}` | Set new password |

## Users (`/api/v1/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users` | Yes | List all users (for lab sharing) |

## Labs (`/api/v1/labs`)

### CRUD

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs` | Yes | List own labs |
| GET | `/labs/shared` | Yes | List shared labs |
| POST | `/labs` | Yes | Create lab `{name, description}` |
| GET | `/labs/:id` | Yes | Get lab metadata |
| GET | `/labs/:id/size` | Yes | Get lab folder size (bytes) |
| PATCH | `/labs/:id` | Yes | Update name/description (owner) |
| DELETE | `/labs/:id` | Yes | Delete lab (owner) |
| POST | `/labs/:id/clone` | Yes | Clone lab `{name?}` → new lab |

### Aliases

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/aliases` | Yes | Get all lab aliases (shortName → labId) |

### Sharing

#### Lab-level (full access)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/labs/:id/share` | Yes | Share `{userId}` |
| DELETE | `/labs/:id/share/:userId` | Yes | Unshare |

#### Folder-level (partial access)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/labs/:id/folder-share` | Yes | Share a folder `{folderPath, userIds[]}` — empty `userIds` removes the entry |
| GET | `/labs/shared-folders` | Yes | List all folders shared with current user `→ { items: [{labId, labName, folders[]}] }` |

Folder-level users can perform all file operations (read, write, upload, delete, rename, Office edit) but only within their shared folder. Script and workflow execution is not available.

### Scripts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/:id/scripts` | Yes | List files (tree, supports `?subdir=...`) |
| GET | `/labs/:id/scripts/content?file=…` | Yes | Read file content |
| PUT | `/labs/:id/scripts/content` | Yes | Save `{file, content}` |
| GET | `/labs/:id/scripts/office/editor-config?file=…&mode=edit|view` | Yes | Signed Euro/OnlyOffice editor config for DOCX/XLSX |
| GET | `/labs/:id/scripts/office/active` | Yes | Active Office edit sessions in scripts (`{ sessions }`) |
| POST | `/labs/:id/scripts/office/sync?file=…` | Yes | Force-save active Office session for one scripts file |
| POST | `/labs/:id/scripts/upload` | Yes | Upload (multipart) |
| POST | `/labs/:id/scripts/folder` | Yes | Create folder `{path}` |
| DELETE | `/labs/:id/scripts?file=…` | Yes | Delete file |
| DELETE | `/labs/:id/scripts/folder?path=…` | Yes | Delete folder |
| GET | `/labs/:id/scripts/download?file=…` | Yes | Download (`&inline=1` for in-browser) |
| GET | `/labs/:id/scripts/folder/zip?path=…` | Yes | Download folder as ZIP |
| POST | `/labs/:id/scripts/rename` | Yes | Rename file/folder `{oldPath, newPath}` |
| POST | `/labs/:id/scripts/debug` | Yes | Create result run from workflow or single script `{workflowFile}`; creates `results/<id>/runtime.env` and stores run metadata in `run` |
| POST | `/labs/:id/scripts/run` | Yes | Run workflow or single script to `Outputs` `{workflowFile, stopOnFailure?}`; creates `<workflowFile>.env` next to launched file and stores run metadata in `run` |

Notes:
- `GET /labs/:id/scripts` returns a recursive tree. Recursion depth is controlled by backend config `fileManager.defaultDepth` (`0` means unlimited depth).
- Both `scripts/debug` and `scripts/run` accept `workflowFile` as either a `.workflow` file or a single script (`.py`, `.js`, `.cjs`, `.r`).
- Before workflow execution starts (`results/:rid/debug` and `scripts/run`), Measure force-saves all active Office sessions in that lab and waits for callbacks.
- `scripts/run` response includes `runtimeEnvPath` (relative path like `analysis.workflow.env`).
- `scripts/debug` response includes `runtimeEnvPath` (relative path like `results/7/runtime.env`).
- Runtime env JSON is built by cascading merge of all `environment.json` files from `backend/labs` down to the launched file directory.
- Runtime env file includes `run` metadata (`run.workflow`, `run.mode`, author, user, roots, timestamps).
- New debug results created by `scripts/debug` no longer create `results/<id>/environment.json`.

### Results

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/:id/results` | Yes | List results |
| POST | `/labs/:id/results/:rid/debug` | Yes | Execute/re-run `{debugVisible}` using `results/:rid/runtime.env` and `run.workflow` |
| POST | `/labs/:id/results/:rid/abort` | Yes | Abort running result |
| GET | `/labs/:id/results/:rid/files` | Yes | List result files |
| GET | `/labs/:id/results/:rid/files/office/editor-config?file=…&mode=edit|view` | Yes | Signed Euro/OnlyOffice editor config for DOCX/XLSX |
| GET | `/labs/:id/results/:rid/files/office/active` | Yes | Active Office edit sessions in this result (`{ sessions }`) |
| POST | `/labs/:id/results/:rid/files/office/sync?file=…` | Yes | Force-save active Office session for one result file |
| GET | `/labs/:id/results/:rid/files/content?file=…` | Yes | Read file |
| PUT | `/labs/:id/results/:rid/files/content` | Yes | Save file |
| POST | `/labs/:id/results/:rid/files/upload` | Yes | Upload |
| GET | `/labs/:id/results/:rid/files/download?file=…` | Yes | Download (`&inline=1`) |
| DELETE | `/labs/:id/results/:rid/files?file=…` | Yes | Delete file |
| POST | `/labs/:id/results/:rid/files/rename` | Yes | Rename file/folder `{oldPath, newPath}` |
| DELETE | `/labs/:id/results/:rid` | Yes | Delete entire result |

### Publish & Current Output

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/labs/:id/results/:rid/publish` | Yes | Publish file/folder to `current_output` `{path}` |
| GET | `/labs/:id/current_output` | Yes | List current_output files |
| GET | `/labs/:id/current_output/office/editor-config?file=…` | Yes | Signed Euro/OnlyOffice editor config (view-only) |
| GET | `/labs/:id/current_output/office/active` | Yes | Office session shape endpoint for current_output (normally empty) |
| GET | `/labs/:id/current_output/content?file=…` | Yes | Read current_output file |
| GET | `/labs/:id/current_output/download?file=…` | Yes | Download current_output file |
| GET | `/labs/:id/current_output/folder/zip?path=…` | Yes | Download current_output as ZIP |

### State & Debug

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET/PUT | `/labs/:id/state` | Yes | Per-user UI state |
| GET/PUT | `/labs/:id/debug-state` | Yes | Debug breakpoints state |

### Backup

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/labs/:id/backup` | Yes | Trigger backup (owner) |

## SQL (`/api/v1/sql`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/sql` | Yes | Execute query `{query, datasource?}` |
| GET | `/sql/datasources` | Yes | List datasources |
| GET | `/sql/schema?datasource=…` | Yes | Get tables + columns |

## Clipboard (`/api/v1/clipboard`)

Per-user file clipboard stored on the server. Enables copy/paste of files and folders
across all browser windows/tabs of the same authenticated user.
Synchronized via server persistence (in-memory, per-user), BroadcastChannel API, and window focus events.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/clipboard` | Yes | Get current clipboard contents |
| PUT | `/clipboard` | Yes | Set clipboard (`{ type, path, apiBasePath }`) |
| DELETE | `/clipboard` | Yes | Clear clipboard |

## Paste (`/api/v1/paste`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/paste` | Yes | Copy file/folder between different roots |

## Office Public Endpoints (`/api/office`)

These endpoints are intended for Euro/OnlyOffice Document Server only. They use short-lived
tokenized URLs generated by the authenticated `editor-config` endpoints above.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/office/file?token=…` | Token | Document bytes fetch for Document Server |
| POST | `/office/callback?token=…` | Token | Save callback from Document Server (`status` 2/6 writes file) |

## Debug (DAP)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/debug/status` | Yes | Debug session status |
| GET | `/debug/events` | Yes | SSE debug events (status, stdout, stderr, exit) |
| POST | `/debug/stop` | Yes | Kill active debug session |
| WS | `ws://…/dap` | Token | DAP WebSocket |

## Workflow

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/:id/results/:rid/workflow/events` | Yes | SSE workflow progress stream |
| GET | `/labs/:id/results/:rid/workflow/state` | Yes | Current workflow state snapshot |

## Error Format

```json
{ "error": "Error description" }
```

Status codes: 200, 201, 400, 401, 403, 404, 500
