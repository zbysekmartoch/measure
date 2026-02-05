# Scripts Management API

API for managing files in `scripts/` folder and subdirectories.

## 🎯 Purpose

Enables React frontend to manage scripts for analyses, reports and workflow:
- Browse files and folders
- Edit text files (`.py`, `.js`, `.workflow`, `.sql`, etc.)
- Upload/download files
- Delete files

## 🔒 Security

### Path Traversal Protection

API implements multiple layers of protection:

1. **Path normalization** - `path.normalize()` removes `..`, `./`, redundant `/`
2. **Absolute path resolution** - `path.resolve()` creates absolute path
3. **Prefix check** - Verifies resulting path starts with `SCRIPTS_ROOT`
4. **Authentication** - All endpoints require JWT token

```javascript
// ✅ Safe paths:
"analyzy/script.py"
"reports/template.docx"
"workflow.txt"

// ❌ Blocked paths:
"../../../etc/passwd"
"/etc/passwd"
"analyzy/../../secrets.txt"
```

### Authentication

All endpoints require Bearer token:

```javascript
headers: {
  'Authorization': `Bearer ${token}`
}
```

## 📂 Folder Structure

```
scripts/
├── analyzy/              # Python analysis scripts
│   ├── dbsettings.py
│   ├── plot_*.py
│   └── .venv/           # Ignored
├── reports/             # Report templates & generator
│   ├── reporter.js
│   ├── templateM.docx
│   └── templateUZ.docx
├── old-analyzy/         # Archived scripts
└── *.workflow           # Workflow definitions
```

## 🚀 Usage from React Frontend

### 1. List Files

```typescript
interface ScriptFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  size: number;
  mtime: string;
  isText?: boolean;
  children?: ScriptFile[];
}

async function listScripts(subdir?: string): Promise<ScriptFile[]> {
  const url = subdir 
    ? `/api/v1/scripts?subdir=${encodeURIComponent(subdir)}`
    : '/api/v1/scripts';
    
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${getToken()}`
    }
  });
  
  const data = await response.json();
  return data.items;
}

// Usage:
const allScripts = await listScripts();
const analysisScripts = await listScripts('analyzy');
const reportScripts = await listScripts('reports');
```

### 2. Load File Content

```typescript
async function loadFileContent(filePath: string): Promise<string> {
  const response = await fetch(
    `/api/v1/scripts/content?file=${encodeURIComponent(filePath)}`,
    {
      headers: {
        'Authorization': `Bearer ${getToken()}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to load file');
  }
  
  const data = await response.json();
  return data.content;
}

// Usage:
const scriptCode = await loadFileContent('analyzy/plot_cenovy_odstup_b.py');
```

### 3. Save Changes

```typescript
async function saveFileContent(
  filePath: string, 
  content: string
): Promise<void> {
  const response = await fetch('/api/v1/scripts/content', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file: filePath,
      content: content
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to save file');
  }
}

// Usage:
await saveFileContent(
  'analyzy/script.py',
  '#!/usr/bin/env python3\nprint("Updated")'
);
```

### 4. Upload New File

```typescript
async function uploadFile(
  file: File, 
  targetDir: string
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('targetPath', targetDir);
  
  const response = await fetch('/api/v1/scripts/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`
    },
    body: formData
  });
  
  if (!response.ok) {
    throw new Error('Upload failed');
  }
}

// Usage:
const fileInput = document.querySelector('input[type="file"]');
await uploadFile(fileInput.files[0], 'analyzy');
```

### 5. Download File

```typescript
async function downloadFile(filePath: string): Promise<void> {
  const url = `/api/v1/scripts/download?file=${encodeURIComponent(filePath)}`;
  
  // Open in new window or use fetch + blob
  window.open(url + `&token=${getToken()}`, '_blank');
  
  // Or with fetch:
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${getToken()}`
    }
  });
  
  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filePath.split('/').pop();
  a.click();
}
```

### 6. Delete File

```typescript
async function deleteFile(filePath: string): Promise<void> {
  const response = await fetch(
    `/api/v1/scripts?file=${encodeURIComponent(filePath)}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${getToken()}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Delete failed');
  }
}

// Usage with confirmation:
if (confirm('Really delete?')) {
  await deleteFile('analyzy/old_script.py');
}
```

## 🎨 React Component - Example

```tsx
import { useState, useEffect } from 'react';

function ScriptEditor() {
  const [files, setFiles] = useState<ScriptFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Load file list
  useEffect(() => {
    loadFiles();
  }, []);

  async function loadFiles() {
    const data = await listScripts('analyzy');
    setFiles(data);
  }

  // Load selected file content
  async function handleFileSelect(filePath: string) {
    setLoading(true);
    try {
      const fileContent = await loadFileContent(filePath);
      setSelectedFile(filePath);
      setContent(fileContent);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Save changes
  async function handleSave() {
    if (!selectedFile) return;
    
    setLoading(true);
    try {
      await saveFileContent(selectedFile, content);
      alert('Saved!');
    } catch (err) {
      alert('Error saving');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="script-editor">
      <aside className="file-list">
        <h3>Scripts</h3>
        {files.map(file => (
          <div 
            key={file.path}
            onClick={() => file.isText && handleFileSelect(file.path)}
            className={file.path === selectedFile ? 'selected' : ''}
          >
            {file.name}
          </div>
        ))}
      </aside>
      
      <main className="editor">
        {selectedFile && (
          <>
            <header>
              <h2>{selectedFile}</h2>
              <button onClick={handleSave} disabled={loading}>
                Save
              </button>
            </header>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={loading}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

## 📋 Supported Formats

### Text files (editable)
- `.js` - JavaScript
- `.py` - Python
- `.sql` - SQL
- `.workflow` - Workflow definition
- `.txt` - Plain text
- `.md` - Markdown
- `.json` - JSON
- `.sh` - Shell script
- `.css`, `.html`, `.xml`
- `.yaml`, `.yml`
- `.env`

### Binary files (download/upload only)
- `.docx` - Word documents
- `.png`, `.jpg` - Images
- Other formats

## ⚠️ Limitations

- **File size:** Max 50 MB
- **Recursion depth:** 2 levels when listing
- **Authentication:** Required for all operations
- **Scope:** Only `scripts/` folder

## 🔍 Error Handling

```typescript
try {
  await saveFileContent('analyzy/script.py', content);
} catch (error) {
  if (error.status === 400) {
    // Invalid path / Path traversal
  } else if (error.status === 404) {
    // File not found
  } else if (error.status === 401) {
    // Unauthorized - redirect to login
  } else {
    // Server error
  }
}
```

## 🛡️ Best Practices

1. **Always validate paths** - Use `encodeURIComponent()` for parameters
2. **Check isText flag** - Verify file is text before editing
3. **Backup before deleting** - Allow download before DELETE
4. **Autosave** - Implement debounced autosave for editing
5. **Syntax highlighting** - Use Monaco Editor or CodeMirror
6. **Diff view** - Show changes before saving

## 📚 Reference

- [API Documentation](./API.md#-scripts-management)
- [Multer Documentation](https://github.com/expressjs/multer)
- [Path Security Best Practices](https://owasp.org/www-community/attacks/Path_Traversal)
