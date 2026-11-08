#!/usr/bin/env bash
# Thin wrapper for .github/workflows/decide.yml (workflows spec section 11).
#   decide.sh check   validate the MM_IN_* dispatch inputs against allow-lists; needs no secret
#   decide.sh apply   validate again, run `macro-monitor decide` (decided_by = MM_ACTOR), then
#                     `macro-monitor load --drain`; needs DATABASE_URL (NEON_URL_MM_INGEST)
# Inputs arrive only through the environment and are passed to the CLI as separate argv words
# (never through a shell string), after being matched against fixed patterns.
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="${1:-}"
kind="${MM_IN_KIND:-}"
decision="${MM_IN_DECISION:-}"
event_id="${MM_IN_EVENT_ID:-}"
raw_id="${MM_IN_RAW_ID:-}"
series_id="${MM_IN_SERIES_ID:-}"
ref_period_start="${MM_IN_REF_PERIOD_START:-}"
known_at="${MM_IN_KNOWN_AT:-}"
note="${MM_IN_NOTE:-}"
actor="${MM_ACTOR:-}"

fail() {
  echo "invalid input: $1" >&2
  exit 2
}

int_re='^[0-9]{1,18}$'
date_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ts_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
actor_re='^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
note_re="^[A-Za-z0-9 .,;:()/_'+=%-]+\$"

validate() {
  [[ "$kind" =~ ^(drift|override)$ ]] || fail "kind must be drift or override"
  [[ "$decision" =~ ^(accepted|rejected|skip_object|exclude|include)$ ]] \
    || fail "decision must be accepted, rejected, skip_object, exclude or include"
  [[ "$actor" =~ $actor_re ]] || fail "actor is not a GitHub login"
  [ -z "$event_id" ] || [[ "$event_id" =~ $int_re ]] || fail "event_id must be an integer"
  [ -z "$raw_id" ] || [[ "$raw_id" =~ $int_re ]] || fail "raw_id must be an integer"
  [ -z "$series_id" ] || [[ "$series_id" =~ $int_re ]] || fail "series_id must be an integer"
  [ -z "$ref_period_start" ] || [[ "$ref_period_start" =~ $date_re ]] \
    || fail "ref_period_start must be YYYY-MM-DD"
  [ -z "$known_at" ] || [[ "$known_at" =~ $ts_re ]] \
    || fail "known_at must be YYYY-MM-DDTHH:MM:SSZ (UTC)"
  [ -z "$note" ] || [[ "$note" =~ $note_re && ${#note} -le 500 ]] || fail "note: 1-500 plain characters"
  case "$kind:$decision" in
    drift:accepted | drift:rejected)
      [ -n "$event_id" ] || fail "event_id is required for a drift decision"
      ;;
    drift:skip_object)
      [ -n "$raw_id" ] || fail "raw_id is required for skip_object"
      ;;
    override:exclude | override:include)
      [ -n "$series_id" ] && [ -n "$ref_period_start" ] \
        || fail "series_id and ref_period_start are required for an override"
      [ -n "$note" ] || fail "note (the reason) is required for an override"
      ;;
    *)
      fail "decision $decision does not apply to kind $kind"
      ;;
  esac
}

validate

case "$mode" in
  check)
    echo "inputs valid: kind=$kind decision=$decision decided_by=$actor"
    ;;
  apply)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "DATABASE_URL is not set" >&2
      exit 1
    fi
    args=(--kind "$kind" --decision "$decision" --decided-by "$actor" --decided-on "$(date -u +%F)")
    [ -z "$event_id" ] || args+=(--event-id "$event_id")
    [ -z "$raw_id" ] || args+=(--raw-id "$raw_id")
    [ -z "$series_id" ] || args+=(--series-id "$series_id")
    [ -z "$ref_period_start" ] || args+=(--ref-period-start "$ref_period_start")
    [ -z "$known_at" ] || args+=(--known-at "$known_at")
    [ -z "$note" ] || args+=(--note "$note")
    uv sync --frozen
    uv run macro-monitor decide "${args[@]}"
    uv run macro-monitor load --drain
    ;;
  *)
    echo "usage: decide.sh check|apply" >&2
    exit 2
    ;;
esac
