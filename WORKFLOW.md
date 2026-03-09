# Workflow Execution Architecture

This document describes the workflow execution system — the core mechanism for running
and debugging sequences of scripts within a lab result.

## Overview

The workflow system executes a sequence of scripts (Python, Node.js, Bash, R) defined
in a `data.json` file's `workflow` field. Execution can happen in two modes:

- **Run** — all scripts execute normally, no debugger
- **Debug** — Python scripts are spawned via `debugpy --wait-for-client`, the frontend
  DAP client auto-attaches for interactive stepping

Progress is streamed in real-time from backend to frontend via **Server-Sent Events (SSE)**.

## Architecture

```
┌─────────────────────────┐     POST /debug     ┌──────────────────────────────┐
│   LabResultsPane        │ ──────────────────►  │   labs.js route handler       │
│   (Run / Debug buttons) │                      │   - resolves workflow steps   │
│                         │                      │   - reads debug.json          │
│   WorkflowProgressPane  │ ◄── SSE events ───── │   - starts WorkflowRunner    │
│   (step-by-step view)   │                      │                              │
└─────────────────────────┘                      └──────────┬───────────────────┘
                                                            │
                                                            ▼
                                                 ┌──────────────────────────────┐
                                                 │   WorkflowRunner             │
                                                 │   (workflow-runner.js)       │
                                                 │                              │
                                                 │   For each step:             │
                                                 │     - emit step-start        │
                                                 │     - spawn process          │
                                                 │     - emit step-complete/fail│
                                                 │     - track timing           │
                                                 │                              │
                                                 │   Debug mode:                │
                                                 │     - spawn via debugpy      │
                                                 │     - emit debug-waiting     │
                                                 │     - wait for DAP attach    │
                                                 │     - emit debug-attached    │
                                                 └──────────────────────────────┘
```

## Data Flow

### 1. Workflow Definition

The workflow is defined in `data.json` inside the result directory:

```json
{
  "workflow": ["fetchCSV.py", "computePerimeter.py", "computeArea.py"]
}
```

Or as a reference to a `.workflow` file:

```json
{
  "workflow": "example.workflow"
}
```

`.workflow` files are plain text, one script per line. Lines starting with `#` are disabled.

### 2. Starting Execution

**POST** `/api/v1/labs/:labId/results/:resultId/debug`

Body:
```json
{
  "debugVisible": false,
  "stopOnFailure": true
}
```

Response (immediate):
```json
{
  "ok": true,
  "steps": ["fetchCSV.py", "computePerimeter.py"],
  "debugScripts": [],
  "resultId": "1",
  "stopOnFailure": true
}
```

Execution runs in the background via `WorkflowRunner`.

### 3. Real-Time Progress (SSE)

**GET** `/api/v1/labs/:labId/results/:resultId/workflow/events`

Returns a Server-Sent Events stream with these event types:

| Event | Data | Description |
|-------|------|-------------|
| `state` | Full state snapshot | Emitted after every change |
| `workflow-start` | `{ steps, totalSteps }` | Workflow begins |
| `step-start` | `{ index, name, startedAt }` | A script starts |
| `step-complete` | `{ index, name, durationMs, exitCode }` | Script succeeded |
| `step-failed` | `{ index, name, durationMs, exitCode, error }` | Script failed |
| `debug-waiting` | `{ index, name, port, status }` | Waiting for debugger attach |
| `debug-attached` | `{ index, name, status }` | Debugger attached, running |
| `debug-stopped` | `{ index, name, status }` | Paused at breakpoint in debugger |
| `workflow-complete` | `{ totalDurationMs }` | All steps finished ok |
| `workflow-failed` | `{ failedStep, error, totalDurationMs }` | Workflow stopped on failure |
| `workflow-aborted` | `{}` | User aborted the workflow |

### 4. State Snapshot

The `state` event delivers the full workflow state:

