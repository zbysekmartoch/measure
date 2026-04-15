set -e

LIB=/home/u1/projects/uohs/measure/backend/labs/lib/R
SRC=/home/u1/projects/uohs/measure/backend/labs/lib/scripts/R

for pkg in "$SRC"/*; do
  if [ -f "$pkg/DESCRIPTION" ]; then
    echo "Installing $(basename "$pkg")"
    R CMD INSTALL -l "$LIB" "$pkg"
  fi
done

echo "All packages installed"
