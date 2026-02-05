# Measure Backend API Documentation

Complete overview of all API endpoints for Measure Backend.

## 🔐 Authentication
**Base URL:** `/api/v1/auth`

| Endpoint | Method | Description | Auth | Request Body | Response |
|----------|--------|-------------|------|--------------|----------|
| `/login` | POST | User login | ❌ | `{email, password}` | `{token, user}` |
| `/register` | POST | Register new user | ❌ | `{firstName, lastName, email, password}` | `{message}` |
| `/me` | GET | Current user info | ✅ | - | `{id, firstName, lastName, email}` |
| `/reset-password` | POST | Password reset request (sends email) | ❌ | `{email}` | `{message}` |
| `/reset-password/confirm` | POST | Confirm new password with token | ❌ | `{token, newPassword}` | `{message}` |

**Password reset workflow:**

1. **Reset request:**
   ```json
   POST /api/v1/auth/reset-password
   {
     "email": "user@example.com"
   }
   ```
   - Backend generates JWT token with 1h expiration
   - Sends email with link to frontend
   - Always returns success (security measure)

2. **Confirm new password:**
   ```json
   POST /api/v1/auth/reset-password/confirm
   {
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "newPassword": "NewSecurePassword123"
   }
   ```
   - Backend verifies token
   - Changes password in database
   - User can login with new password

**Email configuration:**

For Gmail:
- Use App-Specific Password (generate in Google Account Security)
- EMAIL_HOST=smtp.gmail.com
- EMAIL_PORT=587
- EMAIL_SECURE=false

For other SMTP servers:
- Set EMAIL_HOST, EMAIL_PORT according to provider
- EMAIL_SECURE=true for SSL/TLS (port 465)

## 📝 Scripts Management
**Base URL:** `/api/v1/scripts`

Enables management of files in `scripts/` folder and subdirectories for internal administration.

### Security
- ✅ All endpoints require authentication
- ✅ Strict restriction to `scripts/` folder
- ✅ Path traversal protection (`.., absolute paths`)
- ✅ All paths validated using `path.resolve()`

| Endpoint | Method | Description | Auth | Request | Response |
|----------|--------|-------------|------|---------|----------|
| `/` | GET | List files and folders | ✅ | `?subdir=analyzy` | `{root, items[], count}` |
| `/download` | GET | Download file | ✅ | `?file=analyzy/script.py` | File download |
| `/content` | GET | Load text file content | ✅ | `?file=analyzy/script.py` | `{file, content, size, mtime}` |
| `/content` | PUT | Save text file changes | ✅ | `{file, content}` | `{success, file, size, mtime}` |
| `/upload` | POST | Upload new file | ✅ | FormData: `file`, `targetPath` | `{success, file{...}}` |
| `/` | DELETE | Delete file | ✅ | `?file=analyzy/script.py` | `{success, file}` |

### GET `/api/v1/scripts`
Lists files in `scripts/` folder (up to 2 levels deep).

**Query parameters:**
- `subdir` - Limit listing to subdirectory (e.g., `analyzy`, `reports`)

**Response:**
```json
{
  "root": "analyzy",
  "items": [
    {
      "name": "script.py",
      "path": "analyzy/script.py",
      "type": "file",
      "extension": ".py",
      "size": 1024,
      "mtime": "2025-11-10T10:00:00.000Z",
      "isText": true
    },
    {
      "name": "subfolder",
      "path": "analyzy/subfolder",
      "type": "directory",
      "size": 0,
      "mtime": "2025-11-10T10:00:00.000Z",
      "children": [...]
    }
  ],
  "count": 2
}
```

**Text extensions:** `.js`, `.py`, `.txt`, `.md`, `.json`, `.workflow`, `.sql`, `.sh`, `.css`, `.html`, `.xml`, `.yaml`, `.yml`, `.env`

### GET `/api/v1/scripts/download`
Downloads specific file (binary or text).

**Query:**
```
?file=analyzy/script.py
```

**Response:** File download (attachment)

### GET `/api/v1/scripts/content`
Loads text file content (UTF-8).

**Query:**
```
?file=analyzy/script.py
```

