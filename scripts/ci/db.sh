#!/usr/bin/env bash
# CI database tests. Needs a Postgres superuser DSN in MM_TEST_DATABASE_URL (the workflow
# provides a service container; locally see scripts/dev/pg-up.sh). Network tests are excluded.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -z "${MM_TEST_DATABASE_URL:-}" ]; then
  echo "MM_TEST_DATABASE_URL is not set; refusing to run db tests as a silent skip." >&2
  exit 1
fi

uv sync --frozen
uv run pytest -m "(db or db_invariants) and not network"
