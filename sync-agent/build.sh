#!/usr/bin/env bash
# Build the Sync Agent for Windows (amd64) and Linux (amd64).
# Produces small binaries by stripping debug symbols.
#
# Usage: ./build.sh
# Output: dist/syncagent.exe  (Windows)
#         dist/syncagent      (Linux)

set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist

echo "Building for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o dist/syncagent.exe .

echo "Building for Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o dist/syncagent .

echo ""
echo "Done. Binaries:"
ls -lh dist/syncagent*
