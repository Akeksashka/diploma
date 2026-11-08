#!/usr/bin/env bash
# Thin wrapper for .github/workflows/migrate.yml (workflows spec section 8).
#   migrate.sh check   validate MM_TARGET_VERSION, print versions; needs no secret
#   migrate.sh apply   run `macro-monitor migrate` (advisory lock, checksum check, ADR-008);
#                      needs DATABASE_URL (the workflow maps NEON_URL_MM_OWNER to it)
# MM_TARGET_VERSION is `latest` or a four-digit version. The CLI applies every pending file in
# order and cannot stop part-way, so a number is accepted only if it equals the highest file.
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="${1:-}"
target="${MM_TARGET_VERSION:-latest}"

if ! [[ "$target" =~ ^(latest|[0-9]{4})$ ]]; then
  echo "invalid target_version: must be 'latest' or four digits (for example 0011)" >&2
  exit 2
fi

highest="$(find src/macro_monitor/storage/migrations -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' \
  | sed -E 's#.*/([0-9]{4})_.*#\1#' | sort | tail -n 1)"
if [ -z "$highest" ]; then
  echo "no migration files found" >&2
  exit 2
fi

case "$mode" in
  check)
    uv sync --frozen
    echo "python: $(uv run python --version)"
    echo "uv: $(uv --version)"
    echo "macro-monitor: $(uv run macro-monitor --version)"
    echo "highest migration file: $highest"
    echo "requested target_version: $target"
    if [ "$target" != "latest" ] && [ "$target" != "$highest" ]; then
      echo "target_version $target is not the highest migration file ($highest); partial migration is not supported" >&2
      exit 2
    fi
    ;;
  apply)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "DATABASE_URL is not set" >&2
      exit 1
    fi
    uv sync --frozen
    uv run macro-monitor migrate
    ;;
  *)
    echo "usage: migrate.sh check|apply" >&2
    exit 2
    ;;
esac
