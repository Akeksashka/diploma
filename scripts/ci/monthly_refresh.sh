#!/usr/bin/env bash
# Thin wrapper for .github/workflows/monthly-refresh.yml (workflows spec section 4; T74).
#   monthly_refresh.sh plan      validate inputs, derive the mode, warm up Neon, sync-config (not on a
#                                dry run), `macro-monitor plan`, write the job outputs;
#                                needs DATABASE_URL (the workflow maps NEON_URL_MM_INGEST to it)
#   monthly_refresh.sh fetch     `macro-monitor fetch --group $MM_GROUP`; needs DATABASE_URL (ingest)
#   monthly_refresh.sh load      `macro-monitor load --drain`; needs DATABASE_URL (ingest)
#   monthly_refresh.sh analyze   `macro-monitor analyze`; needs DATABASE_URL (the analytics role)
# Inputs reach this script only as environment variables (rule A11e): MM_EVENT_NAME, MM_SCHEDULE,
# MM_INPUT_MODE, MM_INPUT_GROUPS, MM_INPUT_DRY_RUN (plan); MM_GROUP, MM_MODE (fetch).
# Job outputs are appended to $GITHUB_OUTPUT (stdout when unset).
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="${1:-}"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
out_file="${GITHUB_OUTPUT:-/dev/stdout}"
group_re='^[a-z0-9_]+$'

need_db() {
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
}

case "$mode" in
  plan)
    need_db
    # --- mode: schedule decides on a scheduled run, the input on a dispatch ------------------
    if [ "${MM_EVENT_NAME:-}" = "schedule" ]; then
      case "${MM_SCHEDULE:-}" in
        "23 4 1 * *") run_mode=refresh ;;
        "23 4 4 * *") run_mode=catchup ;;
        *) echo "unknown schedule: ${MM_SCHEDULE:-}" >&2; exit 2 ;;
      esac
      dry_run=false
      groups_filter=""
    else
      run_mode="${MM_INPUT_MODE:-refresh}"
      if [ "$run_mode" != "refresh" ] && [ "$run_mode" != "catchup" ]; then
        echo "invalid mode: must be refresh or catchup" >&2
        exit 2
      fi
      dry_run="${MM_INPUT_DRY_RUN:-false}"
      if [ "$dry_run" != "true" ] && [ "$dry_run" != "false" ]; then
        echo "invalid dry_run: must be true or false" >&2
        exit 2
      fi
      groups_filter="${MM_INPUT_GROUPS:-}"
      if ! [[ "$groups_filter" =~ ^[a-z0-9_,]*$ ]]; then
        echo "invalid groups: only a-z, 0-9, underscore and comma are allowed" >&2
        exit 2
      fi
    fi
    uv sync --frozen
    # --- Neon warm-up with retry (a suspended compute needs a few seconds) --------------------
    uv run python -I - <<'PY'
import os
import sys
import time

import psycopg

for attempt in range(1, 7):
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=30) as conn:
            conn.execute("SELECT 1")
        print(f"warm-up ok (attempt {attempt})")
        sys.exit(0)
    except psycopg.Error:
        print(f"warm-up attempt {attempt} failed", file=sys.stderr)
        time.sleep(min(5 * attempt, 30))
print("database not reachable", file=sys.stderr)
sys.exit(1)
PY
    if [ "$dry_run" = "false" ]; then
      uv run macro-monitor sync-config
    else
      echo "dry run: sync-config skipped (it writes ref.*)"
    fi
    plan_json="$work/mm-refresh-plan.json"
    uv run macro-monitor plan --mode "$run_mode" > "$plan_json"
    MM_PLAN_JSON="$plan_json" MM_FILTER="$groups_filter" MM_DRY_RUN="$dry_run" \
      uv run python -I - >> "$out_file" <<'PY'
import json
import os
import sys

plan = json.load(open(os.environ["MM_PLAN_JSON"], encoding="utf-8"))
wanted = [g for g in os.environ["MM_FILTER"].split(",") if g]
dry = os.environ["MM_DRY_RUN"] == "true"
include = list(plan["fetch_matrix"]["include"])
load_groups = [g for g in plan["load_groups"].split(",") if g]
if wanted:
    known = {leg["group"] for leg in include} | set(load_groups)
    unknown = [g for g in wanted if g not in known]
    if unknown:
        print(f"groups not in the plan: {', '.join(unknown)}", file=sys.stderr)
        sys.exit(2)
    include = [leg for leg in include if leg["group"] in wanted]
    load_groups = [g for g in load_groups if g in wanted]
if dry:
    # The CLI has no fetch/load dry-run (gap): a dry run plans only, so nothing is fetched,
    # archived, loaded, analysed or published.
    include, load_groups = [], []
print(f"fetch_matrix={json.dumps({'include': include}, sort_keys=True)}")
print(f"has_fetch={'true' if include else 'false'}")
print(f"load_groups={','.join(load_groups)}")
print(f"run_id={plan['run_id']}")
print(f"release_tag={plan.get('release_tag') or ''}")
print(f"mode={plan['mode']}")
print(f"dry_run={'true' if dry else 'false'}")
PY
    ;;
  fetch)
    need_db
    group="${MM_GROUP:-}"
    run_mode="${MM_MODE:-refresh}"
    if ! [[ "$group" =~ $group_re ]]; then
      echo "invalid group id" >&2
      exit 2
    fi
    if [ "$run_mode" != "refresh" ] && [ "$run_mode" != "catchup" ]; then
      echo "invalid mode" >&2
      exit 2
    fi
    uv sync --frozen
    uv run macro-monitor fetch --group "$group" --mode "$run_mode"
    ;;
  load)
    need_db
    uv sync --frozen
    uv run macro-monitor load --drain
    ;;
  analyze)
    need_db
    uv sync --frozen
    uv run macro-monitor analyze
    ;;
  *)
    echo "usage: monthly_refresh.sh plan|fetch|load|analyze" >&2
    exit 2
    ;;
esac