**Response:**
```json
{
  "file": "analyzy/script.py",
  "content": "#!/usr/bin/env python3\n...",
  "size": 1024,
  "mtime": "2025-11-10T10:00:00.000Z"
}
```

### PUT `/api/v1/scripts/content`
Saves changes to text file (existing files only).

**Request Body:**
```json
{
  "file": "analyzy/script.py",
  "content": "#!/usr/bin/env python3\nprint('Updated')"
}
```

**Response:**
```json
{
  "success": true,
  "file": "analyzy/script.py",
  "size": 1050,
  "mtime": "2025-11-10T10:05:00.000Z"
}
```

**Errors:**
- `404` - File not found (use upload for creating new files)

### POST `/api/v1/scripts/upload`
Uploads new file or overwrites existing.

**Request:** `multipart/form-data`
- `file` - File (max 50 MB)
- `targetPath` - Relative path to target directory (e.g., `analyzy`)

**Example (JavaScript):**
```javascript
const formData = new FormData();
formData.append('file', fileBlob, 'script.py');
formData.append('targetPath', 'analyzy');

const response = await fetch('/api/v1/scripts/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

**Response (201):**
```json
{
  "success": true,
  "file": {
    "name": "script.py",
    "path": "analyzy/script.py",
    "size": 1024,
    "mtime": "2025-11-10T10:10:00.000Z"
  }
}
```

### DELETE `/api/v1/scripts`
Deletes file.

**Query:**
```
?file=analyzy/script.py
```

**Response:**
```json
{
  "success": true,
  "file": "analyzy/script.py"
}
```

**Errors:**
- `400` - Invalid path, Path traversal attempt
- `404` - File/Directory not found

## 📊 Analyses
**Base URL:** `/api/v1/analyses`

| Endpoint | Method | Description | Auth | Request Body | Response |
|----------|--------|-------------|------|--------------|----------|
| `/config` | GET | Analysis configuration and supported types | ✅ | - | `{supportedScriptTypes, paths, logging}` |
| `/` | GET | List analyses | ✅ | - | `{items}` |
| `/` | POST | Create analysis | ✅ | `{name, settings}` | New analysis |
| `/:id` | GET | Analysis detail | ✅ | - | Analysis |
| `/:id` | PUT | Update analysis | ✅ | `{name, settings}` | Updated analysis |
| `/:id` | DELETE | Delete analysis | ✅ | - | `{success, id}` |
| `/:id/run` | POST | Run analysis | ✅ | - | `{message, resultId}` |

**Settings format (data.json):**
```json
{
  "workflow": "full-report",
  "mysql": {
    "host": "localhost",
    "port": 3306,
    "database": "analytics_db",
    "user": "user",
    "password": "secret"
  }
}
```

**Workflow can be:**
- **Name of .workflow file** (string without `\n`): `"full-report"` → loads `scripts/full-report.workflow`
- **Multi-line string**: `"script1.py\nscript2.js"` → splits into steps
- **Array of steps**: `["script1.py", "script2.js"]` → uses directly

**Comments:** Lines starting with `#` are ignored during execution but preserved in `data.json`.

**Configuration (config.json):**
- Commands for individual script types can be configured
- Paths to scripts and results folders
- Logging settings (file names, separators, etc.)
- Default timeouts and limits

**Supported script languages:**
Configured in `config.json`, default:
- `.py` - Python scripts
- `.js` - Node.js scripts  
- `.r`, `.R` - R scripts
- `.sh` - Shell scripts

**Logging:**
- Analysis results contain detailed logs: `analysis.log` and `analysis.err`
- Each workflow step is logged with timestamp
- Configurable separators and formats
- Automatic capture of stdout and stderr from individual scripts

## 📁 Results
**Base URL:** `/api/v1/results`

Management of analysis results including downloading individual files or entire ZIP archive.