```json
{
  "labId": "5",
  "resultId": "1",
  "status": "running",
  "steps": [
    {
      "name": "fetchCSV.py",
      "status": "completed",
      "durationMs": 1234,
      "startedAt": "2026-03-04T10:00:00Z",
      "completedAt": "2026-03-04T10:00:01Z",
      "exitCode": 0,
      "error": null
    },
    {
      "name": "computePerimeter.py",
      "status": "running",
      "durationMs": null,
      "startedAt": "2026-03-04T10:00:01Z",
      "completedAt": null,
      "exitCode": null,
      "error": null
    },
    {
      "name": "computeArea.py",
      "status": "pending",
      "durationMs": null,
      "startedAt": null,
      "completedAt": null,
      "exitCode": null,
      "error": null
    }
  ],
  "currentStepIndex": 1,
  "startedAt": "2026-03-04T10:00:00Z",
  "completedAt": null,
  "debugVisible": false,
  "stopOnFailure": true
}
```

### 5. Aborting

**POST** `/api/v1/labs/:labId/results/:resultId/abort`

- Kills the running process (or debug session)
- Marks remaining steps as skipped
- Emits `workflow-aborted` event

## Step Statuses

| Status | Icon | Description |
|--------|------|-------------|
| `pending` | ○ | Not yet started |
| `running` | ● (blue, pulsing) | Currently executing |
| `completed` | ✓ (green) | Finished successfully |
| `failed` | ! (red) | Script exited with non-zero code |
| `skipped` | ⊘ (grey) | Skipped (due to earlier failure or abort) |
| `debug-waiting` | ⏳ (orange, animated) | Waiting for debugger to attach |
| `debug-stopped` | ⏸ (red, blinking) | Paused at breakpoint in debugger |

## Frontend Components

### LabResultsPane

The main Results tab UI. Contains:
- **Result selector** dropdown
- **Run** button — starts workflow without debug (`debugVisible: false`)
- **Debug** button — starts workflow with debug (`debugVisible: true`)
- **Stop on failure** checkbox — controls `stopOnFailure` parameter
- **Reset** button — shown when workflow is running, aborts execution
- **WorkflowProgressPane** — shown during/after workflow execution

### WorkflowProgressPane

A standalone component that renders the vertical progress list:
- Connects to the SSE stream via `useWorkflowEvents` hook
- Shows each step with status icon, script name, and duration
- Header bar with overall status, step counter, and total time
- Thin progress bar showing completion percentage
- Close button to hide (workflow keeps running)

### useWorkflowEvents Hook

React hook that manages the SSE connection:

```javascript
const { workflowState, isConnected } = useWorkflowEvents(labId, resultId, active);
```

- `active` controls whether to connect/disconnect
- Returns `workflowState` object matching the backend state snapshot
- Auto-reconnects on connection loss

## Backend Modules

### workflow-runner.js

The execution engine. Key exports:
- `startWorkflowRun(opts)` — creates and starts a new `WorkflowRun`
- `abortWorkflowRun(labId, resultId)` — aborts a running workflow
- `getWorkflowRun(labId, resultId)` — retrieve an active run
- `WorkflowRun` class — extends `EventEmitter`, manages the execution loop

### workflow-routes.js

SSE + REST endpoints:
- `GET /events` — SSE stream for real-time progress
- `GET /state` — current state snapshot (polling fallback)

Mounted at `/api/v1/labs/:labId/results/:resultId/workflow`.

## Debug Integration

When `debugVisible: true`:

1. Python scripts are spawned via `debugpy --wait-for-client`
2. The step status changes to `debug-waiting`
3. The frontend's `useDebugSession` auto-attaches the DAP client
4. Once attached, step status changes to `running` (or `debug-stopped` at breakpoints)
5. User can step through code using the Debug Panel
6. When the script exits, the workflow proceeds to the next step

## Configuration

### Python Command

Configured in `backend/config.json`:

```json
{
  "scriptCommands": {
    ".py": { "command": "./labs/lib/.venv/bin/python" }
  }
}
```

### Script Types

Supported script extensions and their runners:
- `.py` → Python (configurable command)
- `.js`, `.cjs` → `node`
- `.sh` → `bash`
- `.r`, `.R` → `Rscript`

### Files Generated

Each workflow run creates these files in the result directory:
- `output.log` — stdout from all scripts
- `output.err` — stderr from all scripts
- `debuger.log` — debug session lifecycle log
- `progress.json` — current progress state (for polling fallback)
