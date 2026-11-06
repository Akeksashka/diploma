// T103 / AC-UX-13: copy.js holds every fixed or confirmed string, verbatim; the views import from it.
import assert from "node:assert/strict";
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import * as copy from "../src/lib/copy.js";
import {domainView, peerSetNote} from "../src/lib/scorecard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const spec = readFileSync(join(root, "..", "docs", "specs", "dashboard-export-spec.md"), "utf8");

const VERBATIM = {
  // T104 NEW wording, pending the user's confirmation
  SKIP_LINK_TEXT: "Skip to main content",
  NAV_LABEL: "Main navigation",
  CAVEAT: "Percentiles are relative position in the covered panel, not a judgement of structural quality.",
  PERCENTILE_COLUMN_LABEL: "percentile vs all ranked countries",
  DOMAIN_FIGURE_LABEL: "mean percentile of the domain's indicators",
  NOT_DOMAIN_PERCENTILE: "It is not the percentile of the domain.",
  UNRANKED_DOMAIN_STATEMENT: "This domain is informational and unranked: no percentile, rank or position is shown.",
  PEER_NOTE_HEAD: "The indicators of this domain are ranked against different sets of countries",
  PEER_NOTE_TAIL: ", so the mean percentile mixes peer sets and is only roughly comparable across countries.",
  INFORMATIONAL_NOTICE: "informational, unranked",
  NOT_PUBLISHED: "not published",
  NA: "n/a",
  NO_RANK_STALE: "no rank (stale)",
  UNRANKED_DOMAIN_CELL: "unranked domain",
  DESCRIPTIVE_CELL: "descriptive, not ranked",
  NOT_RANKED_INHERITED: "not ranked (inherited)",
  NOT_RANKED_INFO_ONLY: "not ranked (information only)",
  AGGREGATE_NOT_RANKED: "aggregate (not ranked)",
  UNRANKED: "unranked",
  NO_POSITION: "no position",
  NO_POSITION_LOW_COVERAGE: "no position (low coverage)",
  FLAG_LAGGING: "lagging",
  FLAG_AHEAD: "ahead",
  FLAG_UNALIGNED: "unaligned",
  FLAG_UNALIGNED_FISCAL: "unaligned (fiscal-year basis)",
  FLAG_INHERITED: "inherited from the euro area",
  FLAG_ESTIMATE: "estimate",
  FLAG_LOW_COVERAGE: "low coverage",
  ALL_LABEL: "All countries",
  FILTER_NOTE: "The group filter only filters and sorts the list. Every percentile shown is the percentile vs all ranked countries; it is not recomputed within the group.",
  NON_EURO_MARK: "non-euro: see the note above",
  NO_INDICATORS: "This domain has no indicators.",
  NO_RANKING_SPREAD: "No ranking for this indicator, so there is no common reference period or spread.",
  EMPTY_GROUP: "No countries of this group have a value for this indicator in this domain.",
  REBASE_NOTE: "Rebasing is a display scaling only (value / value at the base period x 100). It needs a positive value at the base period.",
  REBASE_TOGGLE_LABEL: "Rebase to 100 (display only)",
  NO_SERIES: "No series to draw for this selection.",
  NOT_SHOWN_TRANSFORM: "this transform is not offered for a series that is not seasonally adjusted",
  NOT_SHOWN_NO_VALUES: "no values for this transform in the chosen range",
  NOT_SHOWN_NO_BASE: "no usable (positive) value at the base period, so it cannot be rebased",
  NO_SERIES_FILE: "No series file for this indicator in this export.",
  REBASED_UNIT: "index, base period = 100",
  REBASED_Y_LABEL: "Index (base period = 100)",
  ALERTS_HEADING: "Current alerts (latest run only)",
  ALERT_NOT_DRAWN: " (not drawn: no plotted value at that period)",
  VINTAGE_TEXT:
    "Vintages are recorded from this system's first fetch and are collected once a month. A revision that happens and is corrected between two fetches is not visible, and the earliest stored version is not necessarily the value the source published first. History before the first fetch is revised data, not real time.",
  EARLIEST_LABEL: "earliest stored version",
  REVISED_DATA_NOTICE:
    "Revised data: this view is not a real-time record. Early periods show few revisions because versions exist only from this system's first fetch, and history before that fetch is shown as it stood at that fetch.",
  REESTIMATION_NOTE:
    "Re-estimation revisions come from sources that re-estimate a whole history at once; they are marked and can be hidden so that they do not crowd out ordinary revisions.",
  CHOOSE_INDICATOR_OPTION: "choose an indicator",
  ALL_PERIODS: "All reference periods",
  NO_ORDINARY: "No ordinary revisions in the last 12 months.",
  NO_ORDINARY_CLASS: "No revisions of this class in the last 12 months.",
  EDITIONS_INTRO: "A named edition (for example an IMF WEO release) can rebase history for thousands of keys at once, so it is shown as one line and never ranked among the ordinary revisions.",
  NO_EDITIONS: "No named edition revised published history in the last 12 months.",
  VINTAGE_CHOOSE: "Choose an indicator to load its revision file (one file per indicator).",
  VINTAGE_NONE: "No revised key of a headline series in this file.",
  VINTAGE_EMPTY: "No stored versions of this series for that reference period.",
  NAMED_EDITION_MARK: " (named edition)",
  REVISED_DATA_HISTORY_MARK: " (revised-data history)",
  // Stage 1 (T108-T112). APPROVED 2026-11-05 (gate G2): AHEAD_TAG, AHEAD_NAME, SKIP_TO_TABLE, DETAILS_SUMMARY and the codes below.
  AHEAD_TAG: "ahead",
  AHEAD_NAME: "ranked at its latest value, ahead of the common period",
  SKIP_TO_TABLE: "Skip to values table",
  DETAILS_SUMMARY: "Values and reference periods",
  // Stage 4 (T120, T124). APPROVED 2026-11-05 (G2, brief section 11).
  VIEW_AS_TABLE: "View as table",
  SELECTION_LABEL: "Selection",
  STALE_NAME: "stale: no rank",
  ALERT_LEVEL_PREFIX: "alert level: ",
  ESTIMATE_MARK: "e",
  COUNTRY_HEADER: "Country",
  COVERAGE_HEADER: "Indicators available (n/N)",
  POSITION_HEADER: "Position",
  // ADR-026 decisions 2 and 4: the orientation sentence (user decision Q1, 2026-11-04); shipped at the Stage 1 review.
  ORIENTATION_NOTE: "Higher percentile means a more favourable position by each indicator's stated direction.",
  NOT_EXPORTED: "not exported",
  UNKNOWN_STATE: "unrecognised state",
  COV01_NOT_YET: "not yet measurable",
  NO_ANALYSIS_RUN: "no analysis run for this ingest run",
  NO_WINDOW: "no expected window configured",
  NOT_SHOWN: "not shown",
  WINDOW_NOTE: "Expected release windows come from the source configuration; the release months are not verified against the publisher.",
  COUNTS_NOTE: "Counts cover the published scope only (withheld sources are not counted). They are shown as exported.",
  COV01_NOTE: "COV-01 reports, per indicator, how many entities qualify and whether the check can be measured yet. The share of entities that were stale on arrival is not part of the export.",
  LOAD_NOTE: "The load result of a group is not part of the export yet; the column is empty until it is.",
  BACKLOG_NOTE: "One figure for all sources together; the export has no backlog per group."
};
const OBJECTS = {
  GROUP_LABELS: {g7: "G7", euro_area: "Euro area", non_euro_eu: "EU members outside the euro area", advanced: "Advanced economies", emerging: "Emerging economies"},
  SORT_LABELS: {percentile: "Percentile (stored), highest first", value_desc: "Latest value, highest first", value_asc: "Latest value, lowest first", name: "Country name"},
  TRANSFORM_LABELS: {value: "Level", value_default_tf: "Indicator default", value_yoy: "Year-on-year"},
  KIND_LABELS: {all: "All revisions", regular: "Regular revisions only", reestimation: "Re-estimation revisions only"},
  CLASS_LABEL: {regular: "regular", reestimation: "re-estimation"},
  STATE_LABELS: {fresh: "fresh", late: "late", stale: "stale", broken: "broken"},
  LOAD_LABELS: {ok: "ok", warn: "warnings", failed: "failed", skipped: "skipped"},
  STATE_CODES: {stale: "stale", lagging: "lagging", unaligned: "unaligned", na: "n/a", not_published: "np"},
  // ADR-026 decision 4, user decision Q2 (2026-11-04): the four direction labels.
  DIRECTION_LABELS: {higher: "higher is better", lower: "lower is better", target: "closer to target is better", descriptive: "descriptive, not ranked"},
  DRAFT_FACT_LABELS: {value: "Latest value", refPeriod: "Reference period", refOffset: "Reference offset (days)", release: "Source release", age: "Age (days)", limit: "Staleness limit (days)", flags: "Flags"}
};