| Endpoint | Method | Description | Auth | Query Params | Response |
|----------|--------|-------------|------|--------------|----------|
| `/` | GET | List analysis results | ✅ | `analysis_id` | `{items}` |
| `/:id` | GET | Result detail with progress and files | ✅ | - | Result + `progress` + `files[]` |
| `/:id` | DELETE | Delete result (DB + folder) | ✅ | - | `{success, id, message}` |
| `/:id/download` | GET | Download ZIP with all results | ✅ | - | ZIP file |
| `/:id/log` | GET | Analysis log (plain text) | ✅ | - | `text/plain` |
| `/:id/debug` | POST | Run analysis in debug mode | ✅ | - | `{id, status, mode}` |
| `/:id/files` | GET | List files in result folder | ✅ | `subdir` | `{items}` |
| `/:id/files/content` | GET | Text file content | ✅ | `file` | `{file, content}` |
| `/:id/files/content` | PUT | Save modified file | ✅ | - | `{success, file}` |
| `/:id/files/download` | GET | Download file | ✅/❌ | `file` | File download |
| `/:id/files/upload` | POST | Upload file | ✅ | - | `{success, file}` |
| `/:id/files` | DELETE | Delete file | ✅ | `file` | `{success, file}` |

### Public File Download
**Base URL:** `/api/v1/results-public`

| Endpoint | Method | Description | Auth | Response |
|----------|--------|-------------|------|----------|
| `/:id/files/:filename` | GET | Download specific DOCX/XLSX | ❌ | DOCX/XLSX file |

### GET `/api/v1/results/:id`
Returns analysis result detail including progress info and list of available DOCX and XLSX files.

**Response:**
```json
{
  "id": 1,
  "analysis_id": 5,
  "analysisName": "Basic analysis",
  "status": "running",
  "created_at": "2025-11-10T10:00:00.000Z",
  "completed_at": null,
  "output": null,
  "report": null,
  "progress": {
    "status": "running",
    "totalSteps": 5,
    "currentStep": 2,
    "currentStepName": "analyzy/histogram.py",
    "stepStartedAt": "2025-11-10T10:02:00.000Z",
    "stepElapsedMs": 15000,
    "analysisStartedAt": "2025-11-10T10:00:00.000Z",
    "analysisElapsedMs": 135000,
    "updatedAt": "2025-11-10T10:02:00.000Z"
  },
  "files": [
    {
      "name": "Manager output.docx",
      "extension": ".docx",
      "size": 45678,
      "mtime": "2025-11-10T10:05:00.000Z",
      "downloadUrl": "/api/v1/results-public/1/files/Manager%20output.docx"
    }
  ]
}
```

**Progress states:**
- `waiting` - Analysis is waiting in queue for analytical engine (another analysis is running)
- `running` - Analysis is running, `stepElapsedMs` shows current step time
- `completed` - All steps completed successfully
- `failed` - Analysis failed on some step

**Note:** Workflow execution is atomic - only one analysis can run at a time. If another analysis is already running, new analyses will wait in a queue with status `waiting` and `currentStepName: "Waiting for analytical engine"`.

### POST `/api/v1/results/:id/debug`
Runs analysis in debug mode - uses existing result and its data.json.
Does not create new DB record, only overwrites logs.

**Response (202):**
```json
{
  "id": 1,
  "analysis_id": 5,
  "status": "pending",
  "mode": "debug",
  "message": "Debug analysis started"
}
```

**Errors:**
- `404` - Result not found or data.json does not exist

### Result File Management

Each result has its own folder in `results/{id}/` with files.

**GET `/api/v1/results/:id/files`** - File list
```json
{
  "root": "",
  "items": [
    {"name": "data.json", "type": "file", "extension": ".json", "isText": true},
    {"name": "img", "type": "directory", "children": [...]}
  ],
  "count": 5
}
```

**GET `/api/v1/results/:id/files/content?file=data.json`** - File content
```json
{
  "file": "data.json",
  "content": "{\"workflow\": [...]}",
  "size": 1024,
  "mtime": "2025-11-10T10:00:00.000Z"
}
```

**PUT `/api/v1/results/:id/files/content`** - Save file
```json
// Request
{"file": "data.json", "content": "{...}"}
// Response
{"success": true, "file": "data.json", "size": 1050}
```

### GET `/api/v1/results-public/:id/files/:filename`
Downloads specific DOCX or XLSX file from analysis result. **Does not require authentication** - suitable for direct links.

**Parameters:**
- `id` - Result ID
- `filename` - File name (from `files` array)

