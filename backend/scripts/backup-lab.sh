#!/usr/bin/env bash
# backup-lab.sh — Create a deduplicated backup of a lab folder.
#
# Usage: ./backup-lab.sh <lab_folder_path> <backups_dir>
#
# The script:
#   1. Creates a ZIP archive of the lab folder (excluding any previous backup artifacts).
#   2. Computes the SHA-256 hash of the new ZIP.
#   3. Checks if any existing backup in <backups_dir> has an identical hash.
#   4. If a duplicate exists, the new ZIP is discarded (no duplicate backups).
#   5. Otherwise the ZIP is moved into <backups_dir> with a timestamped name.
#
# Exit codes: 0 = success (backed up or skipped duplicate), 1 = error.

set -euo pipefail

LAB_DIR="${1:?Usage: backup-lab.sh <lab_folder_path> <backups_dir>}"
BACKUPS_DIR="${2:?Usage: backup-lab.sh <lab_folder_path> <backups_dir>}"

if [ ! -d "$LAB_DIR" ]; then
  echo "Error: lab folder does not exist: $LAB_DIR" >&2
  exit 1
fi

# Ensure backups directory exists
mkdir -p "$BACKUPS_DIR"

# Extract lab id from the folder name (basename)
LAB_ID="$(basename "$LAB_DIR")"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_ZIP="$(mktemp /tmp/lab-backup-XXXXXX.zip)"
# Remove the empty temp file — zip needs to create it fresh
rm -f "$TMP_ZIP"

# Create ZIP archive (quiet mode, recurse, from parent dir, no extra attributes)
(cd "$(dirname "$LAB_DIR")" && zip -r -q -X "$TMP_ZIP" "$LAB_ID")

# Compute a content-based hash by listing the archive entries with CRCs.
# This makes the hash stable across runs with identical content, even though
# the ZIP metadata (timestamps etc.) changes.
NEW_HASH="$(unzip -lv "$TMP_ZIP" | grep -E '^\s+[0-9]' | awk '{print $7, $8}' | sort | sha256sum | awk '{print $1}')"

# Check for duplicates among existing backups for this lab
DUPLICATE=false
for existing in "$BACKUPS_DIR"/lab-"${LAB_ID}"-*.zip; do
  [ -f "$existing" ] || continue
  EXISTING_HASH="$(unzip -lv "$existing" | grep -E '^\s+[0-9]' | awk '{print $7, $8}' | sort | sha256sum | awk '{print $1}')"
  if [ "$NEW_HASH" = "$EXISTING_HASH" ]; then
    DUPLICATE=true
    break
  fi
done

if [ "$DUPLICATE" = true ]; then
  rm -f "$TMP_ZIP"
  echo "SKIPPED: Backup of lab ${LAB_ID} is identical to an existing backup — no duplicate created."
  exit 0
fi

# Move the new backup into place
DEST="$BACKUPS_DIR/lab-${LAB_ID}-${TIMESTAMP}.zip"
mv "$TMP_ZIP" "$DEST"
echo "OK: Backup created at $DEST (sha256: $NEW_HASH)"
exit 0