// APPROVED 2026-11-05 (G2): the first and the last bin label are the brief's; the three between are the same pattern (flagged at review).
const BIN_LABELS = ["lowest fifth of the panel", "second fifth of the panel", "middle fifth of the panel", "fourth fifth of the panel", "highest fifth of the panel"];

test("every fixed string is verbatim the confirmed wording", () => {
  assert.deepEqual([...copy.BIN_LABELS], BIN_LABELS);
  assert.ok(Object.isFrozen(copy.BIN_LABELS));
  for (const [k, v] of Object.entries(VERBATIM)) assert.equal(copy[k], v, k);
  for (const [k, v] of Object.entries(OBJECTS)) assert.deepEqual({...copy[k]}, v, k);
  assert.equal(copy.notRankedCell("lagging"), "not ranked (lagging)");
  assert.equal(copy.notRankedCell("unaligned"), "not ranked (unaligned)");
});

// T105 DRAFT wording: new sentences NOT yet confirmed by the user (gate G2); listed in docs/ops/dashboard-ux-baseline.md.
// This list pins them so a change is deliberate; it is not a confirmation.
const DRAFT = [
  "DRAFT_LOADING", "DRAFT_ERROR_TITLE", "DRAFT_ERROR_VERSION", "DRAFT_ERROR_INVALID", "DRAFT_CONSEQUENCE", "DRAFT_SUBREGION_CONSEQUENCE",
  "DRAFT_NOSCRIPT", "DRAFT_NEXT_GROUP", "DRAFT_NEXT_SERIES", "DRAFT_REGIONS",
  // Stage 1 (T108-T112): written by the implementation, not confirmed; docs/ops/dashboard-ux-baseline.md lists them.
  "DRAFT_LEGEND_TITLE", "DRAFT_LEGEND_BINS", "DRAFT_LEGEND_STATES", "DRAFT_SCROLL_HINT", "DRAFT_HEATMAP_CAPTION", "DRAFT_HEATMAP_CAPTION_INFO", "DRAFT_FACT_LABELS",
  "DRAFT_PEER_DIRECTION", "DRAFT_PEER_FIGURE_LABEL", "DRAFT_PEER_TABLE_CAPTION", "DRAFT_PEER_MARKS", "DRAFT_PEER_GUIDES", "DRAFT_PEER_NOT_DRAWN", "DRAFT_PEER_FOCUS_HINT",
  // Stage 4 (T120-T124): written by the implementation, not confirmed.
  "DRAFT_SELECT_GROUP", "DRAFT_FREE_Y_LABEL", "DRAFT_CHART_SHOWS", "DRAFT_CHART_MARKS", "DRAFT_REBASE_MARKS", "DRAFT_FACET_STATEMENT", "DRAFT_Y_MODE", "DRAFT_SERIES_LABEL_PART",
  "DRAFT_EXPLORER_FIGURE_LABEL", "DRAFT_TABLE_CAPTION", "DRAFT_TABLE_HEADERS", "DRAFT_DOWNLOAD", "DRAFT_BAR_LABEL",
  "DRAFT_STEP_CHOOSE_PERIOD", "DRAFT_STEP_NOTE", "DRAFT_STEP_REMOVED", "DRAFT_STEP_FIGURE_LABEL", "DRAFT_STEP_FIGURE_PART", "DRAFT_STEP_SKIP"
];

