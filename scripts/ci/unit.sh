#!/usr/bin/env bash
# CI unit tests: offline, no database. Network tests are never selected.
set -euo pipefail
cd "$(dirname "$0")/../.."

uv sync --frozen
uv run pytest tests/unit -m "unit and not network and not db and not db_invariants"
