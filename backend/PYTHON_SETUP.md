# Python Environment Setup

Documentation for Python virtual environment setup for analysis scripts.

## Requirements

- **Python 3.8+** (3.12 recommended)
- **pip** (Python package manager)
- **venv** (standard part of Python 3)

## Quick Start

### Automatic Setup (Recommended)

```bash
cd scripts/analyzy
./setup-python-env.sh
```

Script automatically:
1. ✅ Checks Python 3 installation
2. ✅ Creates virtual environment in `.venv/`
3. ✅ Installs all dependencies from `requirements.txt`
4. ✅ Shows list of installed packages

### Manual Setup

```bash
cd scripts/analyzy

# Create virtual environment
python3 -m venv .venv

# Activate environment
source .venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt

# Verify installation
pip list
```

## Installed Packages

Current `requirements.txt` contains:

- **contourpy** (1.3.1) - Contour plots
- **cycler** (0.12.1) - Styling for matplotlib
- **fonttools** (4.55.0) - Font utilities
- **kiwisolver** (1.4.7) - Fast constraint solver
- **matplotlib** (3.9.2) - Plotting library
- **mysql-connector-python** (9.1.0) - MySQL database connector
- **numpy** (2.1.3) - Numerical computing
- **packaging** (24.2) - Core utilities for packages
- **pillow** (11.0.0) - Image processing
- **pyparsing** (3.2.0) - Parsing library
- **python-dateutil** (2.9.0.post0) - Date/time utilities
- **scikit-learn** (1.5.2) - Machine learning
- **scipy** (1.14.1) - Scientific computing
- **six** (1.16.0) - Python 2/3 compatibility
- **threadpoolctl** (3.6.0) - Thread pool control
- **joblib** (1.4.2) - Lightweight pipelining

## Usage

### Activate Environment

**Always activate environment before running Python scripts:**

```bash
cd scripts/analyzy
source .venv/bin/activate
```

You'll recognize it by `(.venv)` prefix in terminal:
```bash
(.venv) user@host:~/scripts/analyzy$
```

### Deactivate Environment

```bash
deactivate
```

### Run Analysis Script

```bash
# Activate environment
source .venv/bin/activate

# Run script
python plot_cenovy_odstup_b.py

# Or without activation (uses .venv/bin/python directly)
.venv/bin/python plot_cenovy_odstup_b.py
```

## Backend Integration

Backend automatically uses Python from virtual environment when running analysis scripts.

In `config.json`:
```json
{
  "scriptCommands": {
    ".py": {
      "command": "scripts/analyzy/.venv/bin/python",
      "description": "Python scripts with venv"
    }
  }
}
```

## Adding New Package

### 1. Activate environment
```bash
source .venv/bin/activate
```

### 2. Install package
```bash
pip install package-name
```

### 3. Update requirements.txt
```bash
pip freeze > requirements.txt
```

### 4. Commit to git
```bash
git add requirements.txt
git commit -m "Add package-name to Python dependencies"
git push
```

## Troubleshooting

### Python 3 not found

**Problem:**
```bash
python3: command not found
```

**Solution:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3 python3-pip python3-venv

# CentOS/RHEL
sudo yum install python3 python3-pip

# macOS
brew install python@3.12
```

### Permission Denied on setup script

**Problem:**
```bash
-bash: ./setup-python-env.sh: Permission denied
```

**Solution:**
```bash
chmod +x setup-python-env.sh
./setup-python-env.sh
```

### Import Error after installation

**Problem:**
```python
ModuleNotFoundError: No module named 'matplotlib'
```

**Solution:**
```bash
# Make sure environment is activated
source .venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### Old package version

**Problem:**
Need newer version of package

**Solution:**
```bash
source .venv/bin/activate
pip install --upgrade package-name
pip freeze > requirements.txt
```

### Virtual Environment Corruption

**Problem:**
Environment is corrupted or not working