test("DRAFT strings: exact text, and every DRAFT_ export is pinned here", () => {
  assert.equal(copy.DRAFT_LOADING("the dashboard data"), "Loading the dashboard data...");
  assert.equal(copy.DRAFT_ERROR_TITLE("the data manifest"), "Could not load the data manifest.");
  assert.equal(copy.DRAFT_ERROR_VERSION("the data manifest"), "This page cannot read the data manifest: its data version is not supported by this front-end.");
  assert.equal(copy.DRAFT_ERROR_INVALID("the data status"), "The data of the data status did not pass the format check, so it is not used.");
  assert.equal(copy.DRAFT_CONSEQUENCE.scorecard, "The tables and charts on this page are not shown.");
  assert.equal(copy.DRAFT_SUBREGION_CONSEQUENCE, "The rest of this page is still shown. Choose another indicator to try again.");
  assert.equal(copy.DRAFT_NOSCRIPT, "This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page.");
  assert.equal(copy.DRAFT_NEXT_GROUP, "Choose another group or another indicator.");
  assert.equal(copy.DRAFT_NEXT_SERIES, "Choose at least one country, or another indicator or range.");
  assert.equal(copy.DRAFT_LEGEND_TITLE, "Legend");
  assert.equal(copy.DRAFT_LEGEND_BINS, "Percentile bins");
  assert.equal(copy.DRAFT_LEGEND_STATES, "Cell marks");
  assert.equal(copy.DRAFT_SCROLL_HINT, "Scroll sideways to see more indicators.");
  assert.equal(copy.DRAFT_HEATMAP_CAPTION("Labour", "mean percentile of the domain's indicators"), "Labour: mean percentile of the domain's indicators, and the percentile of each indicator, by country");
  assert.equal(copy.DRAFT_HEATMAP_CAPTION_INFO("Agriculture"), "Agriculture: latest value of each indicator, by country (informational, unranked)");
  assert.equal(copy.directionWithTarget(copy.DIRECTION_LABELS.target, "2", "% y/y"), "closer to target is better (target 2 % y/y)");
  assert.equal(copy.directionWithTarget(copy.DIRECTION_LABELS.target, "2", ""), "closer to target is better (target 2)");
  assert.equal(copy.DRAFT_PEER_DIRECTION("higher is better"), "Direction of this indicator: higher is better.");
  assert.equal(copy.DRAFT_PEER_FIGURE_LABEL("Unemployment rate", 3, "percentile vs all ranked countries"), "Dot plot of the percentile vs all ranked countries for Unemployment rate, 3 countries. The table below lists the same values.");
  assert.match(copy.DRAFT_PEER_FIGURE_LABEL("X", 1, "c"), /, 1 country\./);
  assert.equal(copy.DRAFT_PEER_TABLE_CAPTION("Unemployment rate"), "Unemployment rate: latest value and stored percentile, by country");
  assert.equal(copy.DRAFT_PEER_GUIDES, "The grey lines mark 0.25, 0.5 and 0.75 on the scale.");
  assert.equal(copy.DRAFT_PEER_MARKS, "Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus.");
  assert.equal(copy.DRAFT_PEER_NOT_DRAWN, "A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only.");
  assert.equal(copy.DRAFT_PEER_FOCUS_HINT, "Select a country name to highlight it in the chart and the table; select it again to clear.");
  assert.equal(copy.DRAFT_SELECT_GROUP, "Select group");
  assert.equal(copy.DRAFT_FREE_Y_LABEL, "Free y-axis (used when more than 5 countries are selected)");
  assert.equal(copy.DRAFT_CHART_SHOWS, "Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value.");
  assert.equal(copy.DRAFT_CHART_MARKS, "A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each.");
  assert.equal(copy.DRAFT_REBASE_MARKS, "The grey lines mark the index value 100 and the base period.");
  assert.equal(copy.DRAFT_FACET_STATEMENT, "More than 5 countries are selected, so each country has its own chart.");
  assert.equal(copy.DRAFT_Y_MODE(false), "All charts share one y-axis scale, so the levels of the countries can be compared.");
  assert.equal(copy.DRAFT_Y_MODE(true), "Each chart has its own y-axis scale: the shape of a series is easy to see, but levels cannot be compared between charts.");
  assert.equal(copy.DRAFT_SERIES_LABEL_PART("France", "2024-01-31", "2025-03-31", "3.1 %"), "France, 2024-01-31 to 2025-03-31, latest stored value 3.1 %");
  assert.equal(copy.DRAFT_EXPLORER_FIGURE_LABEL("Unemployment rate: Level", "%", ["A", "B"]), "Line chart of Unemployment rate: Level, y-axis %. A; B. The table under the chart lists the plotted points.");
  assert.equal(copy.DRAFT_TABLE_CAPTION("T", 24), "T: plotted values, latest 24 periods of each series");
  assert.deepEqual({...copy.DRAFT_TABLE_HEADERS}, {value: "Value", status: "Status"});
  assert.equal(copy.DRAFT_DOWNLOAD, "Download the data file of this indicator");
  assert.equal(copy.DRAFT_BAR_LABEL, "Bar length (revision %) is relative to the largest revision shown.");
  assert.equal(copy.DRAFT_STEP_CHOOSE_PERIOD, "Choose one reference period to see its step chart.");
  assert.equal(copy.DRAFT_STEP_NOTE, "Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal.");
  assert.equal(copy.DRAFT_STEP_REMOVED, "removed");
  assert.equal(copy.DRAFT_STEP_FIGURE_LABEL("Unemployment rate", "Germany", "2026-06-01", "PCT", ["a: 1", "b: 2"]), "Step chart of Unemployment rate for Germany, reference period 2026-06-01, y-axis PCT. a: 1; b: 2. The version table below lists the same points.");
  assert.equal(copy.DRAFT_STEP_FIGURE_PART("2026-07-02", "5"), "2026-07-02: 5");
  assert.equal(copy.DRAFT_STEP_SKIP, "Skip to version table");
  assert.deepEqual(Object.keys(copy).filter((k) => k.startsWith("DRAFT_")).sort(), [...DRAFT].sort());
  // a region name is a logical name: no URL, no path, no digit
  for (const r of Object.values(copy.DRAFT_REGIONS)) assert.ok(!/[/:.\d]|https?/.test(r), r);
});

