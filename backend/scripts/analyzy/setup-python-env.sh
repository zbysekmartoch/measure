#!/bin/bash
# Setup script pro Python virtual environment a dependencies

echo "=== Python Environment Setup ==="
echo ""

# Zkontroluj že jsme ve správném adresáři
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Zkontroluj Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "   Install Python 3.8+ and try again"
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "✓ Found: $PYTHON_VERSION"
echo ""

# Zkontroluj pip
if ! python3 -m pip --version &> /dev/null; then
    echo "❌ Error: pip is not installed"
    echo "   Install pip and try again"
    exit 1
fi

# Vytvoř venv pokud neexistuje
if [ ! -d ".venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create virtual environment"
        exit 1
    fi
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi

echo ""

# Aktivuj venv
echo "🔧 Activating virtual environment..."
source .venv/bin/activate

# Upgrade pip
echo "📦 Upgrading pip..."
pip install --upgrade pip --quiet

# Zkontroluj requirements.txt
if [ ! -f "requirements.txt" ]; then
    echo "❌ Error: requirements.txt not found"
    echo "   Create requirements.txt with required packages"
    exit 1
fi

# Nainstaluj dependencies
echo "📦 Installing Python packages from requirements.txt..."
echo ""
pip install -r requirements.txt

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Failed to install some packages"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "✓ Python environment is ready"
echo "✓ Virtual environment: .venv/"
echo ""
echo "Installed packages:"
pip list --format=columns

echo ""
echo "To activate the environment manually:"
echo "  source .venv/bin/activate"
echo ""
