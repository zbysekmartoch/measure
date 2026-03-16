# Python Environment Setup

Python virtual environment for lab analysis scripts.

## Setup

```bash
cd backend/labs
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt    # from labs/requirements.txt
```

## Usage

```bash
# Run a script directly (no activation needed)
labs/.venv/bin/python script.py

# Or activate first
source labs/.venv/bin/activate
python script.py
```

## Backend Integration

`config.json` maps file extensions to commands:

```json
{
  "scriptCommands": {
    ".py": { "command": "./labs/.venv/bin/python", "description": "Python scripts" }
  }
}
```

## Adding Packages

```bash
source labs/.venv/bin/activate
pip install package-name
pip freeze > labs/requirements.txt
```

## Shared Libraries (`labs/lib/scripts`)

The `labs/lib/scripts/` directory is automatically added to Python's `PYTHONPATH`
during workflow execution. Scripts in any lab can import shared modules placed there:

```python
# In any lab's script:
from shared_helpers import validate_data
```

To add shared modules:
1. Create Python files in `backend/labs/lib/scripts/`
2. Scripts in any lab can import them without path manipulation
3. Add dependencies to `labs/requirements.txt`

See [WORKFLOW.md](../WORKFLOW.md#shared-library-lab-labslib) for details.

## Troubleshooting

- **`python3` not found**: `sudo apt install python3 python3-pip python3-venv`
- **ModuleNotFoundError**: Ensure venv is activated, run `pip install -r requirements.txt`
- **Corrupt venv**: Delete `.venv/` and recreate
