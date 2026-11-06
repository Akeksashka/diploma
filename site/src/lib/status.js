// V5 data freshness and status: pure view-model over status.json (export spec section 5). Display
// only (D6): every count is shown as exported, nothing is recomputed. Every field is read through a
// whitelist, so a stray field of the document (for example an error message) is never rendered.
// Free text of the export is shown only where it is a fixed text of the producer (the monthly check).
// No imports except the version check.
import {BACKLOG_NOTE, COUNTS_NOTE, COV01_NOT_YET, COV01_NOTE, LOAD_LABELS, LOAD_NOTE, NOT_EXPORTED, NOT_SHOWN, NO_ANALYSIS_RUN, NO_WINDOW, STATE_LABELS, UNKNOWN_STATE, WINDOW_NOTE} from "./copy.js";
import {SUPPORTED_MAJORS, manifestMajor} from "./manifest.js";
import {feedState} from "./states.js";

export {BACKLOG_NOTE, COUNTS_NOTE, COV01_NOT_YET, COV01_NOTE, LOAD_LABELS, LOAD_NOTE, NOT_EXPORTED, NOT_SHOWN, NO_ANALYSIS_RUN, NO_WINDOW, STATE_LABELS, UNKNOWN_STATE, WINDOW_NOTE}; // fixed texts: copy.js

export class StatusError extends Error {
  constructor(message) {
    super(message);
    this.name = "StatusError";
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const int = (v) => (Number.isInteger(v) ? v : null);
export const withThousands = (n) => (Number.isInteger(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "n/a");
const count = (v) => (Number.isInteger(v) ? withThousands(v) : "n/a");
// Dates and instants are shown only when they have the exported ISO form; anything else is not shown.
const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const when = (v) => (typeof v === "string" && ISO.test(v) ? v : v == null ? "n/a" : NOT_SHOWN);
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const code = (v) => (typeof v === "string" && CODE.test(v) ? v : NOT_SHOWN);

export function parseStatus(doc) {
  if (!isObj(doc)) throw new StatusError("status.json is not an object");
  const major = manifestMajor(doc.schema_version);
  if (major === null || !SUPPORTED_MAJORS.includes(major)) throw new StatusError(`status.json has an unsupported schema_version: ${JSON.stringify(doc.schema_version ?? null)}`);
  for (const k of ["last_run", "backlog", "validation", "schedule_check"]) if (!isObj(doc[k])) throw new StatusError(`status.json has no "${k}" object`);
  for (const k of ["groups", "manual_sources"]) if (!Array.isArray(doc[k])) throw new StatusError(`status.json has no "${k}" list`);
  return doc;
}

export function statusView(doc) {
  const s = parseStatus(doc);
  const lr = s.last_run;
  const alerts = int(lr.alerts_opened);
  const v = s.validation;
  const drift = isObj(v.open_drift) ? v.open_drift : {};
  const byKind = isObj(drift.by_kind) ? drift.by_kind : {};
  return {
    lastRun: {
      id: int(lr.ingest_run_id) === null ? "n/a" : String(lr.ingest_run_id),
      mode: code(lr.mode),
      started: when(lr.started_at),
      finished: when(lr.finished_at),
      newRawObjects: count(lr.new_raw_objects),
      newObservations: count(lr.new_observations),
      revisions: count(lr.revisions)
    },
    // Active alerts = `last_run.alerts_opened` (published watch or alert rows of the run's analysis).
    alerts: {value: alerts === null ? NO_ANALYSIS_RUN : count(alerts), none: alerts === null},
    // Most severe stored state first (broken, stale, late, unrecognised, fresh); the exported order is kept within a state.
    groups: s.groups.filter(isObj).map((g, i) => ({
      source: code(g.source_group),
      series: code(g.series_group),
      state: feedState(g.state).key,
      stateLabel: feedState(g.state).code,
      feed: feedState(g.state),
      order: i,
      expected: when(g.expected_period_end),
      latest: when(g.latest_period_end),
      evaluated: when(g.evaluated_at),
      load: Object.hasOwn(LOAD_LABELS, g.load_result) ? LOAD_LABELS[g.load_result] : NOT_EXPORTED
    })).sort((a, b) => Number(a.feed.rank > b.feed.rank) || -Number(a.feed.rank < b.feed.rank) || Number(a.order > b.order) || -Number(a.order < b.order)),
    backlog: {
      unloaded: count(s.backlog.n_unloaded),
      oldest: int(s.backlog.oldest_age_days) === null ? "none" : `${withThousands(s.backlog.oldest_age_days)} days`
    },
    counts: (Array.isArray(v.counts) ? v.counts : []).filter(isObj).map((c) => ({family: code(c.check_family), severity: code(c.severity), results: count(c.n_results), failed: count(c.n_failed)})),
    cov01: (Array.isArray(v.cov01) ? v.cov01 : []).filter(isObj).map((c) => {
      const notYet = c.state === "not_yet_measurable";
      const measured = c.state === "measured";
      return {
        indicator: c.indicator_id == null ? "all" : code(c.indicator_id),
        state: notYet ? "not_yet_measurable" : measured ? "measured" : "unknown",
        stateLabel: notYet ? COV01_NOT_YET : measured ? "measured" : UNKNOWN_STATE,
        qualifying: count(c.n_qualifying),
        results: measured ? count(c.n_results) : "n/a",
        failed: measured ? count(c.n_failed) : "n/a"
      };
    }),
    drift: {open: count(drift.n_open), kinds: Object.keys(byKind).sort().map((k) => ({kind: code(k), n: count(byKind[k])}))},
    manual: s.manual_sources.filter(isObj).map((m) => {
      const w = isObj(m.next_expected) ? m.next_expected : null;
      return {
        source: code(m.source_id),
        lastEdition: when(m.last_edition_date),
        lastIngested: when(m.last_ingested_at),
        next: w === null ? NO_WINDOW : `between ${when(w.window_from)} and ${when(w.window_to)} (reminder on ${when(w.remind_on)})`,
        hasWindow: w !== null
      };
    }),
    check: {generatedAt: when(s.schedule_check.generated_at), text: typeof s.schedule_check.text === "string" ? s.schedule_check.text : ""}
  };
}
