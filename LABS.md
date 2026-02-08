# LABS

## Overview
Labs are user-owned workspaces for data scientists to author scripts, run workflows, and inspect results. The UI is English-first; localization is deferred.

## Current Behavior (Frontend)
- **Tabs**: “My labs” and “Shared labs”.
- **My labs**
  - “+ Create Lab” and “- Remove Lab” actions above the list.
  - Selecting a lab shows detail panel for **name/description** editing.
  - **Sharing** panel lists users with multi-select checkboxes.
- **Shared labs**
  - Read-only list with an **Enter** action per lab.
- **Lab tabs**
  - Clicking **Enter** opens a new lab tab in the Labs view.
  - Each lab tab has **close (✕)** and **open in new window (▢)** controls.
  - Lab tab content shows **Tools**: File editor + SQL editor.

## Current Behavior (Backend)
- Labs are stored on disk under `backend/labs/{labId}`.
- Each lab contains:
  - `lab.json` metadata
  - `scripts/` for lab scripts
  - `results/` for lab outputs (reserved)
  - `state/` for per-user UI state
- **Access control** is enforced by owner or shared list.

## Data Model
- **Lab metadata** (`lab.json`)
  - `id`, `name`, `description`, `ownerId`, `sharedWith[]`, `createdAt`, `updatedAt`
- **Per-user state** (`state/{userId}.json`)
  - open files, active tabs, editor context (to be expanded)

## Backend Endpoints
- `GET /api/v1/labs` – list labs owned by the current user
- `GET /api/v1/labs/shared` – list labs shared with the current user
- `POST /api/v1/labs` – create a lab
- `GET /api/v1/labs/:id` – lab detail (access controlled)
- `PATCH /api/v1/labs/:id` – update name/description (owner only)
- `DELETE /api/v1/labs/:id` – remove lab (owner only)
- `POST /api/v1/labs/:id/share` – add a shared user (owner only)
- `DELETE /api/v1/labs/:id/share/:userId` – remove shared user (owner only)
- `GET /api/v1/labs/:id/state` – read user-specific state
- `PUT /api/v1/labs/:id/state` – save user-specific state
- `GET /api/v1/labs/:id/scripts` – list lab scripts (recursive tree, unlimited depth)
- `GET /api/v1/labs/:id/scripts/content` – read a script
- `PUT /api/v1/labs/:id/scripts/content` – save a script
- `POST /api/v1/labs/:id/scripts/upload` – upload a script
- `DELETE /api/v1/labs/:id/scripts` – delete a script
- `GET /api/v1/labs/:id/scripts/download` – download a script
- `GET /api/v1/labs/:id/scripts/folder/zip` – download folder as ZIP
- `DELETE /api/v1/labs/:id/scripts/folder` – delete a folder recursively
- `POST /api/v1/labs/:id/scripts/debug` – create a debug run (new result subfolder with data.json)
- `GET /api/v1/labs/:id/results` – list result subfolders with progress metadata
- `GET /api/v1/labs/:id/results/:resultId/files` – list files in a result
- `GET /api/v1/labs/:id/results/:resultId/files/content` – read a result file
- `PUT /api/v1/labs/:id/results/:resultId/files/content` – update a result file
- `GET /api/v1/labs/:id/results/:resultId/files/download` – download a result file
- `DELETE /api/v1/labs/:id/results/:resultId/files` – delete a result file
- `POST /api/v1/labs/:id/results/:resultId/files/upload` – upload a result file
- `POST /api/v1/paste` – copy file/folder across any file-manager root (generic)

## Frontend UI Structure
- **LabsTab** owns the list/detail views and the dynamic lab tabs.
- Each lab workspace tab (`LabWorkspaceTab`) has three sub-tabs:
  - **📜 Scripts** (`LabScriptsPane`) — file browser (recursive tree) + inline editors
    - 🐛 **Debug** button on `.workflow` files → creates a new result run
  - **📊 Results** (`LabResultsPane`) — result picker + file browser for output files
  - **⚙️ Settings** (`LabSettingsPane`) — lab name, description, sharing management
- **File browser** renders a proper recursive tree (not flat folder groups).
- **Copy / Paste** across any file-manager instance via global `FileClipboardProvider`.
- Opening a lab in a new window appends `?lab=<labId>&standalone=1`.

## Persistence
- Lab metadata and user state are stored on disk for durability.
- UI state should be persisted on tab changes and restored on entry (next step: wire state APIs).

## Security
- All lab endpoints require authentication.
- Owner/shared checks are enforced in backend.
- Path traversal is prevented by `getSecurePath`.

## Next Steps
- Persist editor state (open files, active tabs) via `/state` endpoints.
- Wire debug run to actual workflow execution (run scripts from workflow file).
- Add log streaming and progress polling during script execution.
- Introduce roles (read vs write) for shared labs.
