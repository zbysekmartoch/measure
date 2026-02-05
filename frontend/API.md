# Measure Frontend API Documentation

## Base Configuration

- **Base URL**: Configured via `VITE_API_BASE_URL` environment variable
- **Default**: `http://localhost:8000`
- **Content-Type**: `application/json`
- **Authentication**: JWT Bearer tokens

## Authentication Endpoints

### POST /api/v1/auth/login
Authenticate user and receive JWT.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "jwt-token",
  "user": {
    "id": 1,
    "firstName": "User",
    "lastName": "Name",
    "email": "user@example.com"
  }
}
```

### POST /api/v1/auth/register
Register new user account.

**Request Body:**
```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "password": "string"
}
```

## Analysis System

### GET /api/v1/workflows
Retrieve available analysis workflows.

**Response:**
```json
{
  "items": ["basic"]
}
```

### POST /api/v1/analyses
Create new analysis.

**Request Body:**
```json
{
  "name": "string",
  "settings": {
    "workflow": "basic",
    "mysql": {
      "host": "localhost",
      "port": 3306,
      "database": "analytics_db",
      "user": "user",
      "password": "secret"
    }
  }
}
```

### GET /api/v1/analyses
List user analyses.

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "name": "Analysis Name",
      "created_at": "2025-10-05T10:00:00Z"
    }
  ]
}
```

### GET /api/v1/results/{analysis_id}
Retrieve analysis results.

**Response:**
```json
{
  "analysis_id": 1,
  "status": "completed",
  "results": {
    "summary": {
      "rows": 50,
      "anomalies": 3
    },
    "data": [
      {
        "id": 1,
        "metric": "example",
        "value": 12.5
      }
    ]
  }
}
```

### GET /api/v1/results/{result_id}/files
List files in result folder for debugging.

**Response:**
```json
{
  "items": [
    {
      "name": "output.json",
      "path": "output.json",
      "type": "file",
      "isText": true,
      "modified": "2026-01-18T10:30:00Z",
      "size": 1234
    },
    {
      "name": "logs",
      "path": "logs",
      "type": "directory",
      "children": [
        {
          "name": "analysis.log",
          "path": "logs/analysis.log",
          "type": "file",
          "isText": true,
          "modified": "2026-01-18T10:30:00Z"
        }
      ]
    }
  ]
}
```

### GET /api/v1/results/{result_id}/files/content
Get content of a specific file in result folder.

**Query Parameters:**
- `file` - Path to the file within result folder

**Response:**
```json
{
  "content": "File content as string..."
}
```

### PUT /api/v1/results/{result_id}/files/content
Update content of a file in result folder (for debugging).

**Request Body:**
```json
{
  "file": "path/to/file.json",
  "content": "Updated file content..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "File saved"
}
```

### GET /api/v1/results/{result_id}/files/download
Download a file from result folder.

**Query Parameters:**
- `file` - Path to the file within result folder

**Response:** Binary file download

### POST /api/v1/results/{result_id}/files/upload
Upload a file to result folder (for debugging).

**Request:** Multipart form data with file and optional targetPath

**Response:**
```json
{
  "success": true,
  "message": "File uploaded"
}
```

### DELETE /api/v1/results/{result_id}/files
Delete a file from result folder.

**Query Parameters:**
- `file` - Path to the file to delete

**Response:**
```json
{
  "success": true,
  "message": "File deleted"
}
```

### POST /api/v1/results/{result_id}/debug
Re-run analysis in debug mode using existing result folder.

This endpoint allows re-running an analysis without creating a new result.
The backend will use the existing result folder and files, allowing users
to modify input files and re-execute the analysis scripts.

**Request Body:**
```json
{
  "resultId": 123,
  "debugMode": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Analysis started in debug mode",
  "resultId": 123
}
```

**Notes:**
- The `debugMode: true` flag tells the backend to reuse the existing result instead of creating a new one
- The backend should update the result status to "running" or "pending"
- All existing files in the result folder are preserved
- Analysis scripts are re-executed with the (potentially modified) input files

## SQL

### POST /api/v1/sql
Execute SQL query.

**Request Body:**
```json
{
  "query": "SELECT 1;",
  "datasource": "example.sqlserver.json"
}
```

**Response:**
```json
{
  "rows": [{"1": 1}],
  "columns": ["1"],
  "rowCount": 1
}
```

**Notes:**
- Ctrl+Enter runs the query. If text is selected, only the selection is executed.

### GET /api/v1/sql/schema
Get tables and columns for autocomplete.
### GET /api/v1/sql/datasources
List available SQL datasources.

**Response:**
```json
{
  "items": [
    { "id": "example.sqlserver.json", "label": "example.sqlserver.json", "type": "mysql" },
    { "id": "sample.sqlite", "label": "sample.sqlite", "type": "sqlite" }
  ]
}
```

**Response:**
```json
{
  "tables": [
    { "name": "analysis", "columns": [{ "name": "id", "type": "int" }] }
  ]
}
```

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": "Optional detailed error information"
  }
}
```

### Common Error Codes
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid request data
- `SERVER_ERROR` - Internal server error

## Rate Limiting

- **Default Limit**: 100 requests per minute per user
- **Header**: `X-RateLimit-Remaining` indicates remaining requests
- **Response**: 429 status code when limit exceeded

## Frontend Integration

The frontend uses `fetchJSON` utility function for all API communication:

```javascript
import { fetchJSON } from '../lib/fetchJSON.js';

// GET request
const data = await fetchJSON('/api/v1/analyses');

// POST request
const result = await fetchJSON('/api/v1/analyses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(analysisData)
});
```

### Error Handling

```javascript
try {
  const data = await fetchJSON('/api/v1/analyses');
  setRows(data.items);
} catch (error) {
  console.error('Failed to load analyses:', error);
  setError('Unable to load analyses');
}
```