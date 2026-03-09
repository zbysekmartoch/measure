# Measure Frontend

React SPA for the Measure analytical workbench.

## Quick Start

```bash
npm install
npm run dev       # starts on :50101, proxies API to :50100
npm run build     # production build → dist/
npm run preview   # preview production build
```

## Tech Stack

- **React 19** with hooks, functional components only
- **Vite 7** — dev server with HMR, production builder
- **Monaco Editor** — code editing (Python, SQL, JS, JSON, etc.)
- **AG Grid** — SQL query results with sorting, filtering
- **React Markdown** — Markdown rendering with GFM support
- **KaTeX** — math formula rendering in Markdown
- **@tanstack/react-table** — table component
- **Context API** — Auth, Language, Settings, Toast, FileClipboard

## Architecture

### Tab Layout

Top-level tabs: **My Labs**, **Shared Labs**, open lab workspaces, **Settings**.
Lab tabs are dynamic — each open lab gets its own persistent tab.

### Lab Workspace (LabWorkspaceTab)

Sub-panes: Scripts, Results, Settings. Debug panel can be right/bottom/popup.

- **Scripts** — dual-pane file manager + Monaco editors for text files, SQL editor for .sql, image/PDF preview
- **Results** — result selector + run/debug controls + file browser for output files
- **Settings** — lab name, description, sharing, backup

### Key Behaviors

- **Auto-save** — dirty files saved before workflow execution
- **Browser close warning** — warns if any lab has unsaved changes
- **Tab close** — only warns when the lab has unsaved changes
- **Clone Lab** — available in both My Labs and Shared Labs
- **Standalone mode** — `?lab=<id>&standalone=1` opens lab in a popup window
- **File clipboard** — server-backed copy/paste of files and folders shared across all browser windows/tabs of the same user (including standalone lab windows)
- **Text selection** — disabled on UI chrome (tabs, buttons), enabled in editors/grids

### State Preservation

All tabs are always mounted; inactive tabs use `display: none`. This preserves:
- Editor content and cursor position
- Scroll positions and selections
- File browser expanded state

## Project Structure

```
src/
├── App.jsx                   # Root: auth gate + tab bar + lab browser
├── components/
│   ├── AuthPage.jsx          # Login / register / reset password
│   ├── ConfirmResetPasswordForm.jsx  # Password reset confirmation
│   ├── LanguageSelector.jsx  # Language switcher UI
│   ├── LoginForm.jsx         # Login form
│   ├── RegisterForm.jsx      # Registration form
│   ├── ResetPasswordForm.jsx # Password reset request form
│   ├── Toast.jsx             # Notification system
│   ├── WorkflowProgressPane.jsx  # Workflow step-by-step progress
│   ├── ZoomableImage.jsx     # Scroll-zoom + pan image viewer
│   ├── FileManagerEditor.jsx # File manager barrel export
│   └── file-manager/         # Tree browser, preview, clipboard, utils
├── context/                  # Auth, Language, Settings providers
├── debug/                    # DAP client, debug editor, debug panel, session hook
├── hooks/
│   └── useWorkflowEvents.js  # SSE workflow progress hook
├── i18n/translations.js      # cs/sk/en translations
├── lib/
│   ├── appConfig.js          # App-level constants
│   ├── fetchJSON.js          # Authenticated fetch wrapper
│   ├── uiConfig.js           # Centralized UI styles, icons, Monaco options
│   └── dirtyRegistry.js      # Global dirty-file tracking
└── tabs/
    ├── LabWorkspaceTab.jsx   # Lab container (scripts + results + settings + debug)
    ├── LabScriptsPane.jsx    # Scripts file manager + run/debug
    ├── LabResultsPane.jsx    # Results viewer
    ├── LabSettingsPane.jsx   # Lab metadata, sharing, backup
    ├── SettingsTab.jsx       # App settings
    └── SqlEditorTab.jsx      # Monaco SQL + AG Grid results
```

## Configuration

`vite.config.js` proxies `/api` to `http://localhost:50100`.

```bash
npm run dev      # Development with HMR (:50101)
npm run build    # Production build
npm run lint     # ESLint
```
