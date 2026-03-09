# Measure Backend API Reference

Base URL: `/api/v1/` (authenticated endpoints require `Authorization: Bearer <token>`)

Authentication also accepts `?token=<jwt>` query parameter (for SSE, downloads, embeds).

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | System status, version, DB info |

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

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/labs/:id/share` | Yes | Share `{userId}` |
| DELETE | `/labs/:id/share/:userId` | Yes | Unshare |

### Scripts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/:id/scripts` | Yes | List files (tree) |
| GET | `/labs/:id/scripts/content?file=…` | Yes | Read file content |
| PUT | `/labs/:id/scripts/content` | Yes | Save `{file, content}` |
| POST | `/labs/:id/scripts/upload` | Yes | Upload (multipart) |
| POST | `/labs/:id/scripts/folder` | Yes | Create folder `{path}` |
| DELETE | `/labs/:id/scripts?file=…` | Yes | Delete file |
| DELETE | `/labs/:id/scripts/folder?path=…` | Yes | Delete folder |
| GET | `/labs/:id/scripts/download?file=…` | Yes | Download (`&inline=1` for in-browser) |
| GET | `/labs/:id/scripts/folder/zip?path=…` | Yes | Download folder as ZIP |
| POST | `/labs/:id/scripts/rename` | Yes | Rename file/folder `{oldPath, newPath}` |
| POST | `/labs/:id/scripts/debug` | Yes | Create result run `{workflowFile}` |

### Results

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/labs/:id/results` | Yes | List results |
| POST | `/labs/:id/results/:rid/debug` | Yes | Execute/re-run `{debugVisible}` |
| POST | `/labs/:id/results/:rid/abort` | Yes | Abort running result |
| GET | `/labs/:id/results/:rid/files` | Yes | List result files |
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

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/clipboard` | Yes | Get current clipboard contents |
| PUT | `/clipboard` | Yes | Set clipboard (`{ type, path, apiBasePath }`) |
| DELETE | `/clipboard` | Yes | Clear clipboard |

## Paste (`/api/v1/paste`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/paste` | Yes | Copy file/folder between different roots |

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
