#!/usr/bin/env bash
# Thin wrapper for the restore-test job (dump spec section 6; plan T71, T79).
#   restore.sh <dir>   restore the downloaded dump assets in <dir> into the EMPTY database
#                      addressed by DATABASE_URL (a service container, owner role) and re-dump
#                      to compare. The restore itself uses only psql, gzip and sha256sum;
#                      pg_dump and pg_restore are neither needed nor used (AC-WF-14).
set -euo pipefail
cd "$(dirname "$0")/../.."

dir="${1:-}"
if [ -z "$dir" ] || [ ! -f "$dir/manifest.json" ]; then
  echo "usage: restore.sh <directory with manifest.json and the dump assets>" >&2
  exit 2
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi
for tool in psql gzip; do
  command -v "$tool" >/dev/null || { echo "required tool missing: $tool" >&2; exit 2; }
done
command -v sha256sum >/dev/null || { echo "required tool missing: sha256sum" >&2; exit 2; }

uv sync --frozen
uv run macro-monitor restore-test --dir "$dir"
