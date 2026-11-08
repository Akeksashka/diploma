#!/usr/bin/env bash
# Thin wrapper for .github/workflows/ingest-manual.yml (workflows spec section 5).
#   ingest_manual.sh plan      validate MM_INPUT_PATH (dispatch) or list changed inbox files (push),
#                              resolve the manual group(s), write the plan file; needs no secret
#   ingest_manual.sh run       run `macro-monitor ingest-manual` per plan line, log to the log file;
#                              needs DATABASE_URL (the workflow maps NEON_URL_MM_INGEST to it)
#   ingest_manual.sh summary   print a markdown summary of the log (used for the commit comment)
# Inputs reach this script only as environment variables (rule A11e): MM_INPUT_PATH,
# MM_EVENT_NAME, MM_BEFORE_SHA, MM_AFTER_SHA. Plan lines are `<group_id><TAB><path or ->`.
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="${1:-}"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
plan_file="${MM_PLAN_FILE:-$work/mm-manual-plan.tsv}"
log_file="${MM_LOG_FILE:-$work/mm-manual-ingest.log}"
# Same shape as macro_monitor.settings.INBOX_PATH_PATTERN (the CLI re-validates).
path_re='^manual_inbox/[a-z0-9_]+/[0-9]{4}-(0[1-9]|1[0-2])/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'

groups_of_source() {
  uv run python -I - "$1" <<'PY'
import sys
import yaml

with open("config/sources.yaml", encoding="utf-8") as fh:
    data = yaml.safe_load(fh)
for s in data.get("sources") or []:
    if s.get("id") == sys.argv[1] and s.get("kind") == "manual" and s.get("enabled", True):
        for g in s.get("groups") or []:
            print(g["id"])
PY
}

case "$mode" in
  plan)
    : > "$plan_file"
    paths=()
    if [ "${MM_EVENT_NAME:-}" = "workflow_dispatch" ]; then
      p="${MM_INPUT_PATH:-}"
      if [ -n "$p" ]; then
        if ! [[ "$p" =~ $path_re ]]; then
          echo "invalid path: must be manual_inbox/<source_id>/<YYYY-MM>/<file>" >&2
          exit 2
        fi
        if [ ! -f "$p" ]; then
          echo "no such file in the checkout: $p" >&2
          exit 2
        fi
        paths+=("$p")
      else
        # No path: every enabled manual source, whole inbox.
        while IFS= read -r d; do
          paths+=("$d")
        done < <(find manual_inbox -mindepth 1 -maxdepth 1 -type d | sort)
      fi
    else
      before="${MM_BEFORE_SHA:-}"
      after="${MM_AFTER_SHA:?MM_AFTER_SHA is required}"
      if [[ "$before" =~ ^0+$ ]] || [ -z "$before" ] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
        changed="$(git ls-tree -r --name-only "$after" -- manual_inbox)"
      else
        changed="$(git diff --name-only --diff-filter=AM "$before" "$after" -- manual_inbox)"
      fi
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        f="${f%.meta.yaml}"   # a changed sidecar re-imports its data file
        if [[ "$f" =~ $path_re ]] && [ -f "$f" ]; then
          paths+=("$f")
        else
          echo "skipping (not an inbox data file): $f"
        fi
      done <<< "$changed"
    fi
    uv sync --frozen
    declare -A seen=()
    for p in "${paths[@]}"; do
      [ -z "${seen[$p]:-}" ] || continue
      seen[$p]=1
      if [ -d "$p" ]; then
        source_id="${p#manual_inbox/}"; arg="-"
      else
        source_id="${p#manual_inbox/}"; source_id="${source_id%%/*}"; arg="$p"
      fi
      found=0
      while IFS= read -r g; do
        [ -n "$g" ] || continue
        printf '%s\t%s\n' "$g" "$arg" >> "$plan_file"
        found=1
      done < <(groups_of_source "$source_id")
      if [ "$found" -eq 0 ]; then
        echo "no enabled manual source with id '$source_id' in config/sources.yaml (for $p)" >&2
        exit 2
      fi
    done
    echo "plan:"; cat "$plan_file"
    ;;
  run)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "DATABASE_URL is not set" >&2
      exit 1
    fi
    : > "$log_file"
    if [ ! -s "$plan_file" ]; then
      echo "nothing to ingest" | tee -a "$log_file"
      exit 0
    fi
    uv sync --frozen
    rc=0
    while IFS=$'\t' read -r group arg; do
      echo "== group $group path $arg" | tee -a "$log_file"
      args=(ingest-manual --group "$group")
      if [ "$arg" != "-" ]; then args+=(--path "$arg"); fi
      set +e
      uv run macro-monitor "${args[@]}" 2>&1 | tee -a "$log_file"
      status="${PIPESTATUS[0]}"
      set -e
      if [ "$status" -ne 0 ]; then rc="$status"; fi
    done < "$plan_file"
    exit "$rc"
    ;;
  summary)
    echo "ingest-manual run ${GITHUB_RUN_ID:-local}"
    echo
    if [ ! -f "$log_file" ]; then
      echo "No log was produced."
      exit 0
    fi
    # The CLI prints one line per imported file and one per loaded object; it does not print
    # observation row counts yet, so the counts below are objects, not rows.
    echo "- files processed: $(grep -c '^ingest-manual manual_inbox/' "$log_file" || true)"
    echo "- objects loaded: $(grep -c '^load raw_id=.*: loaded' "$log_file" || true)"
    echo "- objects with other load status: $(grep '^load raw_id=' "$log_file" | grep -vc ': loaded' || true)"
    echo
    echo '```'
    grep -E '^(ingest-manual manual_inbox/|load raw_id=|load refused)' "$log_file" | head -n 100 || true
    echo '```'
    ;;
  *)
    echo "usage: ingest_manual.sh plan|run|summary" >&2
    exit 2
    ;;
esac
