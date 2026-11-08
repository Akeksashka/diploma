#!/usr/bin/env bash
# Stop and remove the local Postgres container started by pg-up.sh.
set -euo pipefail

name="${MM_PG_CONTAINER:-macro-monitor-pg}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; nothing to stop." >&2
  exit 1
fi
docker rm -f "$name" >/dev/null 2>&1 || true
echo "Removed container ${name} (if it existed)."