**Response:**
- Binary file download
- Content-Type: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX)
- Content-Disposition: `attachment; filename="..."`

**Errors:**
- `400` - Invalid filename or unsupported extension
- `404` - Result or file does not exist

**Example:**
```html
<!-- Direct link in HTML -->
<a href="/api/v1/results-public/1/files/Manager%20output.docx">
  Download report
</a>
```

**JavaScript:**
```javascript
// Using downloadUrl from files array
const file = result.files[0];
window.open(file.downloadUrl); // Works without Bearer token!
```

### GET `/api/v1/results/:id/download`
Downloads all files from result as ZIP archive.

**Response:**
- ZIP archive with all files
- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="result-{id}.zip"`

### DELETE `/api/v1/results/:id`
Deletes analysis result from database and removes result folder.

**Response:**
```json
{
  "success": true,
  "id": 1,
  "message": "Result deleted successfully"
}
```

**Errors:**
- `400` - Invalid ID
- `404` - Result not found

**Note:** If folder deletion fails, operation continues and DB record is removed.

## 🔄 Workflows
**Base URL:** `/api/v1/workflows`

| Endpoint | Method | Description | Auth | Response |
|----------|--------|-------------|------|----------|
| `/` | GET | List available workflows | ✅ | `{items: ["name1", "name2"]}` |
| `/:name` | GET | Content of specific workflow | ✅ | `{name, content}` |

**Workflow files:**
- Stored in `scripts/` as `.workflow` files
- Contain list of scripts, one per line

## 🧮 SQL
**Base URL:** `/api/v1/sql`

Execute SQL queries against the selected datasource.

| Endpoint | Method | Description | Auth | Request Body | Response |
|----------|--------|-------------|------|--------------|----------|
| `/` | POST | Run SQL query | ✅ | `{query}` | `{rows, columns, rowCount}` |
| `/schema` | GET | Get tables and columns | ✅ | - | `{tables}` |
| `/datasources` | GET | List available datasources | ✅ | - | `{items}` |

**Rules:**
- Queries are executed as provided by the datasource connection.

**Example:**
```json
{
  "query": "SELECT 1;"
}
```

**Example with datasource:**
```json
{
  "query": "SELECT 1;",
  "datasource": "example.sqlserver.json"
}
```

**Schema example:**
```json
{
  "tables": [
    {
      "name": "analysis",
      "columns": [
        { "name": "id", "type": "int" }
      ]
    }
  ]
}
```

## 🔧 System
**Base URL:** `/api`

| Endpoint | Method | Description | Auth | Response |
|----------|--------|-------------|------|----------|
| `/health` | GET | Health check with system details | ❌ | Detailed information |

**Health Check Response:**
```json
{
  "ok": true,
  "service": "measure-backend",
  "version": "1.0.0",
  "build": "1.0.0",
  "server": {
    "host": "msi",
    "port": 3000,
    "nodeVersion": "v20.11.0",
    "platform": "linux",
    "uptime": 1234.56
  },
  "database": {
    "host": "81.2.236.167",
    "port": 3306,
    "name": "pricedb",
    "user": "oheroot"
  },
  "timestamp": "2025-10-14T12:34:56.789Z"
}
```

**Usage:**
- Service availability monitoring
- System diagnostics
- CI/CD health checks
- Display versions and configuration

---

## 🔒 Authentication

All endpoints marked ✅ require JWT token in header:
```
Authorization: Bearer <jwt_token>
```

## 📄 Response Formats

### Success Response
```json
{
  "items": [...],     // For lists
  "id": 123,          // For individual records
  "message": "..."    // For operation confirmations
}
```

### Error Response
```json
{
  "error": "Error description",
  "details": "Additional details"
}
```

## 🚫 HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad request
- `401` - Unauthorized
- `404` - Not found
- `500` - Server error

## 🔄 Integration Flow

### Analysis Workflow
1. Frontend creates analysis with workflow
2. Frontend runs analysis: `POST /api/v1/analyses/{id}/run`
3. Backend sequentially executes scripts from workflow
4. Results are saved to `results/{resultId}/`
5. Frontend can download ZIP with results