test("copy.js exports nothing that is not covered above (a new string needs a verbatim assertion)", () => {
  const known = new Set(["BIN_LABELS", ...Object.keys(VERBATIM), ...Object.keys(OBJECTS), "notRankedCell", "directionWithTarget", ...DRAFT]);
  assert.deepEqual(Object.keys(copy).filter((k) => !known.has(k)), []);
});

test("copy.js has no imports and every export other than the data label is used by a lib module", () => {
  const text = readFileSync(join(src, "lib", "copy.js"), "utf8");
  assert.ok(!/^\s*import\b/m.test(text));
  const others = readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js") && n !== "copy.js").map((n) => readFileSync(join(src, "lib", n), "utf8")).join("\n");
  const unused = Object.keys(copy).filter((k) => k !== "DOMAIN_FIGURE_LABEL" && !new RegExp(`\\b${k}\\b`).test(others));
  assert.deepEqual(unused, []);
});

test("the pieces of the peer-set note and the domain label match what the view-model and the spec use", () => {
  const sc = {domain_id: "labour", ranked: true, percentile_rank_label: copy.DOMAIN_FIGURE_LABEL, heterogeneous_peer_set: true, peer_set_size_by_indicator: {min: 3, max: 5}, entities: []};
  assert.equal(peerSetNote(sc), `${copy.PEER_NOTE_HEAD} (3 to 5 countries per indicator)${copy.PEER_NOTE_TAIL}`);
  assert.equal(peerSetNote({...sc, peer_set_size_by_indicator: {min: 4, max: 4}}), `${copy.PEER_NOTE_HEAD} (4 countries per indicator)${copy.PEER_NOTE_TAIL}`);
  assert.equal(domainView(sc).label, copy.DOMAIN_FIGURE_LABEL);
  assert.ok(spec.includes(`"${copy.DOMAIN_FIGURE_LABEL}"`), "spec carries the domain label");
});

