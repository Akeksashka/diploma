#!/usr/bin/env bash
# CI lint and type gate: ruff check, ruff format --check, mypy --strict src.
set -euo pipefail
cd "$(dirname "$0")/../.."

uv sync --frozen
uv run ruff check
uv run ruff format --check
uv run mypy --strict src
