#!/usr/bin/env bash
# Exports the dashboard data tree and builds the site for GitHub project pages (both languages under a prefix).
#   publish_site.sh export   `macro-monitor export` for the latest published ingest run; needs DATABASE_URL (reader role)
#   publish_site.sh build    npm ci + build:all with MM_BASE_PREFIX; writes site/dist-site (+ .nojekyll)
# The gh-pages push is a separate workflow step. Needs the full git history (export reads config at the run's git_sha).
set -euo pipefail
cd "$(dirname "$0")/../.."
step="${1:?usage: publish_site.sh export|build}"
case "$step" in
  export)
    uv sync --frozen
    ingest_run_id="$(uv run python -I - <<'PY'
import os
import psycopg
with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=30) as c:
    row = c.execute("SELECT ingest_run_id FROM analytics.v_run_published ORDER BY analysis_run_id DESC LIMIT 1").fetchone()
if row is None:
    raise SystemExit("no published analysis run")
print(int(row[0]))
PY
)"
    rm -rf export
    uv run macro-monitor export --ingest-run-id "$ingest_run_id" --out export
    ;;
  build)
    cd site
    npm ci
    EXPORT_DIR=../export/data MM_BASE_PREFIX="${PAGES_PREFIX:-/$(basename "${GITHUB_REPOSITORY:-x/diploma}")}" npm run build:all
    touch dist-site/.nojekyll
    ;;
  *)
    echo "unknown step: $step" >&2
    exit 2
    ;;
esac