test("V4 fixed vintage text equals the quoted sentence of export spec section 7", () => {
  assert.ok(spec.includes(`"${copy.VINTAGE_TEXT}"`), "the text must be the quoted sentence of spec section 7");
});

function walk(dir, keep) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, keep) : keep(n) ? [p] : [];
  });
}

test("the two forbidden release phrases are absent from site/src and dist", () => {
  // Built at runtime so this file does not match itself (it is also outside src and dist).
  const forbidden = [["first", "release"], ["first", "stored", "release"]].map((w) => w.join(" "));
  const files = [...walk(src, (n) => /\.(js|md|css|json)$/.test(n)), ...(existsSync(dist) ? walk(dist, (n) => /\.(html|js|css)$/.test(n)) : [])];
  const hits = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8").toLowerCase();
    for (const p of forbidden) if (t.includes(p)) hits.push(`${f}: ${p}`);
  }
  assert.ok(files.length > 20, "scanned a plausible number of files");
  assert.deepEqual(hits, []);
});

test("no judgement word in a string that renders next to a percentile", () => {
  const words = ["good", "bad", "strong", "weak", "healthy", "risky"];
  const re = new RegExp(`\\b(?:${words.join("|")})\\b`, "i");
  const strings = [
    ...["CAVEAT", "PERCENTILE_COLUMN_LABEL", "DOMAIN_FIGURE_LABEL", "NOT_DOMAIN_PERCENTILE", "UNRANKED_DOMAIN_STATEMENT", "PEER_NOTE_HEAD", "PEER_NOTE_TAIL", "INFORMATIONAL_NOTICE", "NOT_PUBLISHED", "NO_RANK_STALE", "UNRANKED_DOMAIN_CELL", "DESCRIPTIVE_CELL", "NOT_RANKED_INHERITED", "NOT_RANKED_INFO_ONLY", "AGGREGATE_NOT_RANKED", "UNRANKED", "NO_POSITION", "NO_POSITION_LOW_COVERAGE", "FLAG_LAGGING", "FLAG_AHEAD", "FLAG_UNALIGNED", "FLAG_UNALIGNED_FISCAL", "FLAG_INHERITED", "FLAG_ESTIMATE", "FLAG_LOW_COVERAGE", "FILTER_NOTE", "NON_EURO_MARK", "NO_RANKING_SPREAD", "EMPTY_GROUP", "ALL_LABEL"].map((k) => copy[k]),
    copy.notRankedCell("lagging"),
    copy.notRankedCell("unaligned"),
    ...Object.values(copy.GROUP_LABELS),
    ...Object.values(copy.SORT_LABELS)
  ];
  assert.ok(strings.every((s) => typeof s === "string" && s !== ""));
  assert.deepEqual(strings.filter((s) => re.test(s)), []);
  assert.ok(re.test("a good result"), "the check can fail");
});
