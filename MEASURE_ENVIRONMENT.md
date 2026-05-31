# Measure Environment

This document describes how cascading runtime environment configuration works in Measure.

## 1. Overview

Measure uses two configuration layers:

1. Source `environment.json` files
2. A generated runtime file (`runtime.env` or `*.env`)

At runtime, a script does not read all source files directly. It receives a ready-to-use runtime JSON as the second argument.

## 2. Where the runtime file is created

### 2.1 Running from the Scripts tab (`Run`)

When running a `.workflow` or a single script, a file is created next to the executed file:

- `full_analysis.workflow.env`
- `draw_plots.py.env`
- `prepare_data.js.env`

The file is overwritten on every run.

### 2.2 Create debugging session

When creating a debug session, the following file is created in the result:

- `results/<id>/runtime.env`

This file is used for subsequent result execution (Run/Debug from Results).
In newly created debug results, `results/<id>/environment.json` is no longer created.

## 3. Where runtime content comes from

The runtime JSON is created by deep-merging all `environment.json` files along the path:

- from the root `backend/labs`
- down to the folder where the executed file is located

Example for running this file:

- `backend/labs/4/scripts/analyzy/full_analysis.workflow`

The system takes these files in order (if they exist):

1. `backend/labs/environment.json`
2. `backend/labs/4/environment.json`
3. `backend/labs/4/scripts/environment.json`
4. `backend/labs/4/scripts/analyzy/environment.json`

It then merges them into the final runtime JSON.

## 4. Merge rules

### 4.1 Objects

Objects are merged recursively.

If the same key appears in multiple files, the closer file (deeper in the tree) has priority.

### 4.2 Arrays

If the same key is an array in both layers, the arrays are combined (`concat`).

### 4.3 Scalar values

String/number/boolean/null values are overwritten by the value from the closer layer.

## 5. What a script receives in arguments

Every script executed by the workflow engine receives:

1. `RESULT_ROOT` (argument 1)
2. `RUNTIME_ENV_PATH` (argument 2)
3. `LAB_ROOT` (argument 3)

Python example:

```python
import sys

result_root = sys.argv[1]
runtime_env_path = sys.argv[2]
lab_root = sys.argv[3]
```

Node.js example:

```js
const resultRoot = process.argv[2];
const runtimeEnvPath = process.argv[3];
const labRoot = process.argv[4];
```

R example:

```r
args <- commandArgs(trailingOnly = TRUE)
result_root <- args[1]
runtime_env_path <- args[2]
lab_root <- args[3]
```

## 6. `run` key in runtime env

After creating a debug session and after production execution (`Run`), the runtime env contains the `run` key.

`run` contains, among other fields:

- `run.workflow` (the source of steps the workflow is actually executed from)
- `run.mode` (`debug` or `production`)
- `run.workflowFile`, `run.name`, `run.author`
- internal metadata (`_usr_id`, `_workflowRoot`, `_scriptsRoot`, `_created`)

Workflow execution uses `run.workflow` from the runtime env file.

## 7. Recommended configuration structure

Typical practice:

- `backend/labs/<lab>/scripts/environment.json`: shared settings for the entire lab
- `backend/labs/<lab>/scripts/<workflow-dir>/environment.json`: overrides for a specific workflow group
- `backend/labs/<lab>/scripts/<workflow-dir>/<nested>/environment.json`: fine tuning

This lets you keep global defaults higher and specific settings lower.

## 8. Relationship to result `environment.json`

For new debug results, `environment.json` is no longer created.

Legacy/historical results may still contain `environment.json`.

However, the new runtime behavior always uses a runtime file for execution:

- `results/<id>/runtime.env` for result runs
- `*.env` next to the executed file for Scripts Run

## 9. Common mistakes

- Invalid JSON in one of the `environment.json` files.
  The runtime file is not created and execution ends with an error.

- Expecting arrays to be overwritten.
  Arrays are not overwritten; they are concatenated.

- Configuration stored too high in the tree.
  If a value is general, put it higher; if it should apply only to a specific workflow, place it closer to the executed file.

## 10. Practical checklist

- Is `environment.json` a valid JSON object?
- Is the configuration placed in the correct folder (correct priority)?
- Does the runtime file contain the expected keys?
- Is array concatenation causing unwanted duplicates?