**Solution:**
```bash
# Delete old environment
rm -rf .venv

# Create new one
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Deployment

### On Production Server

```bash
# 1. Clone repository
git clone <repository-url>
cd measure-backend/scripts/analyzy

# 2. Run setup
./setup-python-env.sh

# 3. Verify installation
source .venv/bin/activate
python --version
pip list
```

### Docker Deployment

In `Dockerfile`:

```dockerfile
FROM node:20-slim

# Install Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python environment
COPY scripts/analyzy/requirements.txt /app/scripts/analyzy/
RUN cd /app/scripts/analyzy && \
    python3 -m venv .venv && \
    .venv/bin/pip install --upgrade pip && \
    .venv/bin/pip install -r requirements.txt

# Copy rest of application
COPY . /app
RUN npm install

EXPOSE 3000
CMD ["npm", "start"]
```

### CI/CD Integration

**GitHub Actions:**

```yaml
name: Setup Python Environment

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      
      - name: Setup Python environment
        run: |
          cd scripts/analyzy
          ./setup-python-env.sh
      
      - name: Test Python scripts
        run: |
          cd scripts/analyzy
          source .venv/bin/activate
          python -c "import matplotlib; import numpy; print('OK')"
```

## Best Practices

### 1. ✅ Always Use Virtual Environment
```bash
# WRONG - global installation
pip install matplotlib

# RIGHT - into venv
source .venv/bin/activate
pip install matplotlib
```

### 2. ✅ Keep requirements.txt Updated
```bash
# After every dependency change
pip freeze > requirements.txt
git add requirements.txt
git commit -m "Update Python dependencies"
```

### 3. ✅ Version requirements.txt, not .venv
```gitignore
# .gitignore
scripts/analyzy/.venv/
scripts/analyzy/__pycache__/
*.pyc
```

### 4. ✅ Document Special Dependencies
If package requires system libraries, add to README:

```markdown
## System Dependencies

For `pillow` you need:
```bash
sudo apt-get install libjpeg-dev zlib1g-dev
```
```

### 5. ✅ Pin Versions in Production
For stable production use exact versions:

```txt
matplotlib==3.9.2
numpy==2.1.3
```

Instead of:
```txt
matplotlib>=3.9.0
numpy
```

## Virtual Environment Benefits

1. **Isolation** - Each project has its own dependencies
2. **Reproducibility** - Same versions everywhere
3. **Security** - Doesn't affect system Python
4. **Flexibility** - Different versions for different projects
5. **Deployment** - Easy server deployment

## Folder Structure

```
scripts/analyzy/
├── .venv/                    # Virtual environment (gitignore)
│   ├── bin/
│   │   ├── python           # Python interpreter
│   │   ├── pip              # Package manager
│   │   └── activate         # Activation script
│   ├── lib/
│   │   └── python3.12/
│   │       └── site-packages/  # Installed packages
│   └── pyvenv.cfg
├── __pycache__/             # Compiled Python (gitignore)
├── requirements.txt         # Dependencies list (versioned)
├── setup-python-env.sh      # Setup script (versioned)
├── dbsettings.py            # DB configuration
├── plot_*.py                # Analysis scripts
└── *.py                     # Other Python scripts
```

## Reference

- [Python venv documentation](https://docs.python.org/3/library/venv.html)
- [pip requirements.txt](https://pip.pypa.io/en/stable/reference/requirements-file-format/)
- [Virtual Environments Guide](https://packaging.python.org/guides/installing-using-pip-and-virtual-environments/)

## FAQ

**Q: Can I use virtualenv instead of venv?**  
A: Yes, but `venv` is part of Python 3 and is the recommended way.

**Q: How to update all packages?**  
A: `pip list --outdated` + `pip install --upgrade package-name`

**Q: How much space does .venv take?**  
A: About 200-500 MB depending on number of packages.

**Q: Can I share .venv between projects?**  
A: No, each project should have its own venv.

**Q: How to clear cache?**  
A: `pip cache purge` or `rm -rf ~/.cache/pip`
