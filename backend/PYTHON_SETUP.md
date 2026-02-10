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
  "scripts": {
    "commands": {
      ".py": "labs/.venv/bin/python"
    }
  }
}
```

## Adding Packages

```bash
source labs/.venv/bin/activate
pip install package-name
pip freeze > labs/requirements.txt
```

## Troubleshooting

- **`python3` not found**: `sudo apt install python3 python3-pip python3-venv`
- **ModuleNotFoundError**: Ensure venv is activated, run `pip install -r requirements.txt`
- **Corrupt venv**: Delete `.venv/` and recreate
