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
// MM_REQUIRE_DIST=1 (CI): the dist scans must not be skipped silently.
if (process.env.MM_REQUIRE_DIST === "1" && !existsSync(join(dist, "index.html"))) throw new Error(`MM_REQUIRE_DIST=1 but no built site at ${dist}`);
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
};
const OBJECTS = {
  GROUP_LABELS: {g7: "G7", euro_area: "Euro area", non_euro_eu: "EU members outside the euro area", advanced: "Advanced economies", emerging: "Emerging economies"},
  SORT_LABELS: {percentile: "Percentile (stored), highest first", value_desc: "Latest value, highest first", value_asc: "Latest value, lowest first", name: "Country name"},
  TRANSFORM_LABELS: {value: "Level", value_default_tf: "Indicator default", value_yoy: "Year-on-year"},
  KIND_LABELS: {all: "All revisions", regular: "Regular revisions only", reestimation: "Re-estimation revisions only"},
  CLASS_LABEL: {regular: "regular", reestimation: "re-estimation"},
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
// Layout L3 (amendment section 7): every new string, as [accessor, expected]. All stay DRAFT until the user confirms them.
export const LAYOUT_L3 = {
  DRAFT_FILTER_LABELS: [(v) => Object.values(v), ["Filters", "Group", "Country", "Domain", "Indicator", "Period", "Frequency", "From", "To", "All", "Reset filters"]],
  DRAFT_FILTER_ALL: [(v) => Object.values(v), ["All countries", "All domains", "All frequencies"]],
  DRAFT_FREQUENCY_NAMES: [(v) => Object.values(v), ["Daily", "Monthly", "Quarterly", "Annual"]],
  DRAFT_PERIOD_PRESETS: [(v) => Object.values(v), ["All", "Last 10 years", "Last 5 years"]],
  DRAFT_BAND_TITLES: [(v) => Object.values(v), ["Overview", "Compare", "Indicators", "Over time"]],
  DRAFT_GROUP_BROWSE: [(v) => v, "Browse"],
  DRAFT_BROWSE_SUMMARY: [(v) => v, "Countries, indicators and other pages"],
  DRAFT_GROUP_REFERENCE_ROWS: [(v) => v, "Reference rows"],
  DRAFT_LOAD_HISTORY: [(v) => v, "Load history"],
  DRAFT_SHOW_MORE: [(v) => v, "Show more"],
  DRAFT_CHART_MODES: [(v) => Object.values(v), ["Lines", "Bars"]],
  DRAFT_CHART_TYPE_LEGEND: [(v) => v, "Chart type"],
  DRAFT_CHOOSE_COUNTRY_PLACEHOLDER: [(v) => v, "Choose a country to see its key indicators."],
  DRAFT_EMPTY_CARD: [(v) => v, "No values for this selection."],
  DRAFT_KPI_ERROR_CONSEQUENCE: [(v) => v, "The key indicators are not shown."],
  DRAFT_SPARKLINE_TOO_FEW: [(v) => v, "Too few values in the selected period."],
  DRAFT_HOME_H1: [(v) => v, "Macro dashboard"],
  DRAFT_FILTER_CHIP_SUMMARY: [(v) => v("Period", "2015 to 2025"), "Period: 2015 to 2025"],
  DRAFT_PERIOD_VALUE: [(v) => v(2015, 2025), "2015 to 2025"],
  DRAFT_PRINT_FILTERS: [(v) => [v(["Group: EU"]), v([])], ["Filters: Group: EU", "Filters: none"]],
  DRAFT_COUNTRY_LIMIT: [(v) => v(5), "You can select up to 5 countries. Clear one to select another."],
  DRAFT_COUNTRY_SELECTED: [(v) => v(3), "3 selected"],
  DRAFT_COUNTRY_CHIP_HELP: [(v) => v, "Select up to 5 countries."],
  DRAFT_PERIOD_INVALID: [(v) => v, "The From year must not be after the To year. The period was not changed."],
  DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE: [(v) => v, "The period filter is not available; all years are shown."],
  DRAFT_PERIOD_REGION: [(v) => v, "the period range"],
  DRAFT_HIDDEN_ROWS: [(v) => [v(3), v(1), v(0)], ["3 rows hidden by the period filter", "1 row hidden by the period filter", ""]], // ADR-036 decision 5 (singular fix)
  DRAFT_HIDDEN_ROW_ITEM: [(v) => v("Germany", "2019 Q4"), "Germany: latest value 2019 Q4"],
  // L12: the ranked comparison card (amendment 4.7)
  DRAFT_RANK_SORT_LABELS: [(v) => ({...v}), {name: "Country (A to Z)", value: "Value", percentile: "Percentile"}],
  DRAFT_RANK_COLUMNS: [(v) => ({...v}), {bar: "Bar", dot: "Percentile position"}]
};
const DRAFT = [
  // Dashboard v2 Compare mode (plan V17 to V23; pinned in the V17-V23 test below)
  "DRAFT_COMPARE_CARD_TITLES", "DRAFT_COMPARE_CONTROL_LABELS", "DRAFT_COMPARE_CONTROLS_LABEL", "DRAFT_COMPARE_CHOOSE_INDICATOR", "DRAFT_COMPARE_CHOOSE_PAIR", "DRAFT_COMPARE_SORTS", "DRAFT_COMPARE_DEFAULT_COUNTRIES", "DRAFT_C2_NO_RANK_REFERENCE", "DRAFT_COMPARE_SERIES_PENDING", "DRAFT_COMPARE_SECONDARY", "DRAFT_C1_MARKS", "DRAFT_C1_FIGURE_LABEL", "DRAFT_C2_FIGURE_LABEL", "DRAFT_C2_MARKS", "DRAFT_C2_TABLE_CAPTION", "DRAFT_C3_FIGURE_LABEL", "DRAFT_C3_TABLE_CAPTION", "DRAFT_C3_NO_COMMON", "DRAFT_C3_MARKS", "DRAFT_NO_VALUE_FOR", "DRAFT_C4_FIGURE_LABEL", "DRAFT_C4_SCALE", "DRAFT_C4_BLANK", "DRAFT_C4_MARKS", "DRAFT_C4_TABLE_CAPTION", "DRAFT_C4_OUTLINE_MARK", "DRAFT_C4_LEGEND",
  // Dashboard v2 Home composition (plan V57 to V59; pinned in the V57-V59 test below)
  "DRAFT_HOME_PANEL_TITLES", "DRAFT_HOME_PANELS_LABEL", "DRAFT_HOME_CONTROLS_LABEL", "DRAFT_HOME_KPI_TITLE", "DRAFT_HOME_KPI_FOR", "DRAFT_HOME_KPI_NO_VALUE", "DRAFT_HOME_KPI_NOT_LOADED", "DRAFT_HOME_MISSING_SUMMARY", "DRAFT_HOME_MISSING_ITEM", "DRAFT_HOME_SCORECARD_PENDING", "DRAFT_HOME_COUNTRY_LABEL", "DRAFT_HOME_MODE_LABEL",
  // Dashboard v2 C6 choropleth map (plan V53 to V55; pinned in the V53-V55 test below)
  "DRAFT_C6_CARD_TITLE", "DRAFT_C6_FIGURE_LABEL", "DRAFT_C6_SCALE", "DRAFT_C6_LEGEND_UNIT", "DRAFT_C6_MARKS", "DRAFT_C6_AGGREGATES_NOTE", "DRAFT_C6_SOURCE_NOTE", "DRAFT_C6_TABLE_CAPTION", "DRAFT_C6_SKIP_TO_TABLE", "DRAFT_C6_NOT_MAPPED", "DRAFT_C6_NOT_MAPPED_SENTENCE", "DRAFT_C6_GEO_PENDING", "DRAFT_C6_GEO_UNREADABLE", "DRAFT_C6_STORED",
  // Dashboard v2 V5 caption block (pinned in the V5 test below) and V4/V6 strings (pinned in the V6 test below)
  "DRAFT_HIDDEN_REASON_LABELS", "DRAFT_HIDDEN_SUMMARY", "DRAFT_HIDDEN_LIST_ITEM",
  "DRAFT_NO_ALIGNED", "DRAFT_BLOCKED_FIELD_LABELS", "DRAFT_BLOCKED_MESSAGE", "DRAFT_MARKED_SEASONAL", "DRAFT_COMPAT_SKIPPED", "DRAFT_MODE_SWITCH_LABEL", "DRAFT_MODE_LABELS", "DRAFT_PICKER_LABELS",
  "DRAFT_SHOW_PERCENTILE", "DRAFT_SHOW_STALE", "DRAFT_INCLUDE_OTHER_PERIODS", "DRAFT_CONTEXT_LINES", "DRAFT_STALE_CODE", "DRAFT_REBASE_STATEMENT",
  "DRAFT_NOT_STATED", "DRAFT_CAPTION_LABELS", "DRAFT_CAPTION_SEASONAL", "DRAFT_CAPTION_VINTAGE", "DRAFT_CAPTION_LEGEND",
  // Dashboard v2 Country mode (plan V11 to V16; pinned in the V11-V16 test below)
  "DRAFT_COUNTRY_CARD_TITLES", "DRAFT_L1_SUMMARY", "DRAFT_FACET_EXPAND", "DRAFT_FACET_COLLAPSE", "DRAFT_SERIES_UNREADABLE", "DRAFT_STALE_TIP", "DRAFT_STALE_PERIOD", "DRAFT_REVISIONS_LINK_LABEL", "DRAFT_STATE_COLUMN",
  "DRAFT_P1A_FIGURE_LABEL", "DRAFT_P1A_REFERENCE", "DRAFT_P1A_TABLE_CAPTION", "DRAFT_P1A_MARKS", "DRAFT_P1A_AGGREGATES_NOTE", "DRAFT_P1A_NO_REFERENCE",
  "DRAFT_LOADING", "DRAFT_ERROR_TITLE", "DRAFT_ERROR_VERSION", "DRAFT_ERROR_INVALID", "DRAFT_CONSEQUENCE", "DRAFT_SUBREGION_CONSEQUENCE",
  "DRAFT_NOSCRIPT", "DRAFT_NEXT_GROUP", "DRAFT_NEXT_SERIES", "DRAFT_REGIONS",
  // Stage 1 (T108-T112): written by the implementation, not confirmed; docs/ops/dashboard-ux-baseline.md lists them.
  "DRAFT_LEGEND_TITLE", "DRAFT_LEGEND_BINS", "DRAFT_LEGEND_STATES", "DRAFT_SCROLL_HINT", "DRAFT_HEATMAP_CAPTION", "DRAFT_HEATMAP_CAPTION_INFO", "DRAFT_FACT_LABELS",
  "DRAFT_PEER_DIRECTION", "DRAFT_PEER_FIGURE_LABEL", "DRAFT_PEER_TABLE_CAPTION", "DRAFT_PEER_MARKS", "DRAFT_PEER_GUIDES", "DRAFT_PEER_NOT_DRAWN", "DRAFT_PEER_FOCUS_HINT",
  // Stage 4 (T120-T124): written by the implementation, not confirmed.
  "DRAFT_SELECT_GROUP", "DRAFT_FREE_Y_LABEL", "DRAFT_CHART_SHOWS", "DRAFT_CHART_MARKS", "DRAFT_REBASE_MARKS", "DRAFT_FACET_STATEMENT", "DRAFT_Y_MODE", "DRAFT_SERIES_LABEL_PART",
  "DRAFT_EXPLORER_FIGURE_LABEL", "DRAFT_TABLE_CAPTION", "DRAFT_TABLE_CAPTION_ALL", "DRAFT_UNIT_MISSING_SENTENCE", "DRAFT_TABLE_HEADERS", "DRAFT_DOWNLOAD", "DRAFT_BAR_LABEL",
  "DRAFT_STEP_CHOOSE_PERIOD", "DRAFT_STEP_NOTE", "DRAFT_STEP_REMOVED", "DRAFT_STEP_FIGURE_LABEL", "DRAFT_STEP_FIGURE_PART", "DRAFT_STEP_SKIP",
  // Redesign R3 (exact text is pinned in missing.test.mjs)
  "DRAFT_NOT_PUBLISHED_SENTENCE", "DRAFT_NA_DEFINED_SENTENCE", "DRAFT_NA_NO_RANKED_SENTENCE", "DRAFT_NA_NO_PERCENTILE_SENTENCE",
  // Redesign R6: country page labels and figure line
  "DRAFT_CRUMB_LABEL", "DRAFT_CRUMB_HOME", "DRAFT_CRUMB_COUNTRIES", "DRAFT_COUNTRY_KIND_LABEL", "DRAFT_COUNTRY_GROUPS_LABEL", "DRAFT_COUNTRY_NO_GROUPS", "DRAFT_WITHOUT_VALUE_GROUP", "DRAFT_FIGURE_COVERAGE", "DRAFT_FIGURE_POSITION",
  // Redesign R7: country page rendering; G-STR3 labels stay DRAFT
  "DRAFT_COUNTRY_SWITCHER_LABEL", "DRAFT_COUNTRY_SWITCHER_GO", "DRAFT_COUNTRY_FILTER_LEGEND", "DRAFT_COUNTRY_FILTER_ALL", "DRAFT_COUNTRY_FILTER_VALUE", "DRAFT_COUNTRY_COLUMNS", "DRAFT_COUNTRY_TABLE_CAPTION",
  "DRAFT_PROFILE_FIGURE_LABEL", "DRAFT_PROFILE_DOT_LABEL", "DRAFT_OFFSET_FLAG",
  // Redesign R8: About this value and Show history
  "DRAFT_ABOUT_SUMMARY", "DRAFT_ABOUT_LABELS", "DRAFT_REESTIMATED_MARK", "DRAFT_HISTORY_SHOW", "DRAFT_HISTORY_HIDE", "DRAFT_HISTORY_REGION", "DRAFT_HISTORY_CONSEQUENCE", "DRAFT_HISTORY_FIGURE_LABEL", "DRAFT_HISTORY_TABLE_TITLE",
  // Redesign R9: indicator page header and row table labels
  "DRAFT_CRUMB_INDICATORS", "DRAFT_INDICATOR_FACT_LABELS", "DRAFT_INDICATOR_COLUMNS", "DRAFT_INDICATOR_TABLE_CAPTION",
  // Redesign R10: indicator page controls, table and charts; G-STR3 labels stay DRAFT
  "DRAFT_BAND_TABLE", "DRAFT_BAND_REVISIONS", "DRAFT_CARD_REVISIONS", "DRAFT_DOMAINS_BAND", "DRAFT_ALL_DOMAINS_LINK", "DRAFT_INDICATOR_SORT_LABEL", "DRAFT_INDICATOR_SORT_LABELS", "DRAFT_INDICATOR_SWITCHER_GO", "DRAFT_INDICATOR_COLUMNS_MORE",
  "DRAFT_TRANSFORMED_HEADER", "DRAFT_OPEN_AS_SERIES", "DRAFT_VALUE_AXIS_TITLE", "DRAFT_VALUE_FIGURE_LABEL", "DRAFT_VALUE_ESTIMATE_MARK", "DRAFT_VALUE_NEUTRAL_LEGEND",
  "DRAFT_CHOOSE_COUNTRIES_HINT",
  // Redesign R14: PG-SERIES about table and units; DRAFT
  "DRAFT_ABOUT_SERIES_HEADING", "DRAFT_ABOUT_SERIES_COLUMNS", "DRAFT_TITLE_UNIT", "DRAFT_VALUE_HEADER_UNIT",
  // Redesign R16: point reader and tip
  
  // Redesign R17/R18: home and domains pages
  "DRAFT_HOME_FILTER_COUNT",
  "DRAFT_HOME_FILTER_NONE", "DRAFT_HOME_DOMAINS_TITLE",
  // Layout L3: amendment sections 6 and 7
  ...Object.keys(LAYOUT_L3)
];

// Confirmed by the user (2026-11-08, and 2026-11-09 for the home filter label): exact text pinned; each must keep its annotation.
const CONFIRMED_NAMES = [
  "FRESHNESS_LINE", "G_STR1_NO_SERIES", "COMPARE_COUNTRIES", "COMPARE_COUNTRIES_LABEL", "SERIES_LINK_LABEL", "HEATMAP_INDICATOR_LINK", "HEATMAP_INDICATOR_LINK_LABEL", "INDICATOR_SERIES_LINK", "HASH_FALLBACK_NOTE", "HASH_NO_ROWS_NOTE", "OTHER_INDICATORS_GROUP", "POINT_READER_LEGEND", "TIP_STATUS", "TIP_KNOWN_AT", "READER_NONE", "HOME_LINKS", "HOME_COUNTRIES_HEADING", "HOME_AGGREGATES_HEADING", "HOME_INDICATORS_HEADING", "HOME_FILTER_LABEL"
];

test("confirmed strings: exact text, and every confirmed export keeps its annotation", () => {
  assert.deepEqual({...copy.HOME_LINKS}, {series: "Time series", domains: "Domains", revisions: "Revisions"});
  assert.equal(copy.HOME_COUNTRIES_HEADING, "Choose a country");
  assert.equal(copy.HOME_AGGREGATES_HEADING, "Aggregates");
  assert.equal(copy.HOME_INDICATORS_HEADING, "Choose an indicator");
  assert.deepEqual({...copy.HOME_FILTER_LABEL}, {countries: "Filter countries", indicators: "Filter indicators"});
  assert.equal(copy.COMPARE_COUNTRIES, "Compare countries");
  assert.equal(copy.COMPARE_COUNTRIES_LABEL("GDP"), "Compare countries: GDP");
  assert.equal(copy.SERIES_LINK_LABEL("GDP", "Germany"), "Time series: GDP, Germany");
  assert.equal(copy.G_STR1_NO_SERIES, "This export lists no series for this country and indicator.");
  assert.equal(copy.FRESHNESS_LINE("2026-11-01", "b1"), "Data cut-off: 2026-11-01 (build b1).");
  assert.equal(copy.FRESHNESS_LINE(null, undefined), "Data cut-off: unknown (build unknown).");
  assert.ok(![copy.STALE_BANNER("d", 1, 2), copy.STALE_BANNER_UNREADABLE, copy.FRESHNESS_LINE("d", "b")].some((t) => t.includes("known_cutoff")));
  assert.equal(copy.INDICATOR_SERIES_LINK, "Time series");
  assert.equal(copy.HASH_FALLBACK_NOTE, "Part of this link was not recognised and was ignored.");
  assert.equal(copy.HASH_NO_ROWS_NOTE(["Germany", "France"]), "Not selected: this export has no values of this indicator for Germany, France.");
  assert.equal(copy.OTHER_INDICATORS_GROUP, "Other indicators");
  assert.equal(copy.POINT_READER_LEGEND, "Read a value");
  assert.deepEqual({...copy.TIP_STATUS}, {EST: "estimate", PROV: "provisional"});
  assert.equal(copy.TIP_KNOWN_AT("2026-10-01"), "Known at 2026-10-01");
  assert.equal(copy.READER_NONE, "Choose a country");
  for (const n of CONFIRMED_NAMES) {
    assert.ok(n in copy, `${n} is exported`);
    assert.ok(isConfirmed(n), `${n} lost its confirmed annotation`);
  }
});

test("DRAFT strings: exact text, and every DRAFT_ export is pinned here", () => {
  assert.equal(copy.DRAFT_LOADING("the dashboard data"), "Loading the dashboard data...");
  assert.equal(copy.DRAFT_ERROR_TITLE("the data manifest"), "Could not load the data manifest.");
  assert.equal(copy.DRAFT_ERROR_VERSION("the data manifest"), "This page cannot read the data manifest: its data version is not supported by this front-end.");
  assert.equal(copy.DRAFT_ERROR_INVALID("the data status"), "The data of the data status did not pass the format check, so it is not used.");
  assert.equal(copy.DRAFT_CONSEQUENCE.scorecard, "The tables and charts on this page are not shown.");
  assert.equal(copy.DRAFT_SUBREGION_CONSEQUENCE, "The rest of this page is still shown. Choose another indicator to try again.");
  assert.equal(copy.DRAFT_NOSCRIPT, "This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page.");
  assert.equal(copy.DRAFT_HOME_FILTER_COUNT(3), "3 shown");
  assert.equal(copy.DRAFT_HOME_FILTER_NONE, "No match.");
  assert.equal(copy.DRAFT_HOME_DOMAINS_TITLE, "Domains");
  assert.equal(copy.DRAFT_CONSEQUENCE.lists, "The lists on this page are still shown.");
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
  assert.equal(copy.DRAFT_TABLE_CAPTION_ALL("T"), "T: plotted values, every plotted period of each series");
  assert.equal(copy.DRAFT_UNIT_MISSING_SENTENCE, "This export holds no unit for this value.");
  assert.equal(copy.DRAFT_VALUE_AXIS_TITLE("GDP", null), "GDP (This export holds no unit for this value.)");
  assert.equal(copy.DRAFT_TABLE_CAPTION("T", 24), "T: plotted values, latest 24 periods of each series");
  assert.deepEqual({...copy.DRAFT_TABLE_HEADERS}, {value: "Value", status: "Status"});
  assert.equal(copy.DRAFT_DOWNLOAD, "Download the data file of this indicator");
  assert.equal(copy.DRAFT_BAR_LABEL, "Bar length (revision %) is relative to the largest revision shown.");
  assert.equal(copy.DRAFT_STEP_CHOOSE_PERIOD, "Choose one reference period to see its step chart.");
  assert.equal(copy.DRAFT_STEP_NOTE, "Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal.");
  assert.equal(copy.DRAFT_STEP_REMOVED, "removed");
  assert.equal(copy.DRAFT_STEP_FIGURE_LABEL("Unemployment rate", "Germany", "2026-06-01", "PCT", ["a: 1", "b: 2"]), "Step chart of Unemployment rate for Germany, reference period 2026-06-01, y-axis PCT. a: 1; b: 2. The version table below lists the same points.");
  assert.equal(copy.DRAFT_STEP_FIGURE_PART("2026-07-02", "5"), "2026-07-02: 5");
  assert.equal(copy.DRAFT_CRUMB_LABEL, "Breadcrumb");
  assert.equal(copy.DRAFT_CRUMB_HOME, "Home");
  assert.equal(copy.DRAFT_CRUMB_COUNTRIES, "Countries");
  assert.equal(copy.DRAFT_COUNTRY_KIND_LABEL, "Kind");
  assert.equal(copy.DRAFT_COUNTRY_GROUPS_LABEL, "Groups");
  assert.equal(copy.DRAFT_COUNTRY_NO_GROUPS, "none");
  assert.equal(copy.DRAFT_WITHOUT_VALUE_GROUP, "Indicators without a value in this export");
  assert.equal(copy.DRAFT_FIGURE_COVERAGE(2, 4), "2 of 4 indicators available");
  assert.equal(copy.DRAFT_FIGURE_POSITION(3, 41), "position 3 of 41");
  assert.equal(copy.DRAFT_STEP_SKIP, "Skip to version table");
  assert.equal(copy.DRAFT_COUNTRY_SWITCHER_LABEL, "Switch country");
  assert.equal(copy.DRAFT_COUNTRY_FILTER_LEGEND, "Show");
  assert.equal(copy.DRAFT_COUNTRY_FILTER_ALL, "All indicators");
  assert.equal(copy.DRAFT_COUNTRY_FILTER_VALUE, "Only indicators with a value");
  assert.deepEqual({...copy.DRAFT_COUNTRY_COLUMNS}, {indicator: "Indicator", value: "Latest value", period: "Reference period", percentile: "percentile vs all ranked countries", source: "Source", actions: "Actions", reason: "Why there is no value"});
  assert.equal(copy.DRAFT_COUNTRY_TABLE_CAPTION("Growth", "Germany"), "Growth: indicators of Germany");
  assert.equal(copy.DRAFT_PROFILE_FIGURE_LABEL("Germany", "Growth"), "percentile of each indicator for Germany, domain Growth; table below lists the same values");
  assert.equal(copy.DRAFT_PROFILE_DOT_LABEL("GDP", "0.50"), "GDP: 0.50");
  assert.equal(copy.DRAFT_OFFSET_FLAG(3), "offset 3 days");
  assert.equal(copy.FRESHNESS_LABEL, "Data cut-off");
  assert.equal(copy.STALE_BANNER("2026-09-01", 64, 45), "Data may be out of date: the data cut-off (2026-09-01) is 64 days old, more than 45 days.");
  assert.equal(copy.STALE_BANNER_UNREADABLE, "Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date.");
  assert.equal(copy.DRAFT_RANKING_PERIOD_LINE, undefined, "deleted: the confirmed spreadText() wording is used");
  assert.equal(copy.DRAFT_COMPARE_WITH_OTHERS, undefined, "dropped (G-STR3)");
  assert.equal(copy.DRAFT_ABOUT_SUMMARY, "About this value");
  assert.deepEqual({...copy.DRAFT_ABOUT_LABELS}, {indicator: "Indicator", country: "Country", seriesId: "Series id", source: "Source", attribution: "Attribution", frequency: "Frequency", unit: "Unit", seasonal: "Seasonal adjustment", priceBasis: "Price basis", refPeriod: "Reference period", knownAt: "Known at", sourceRelease: "Source release at", age: "Age (days)", staleLimit: "Staleness limit (days)", transform: "Transform", flags: "Flags", reestimating: "Re-estimation"});
  assert.equal(copy.DRAFT_REESTIMATED_MARK, "re-estimated");
  assert.equal(copy.DRAFT_HISTORY_SHOW, "Show history");
  assert.equal(copy.DRAFT_HISTORY_HIDE, "Hide history");
  assert.equal(copy.DRAFT_HISTORY_REGION, "the history of this indicator");
  assert.equal(copy.DRAFT_HISTORY_CONSEQUENCE, "No history chart is shown for this indicator.");
  assert.equal(copy.DRAFT_HISTORY_FIGURE_LABEL("GDP", "Germany", "%"), "history of GDP for Germany, in %; table below lists the latest values");
  assert.equal(copy.DRAFT_HISTORY_TABLE_TITLE("GDP", "Germany"), "GDP: Germany");
  assert.equal(copy.DRAFT_CRUMB_INDICATORS, "Indicators");
  assert.deepEqual({...copy.DRAFT_INDICATOR_FACT_LABELS}, {id: "Identifier", domains: "Domains", unit: "Unit", frequency: "Frequency", direction: "Direction", notes: "Notes", transform: "Transform"});
  assert.deepEqual({...copy.DRAFT_INDICATOR_COLUMNS}, {country: "Country", value: "Latest value", period: "Reference period", offset: "Offset (days)", percentile: "percentile vs all ranked countries"});
  assert.equal(copy.DRAFT_INDICATOR_TABLE_CAPTION("GDP"), "GDP: latest values by country");
  assert.equal(copy.DRAFT_INDICATOR_SORT_LABEL, "Sort by");
  assert.deepEqual({...copy.DRAFT_INDICATOR_SORT_LABELS}, {name: "Country", value: "Value", percentile: "Percentile", period: "Reference period"});
  assert.equal(copy.DRAFT_BAND_TABLE, "Table");
  assert.deepEqual([copy.DRAFT_BAND_REVISIONS, copy.DRAFT_CARD_REVISIONS, copy.DRAFT_DOMAINS_BAND, copy.DRAFT_ALL_DOMAINS_LINK], ["Revisions", "Revisions and vintages", "All domains", "All domains"]);
  assert.equal(copy.DRAFT_INDICATOR_SWITCHER_GO, "Go");
  assert.deepEqual({...copy.DRAFT_INDICATOR_COLUMNS_MORE}, {flags: "Flags", source: "Source", actions: "Actions", reason: "Why there is no value"});
  assert.equal(copy.DRAFT_TRANSFORMED_HEADER("YOY"), "Transformed value (YOY)");
  assert.equal(copy.DRAFT_OPEN_AS_SERIES, "Open as time series");
  assert.equal(copy.DRAFT_VALUE_AXIS_TITLE("GDP", "%"), "GDP (%)");
  assert.equal(copy.DRAFT_VALUE_FIGURE_LABEL("GDP", "%", 3), "Bar chart of GDP, in %, 3 countries; table below lists the same values");
  assert.equal(copy.DRAFT_VALUE_FIGURE_LABEL("GDP", "%", 1), "Bar chart of GDP, in %, 1 country; table below lists the same values");
  assert.equal(copy.DRAFT_VALUE_ESTIMATE_MARK, "e");
  assert.equal(copy.DRAFT_VALUE_NEUTRAL_LEGEND, "No percentile");
  assert.equal(copy.DRAFT_CHOOSE_COUNTRIES_HINT, "Choose up to 5 countries to compare."); // spec C-SER-2, verbatim
  assert.equal(copy.DRAFT_ABOUT_SERIES_HEADING, "About these series");
  assert.deepEqual(Object.keys(copy.DRAFT_ABOUT_SERIES_COLUMNS), ["country", "source", "attribution", "frequency", "unit", "seasonal", "priceBasis", "lastPeriod", "knownAt", "reestimating"]);
  assert.equal(copy.DRAFT_ABOUT_SERIES_COLUMNS.knownAt, "Known at (last period)");
  assert.equal(copy.DRAFT_TITLE_UNIT("%"), " (%)");
  assert.equal(copy.DRAFT_VALUE_HEADER_UNIT("%"), "Value (%)");
  assert.deepEqual(Object.keys(copy).filter((k) => k.startsWith("DRAFT_")).sort(), [...DRAFT].sort());
  // a region name is a logical name: no URL, no path, no digit
  for (const r of Object.values(copy.DRAFT_REGIONS)) assert.ok(!/[/:.\d]|https?/.test(r), r);
});

test("V5 (AC-V2-70): caption labels, the not-stated marker and the vintage line are DRAFT constants with their exact text", () => {
  assert.equal(copy.DRAFT_NOT_STATED, "not stated");
  assert.deepEqual({...copy.DRAFT_CAPTION_LABELS}, {indicator: "Indicator", unit: "Unit", frequency: "Frequency", seasonal: "Seasonal adjustment", period: "Reference period", source: "Source", vintage: "Vintage"});
  assert.deepEqual({...copy.DRAFT_CAPTION_SEASONAL}, {SA: "SA", NSA: "NSA", NA: "not applicable"});
  assert.equal(copy.DRAFT_CAPTION_VINTAGE("2026-11-03"), "latest vintage as of 2026-11-03");
  assert.deepEqual({...copy.DRAFT_CAPTION_LEGEND}, {EST: "estimate", PROV: "provisional"});
  for (const n of ["DRAFT_CAPTION_LABELS", "DRAFT_CAPTION_SEASONAL", "DRAFT_CAPTION_LEGEND"]) assert.ok(Object.isFrozen(copy[n]), n);
});

test("V4 (AC-V2-88): hidden-rows summary template and list labels are DRAFT constants with their exact text", () => {
  assert.deepEqual({...copy.DRAFT_HIDDEN_REASON_LABELS}, {no_data: "No data", stale: "Stale", other_period: "Other period", other: "Other"});
  assert.ok(Object.isFrozen(copy.DRAFT_HIDDEN_REASON_LABELS));
  const c = (o) => copy.DRAFT_HIDDEN_SUMMARY({total: 0, no_data: 0, stale: 0, other_period: 0, other: 0, ...o});
  assert.equal(c({}), "");
  assert.equal(c({total: 1, no_data: 1}), "1 row hidden: 1 no data");
  assert.equal(c({total: 7, no_data: 4, stale: 2, other_period: 1}), "7 rows hidden: 4 no data, 2 stale, 1 other period");
  assert.equal(c({total: 3, no_data: 1, stale: 1, other: 1}), "3 rows hidden: 1 no data, 1 stale, 1 other");
  assert.equal(copy.DRAFT_HIDDEN_LIST_ITEM("Germany", "Stale", "2023", "stale: no rank"), "Germany: Stale; latest value 2023; stale: no rank");
  assert.ok(!/%|of \d/.test(c({total: 7, no_data: 4, stale: 2, other_period: 1})), "no percentage or share");
});

// V6 strings are consumed by the later tasks (charts V12-V23); until then no lib module imports them. The mode switch (V8) and picker (V9) strings are consumed and removed from this list.
const V6_UNCONSUMED = [];

test("V6 (AC-V2-44, 81, 83, 90, 91): the v2 strings are DRAFT constants with their exact text; none is a bare n/a", () => {
  assert.equal(copy.DRAFT_NO_ALIGNED, "No aligned values for this selection");
  assert.deepEqual({...copy.DRAFT_BLOCKED_FIELD_LABELS}, {unit_code: "unit code", unit_mult: "unit multiplier", price_basis: "price basis", flow_basis: "flow basis", base_period: "base period", frequency: "frequency"});
  assert.equal(copy.DRAFT_BLOCKED_MESSAGE(["unit code", "price basis"]), "Not drawn together; differing stored fields: unit code, price basis");
  assert.equal(copy.DRAFT_MARKED_SEASONAL, "Mixes SA and NSA series");
  assert.equal(copy.DRAFT_COMPAT_SKIPPED(["flow_basis"]), "Not compared, no stored value: flow_basis");
  assert.equal(copy.DRAFT_MODE_SWITCH_LABEL, "Mode");
  assert.deepEqual({...copy.DRAFT_MODE_LABELS}, {country: "Country", compare: "Compare"});
  assert.deepEqual({...copy.DRAFT_PICKER_LABELS}, {country: "Country", group: "Group", countries: "Countries", aggregates: "Aggregates", placeholder: "Choose a country"});
  assert.equal(copy.DRAFT_SHOW_PERCENTILE, "Show percentile");
  assert.equal(copy.DRAFT_SHOW_STALE, "Show stale rows");
  assert.equal(copy.DRAFT_INCLUDE_OTHER_PERIODS, "Include rows from other reference periods");
  assert.equal(copy.DRAFT_CONTEXT_LINES, "Context lines");
  assert.equal(copy.DRAFT_STALE_CODE, "stale");
  assert.equal(copy.DRAFT_REBASE_STATEMENT("2015"), "Index, 2015 = 100, rebased for display; stored values unchanged.");
  for (const n of ["DRAFT_BLOCKED_FIELD_LABELS", "DRAFT_MODE_LABELS", "DRAFT_PICKER_LABELS"]) assert.ok(Object.isFrozen(copy[n]), n);
  const all = [copy.DRAFT_NO_ALIGNED, copy.DRAFT_MARKED_SEASONAL, copy.DRAFT_SHOW_PERCENTILE, copy.DRAFT_SHOW_STALE, copy.DRAFT_INCLUDE_OTHER_PERIODS, copy.DRAFT_CONTEXT_LINES, copy.DRAFT_STALE_CODE, copy.DRAFT_MODE_SWITCH_LABEL, copy.DRAFT_NOT_STATED, ...Object.values(copy.DRAFT_MODE_LABELS), ...Object.values(copy.DRAFT_PICKER_LABELS), ...Object.values(copy.DRAFT_HIDDEN_REASON_LABELS), ...Object.values(copy.DRAFT_CAPTION_SEASONAL)];
  assert.deepEqual(all.filter((s) => typeof s !== "string" || /^\s*n\/?a\s*$/i.test(s)), [], "no bare n/a (AC-V2-83)");
  assert.ok(!/\bn\/a\b/i.test(copy.DRAFT_REBASE_STATEMENT("2015") + copy.DRAFT_BLOCKED_MESSAGE(["x"])));
  const dict = readFileSync(join(src, "lib", "copy.js"), "utf8").slice(readFileSync(join(src, "lib", "copy.js"), "utf8").indexOf("// DRAFT (not confirmed): Dashboard v2 (ADR-037) V6"));
  assert.ok(!/\bregress|correlat|projection\//i.test(dict), "no regression, correlation or projection wording in the v2 strings");
});

test("V11-V16 (Country mode): the strings are DRAFT constants with their exact text; none is a bare n/a", () => {
  assert.deepEqual({...copy.DRAFT_COUNTRY_CARD_TITLES}, {k1: "Latest values", l1: "Time series", p1: "Position among countries", t1: "Indicator table", l2: "Series"});
  assert.ok(Object.isFrozen(copy.DRAFT_COUNTRY_CARD_TITLES));
  assert.equal(copy.DRAFT_L1_SUMMARY("Labour"), "Labour: time series");
  assert.equal(copy.DRAFT_FACET_EXPAND, "Expand");
  assert.equal(copy.DRAFT_FACET_COLLAPSE, "Collapse");
  assert.equal(copy.DRAFT_SERIES_UNREADABLE, "The series file of this indicator could not be read.");
  assert.equal(copy.DRAFT_STALE_TIP("2025-12"), "stale, latest stored period 2025-12");
  assert.equal(copy.DRAFT_STALE_PERIOD("2025-12"), "stale, 2025-12");
  assert.equal(copy.DRAFT_REVISIONS_LINK_LABEL("Unemployment rate"), "Revisions of Unemployment rate");
  assert.equal(copy.DRAFT_STATE_COLUMN, "State");
  assert.equal(copy.DRAFT_P1A_FIGURE_LABEL("Debt", "2025", "% of GDP"), "Strip plot of Debt, reference period 2025, in % of GDP; each country is one dot; table below lists the same values");
  assert.equal(copy.DRAFT_P1A_REFERENCE("2025"), "Reference period: 2025");
  assert.equal(copy.DRAFT_P1A_TABLE_CAPTION("Debt", "2025"), "Debt: latest stored value by country, reference period 2025");
  assert.equal(copy.DRAFT_P1A_MARKS, "Ring: the country in focus; hollow dot: an estimate or a value of another reference period");
  assert.equal(copy.DRAFT_P1A_AGGREGATES_NOTE, "Dashed lines mark the stored value of an aggregate, for reference only.");
  assert.equal(copy.DRAFT_P1A_NO_REFERENCE, "The scorecard states no reference period for this indicator.");
  const all = [...Object.values(copy.DRAFT_COUNTRY_CARD_TITLES), copy.DRAFT_FACET_EXPAND, copy.DRAFT_FACET_COLLAPSE, copy.DRAFT_SERIES_UNREADABLE, copy.DRAFT_STATE_COLUMN, copy.DRAFT_P1A_MARKS, copy.DRAFT_P1A_AGGREGATES_NOTE, copy.DRAFT_P1A_NO_REFERENCE, copy.DRAFT_L1_SUMMARY("x"), copy.DRAFT_STALE_TIP("x"), copy.DRAFT_STALE_PERIOD("x"), copy.DRAFT_REVISIONS_LINK_LABEL("x"), copy.DRAFT_P1A_FIGURE_LABEL("x", "y", "z"), copy.DRAFT_P1A_REFERENCE("x"), copy.DRAFT_P1A_TABLE_CAPTION("x", "y")];
  assert.deepEqual(all.filter((t) => typeof t !== "string" || /^\s*n\/?a\s*$/i.test(t) || /\bn\/a\b/i.test(t)), [], "no n/a (AC-V2-83)");
  assert.ok(!/\b(up|down|rising|falling|increase|decrease)\b/i.test(all.join(" ")), "no direction wording (no delta, ADR-037 decision 5)");
});

test("Layout L3 (AC-DB-34): every amendment section 7 string is a DRAFT_ constant with its exact text", () => {
  for (const [name, [get, expected]] of Object.entries(LAYOUT_L3)) {
    assert.ok(name.startsWith("DRAFT_"), name);
    assert.ok(name in copy, `${name} is exported`);
    assert.deepEqual(get(copy[name]), expected, name);
    assert.ok(Object.isFrozen(copy[name]) || typeof copy[name] !== "object", `${name} is frozen`);
  }
  assert.equal(copy.HOME_AGGREGATES_HEADING, "Aggregates", "the confirmed string is unchanged");
  assert.equal(copy.DRAFT_HIDDEN_ROWS(0), "", "N = 0 renders no sentence");
  assert.ok(!/%|total|of \d/.test(copy.DRAFT_HIDDEN_ROWS(5)), "no percentage, share or total");
});

test("R11: the heatmap column link has the full indicator name in its accessible name, starting with the visible text", () => {
  assert.equal(copy.HEATMAP_INDICATOR_LINK, "Indicator page");
  assert.equal(copy.HEATMAP_INDICATOR_LINK_LABEL("Unemployment rate"), "Indicator page: Unemployment rate");
  assert.ok(copy.HEATMAP_INDICATOR_LINK_LABEL("x").startsWith(copy.HEATMAP_INDICATOR_LINK));
});

test("copy.js exports nothing that is not covered above (a new string needs a verbatim assertion)", () => {
  const known = new Set(["BIN_LABELS", "FRESHNESS_LABEL", "STALE_BANNER", "STALE_BANNER_UNREADABLE", ...Object.keys(VERBATIM), ...Object.keys(OBJECTS), "notRankedCell", "directionWithTarget", ...CONFIRMED_NAMES, ...DRAFT]);
  assert.deepEqual(Object.keys(copy).filter((k) => !known.has(k)), []);
});

test("copy.js imports only the dictionary reader (V44) and every export other than the data label is used by a lib module", () => {
  const text = readFileSync(join(src, "lib", "copy.js"), "utf8");
  assert.deepEqual(text.match(/^\s*import\b.*$/gm), ['import {i18n} from "./i18n.js";']);
  const others = readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js") && n !== "copy.js").map((n) => readFileSync(join(src, "lib", n), "utf8")).join("\n");
  const unused = Object.keys(copy).filter((k) => k !== "DOMAIN_FIGURE_LABEL" && k !== "FRESHNESS_LABEL" && k !== "STALE_BANNER" && k !== "STALE_BANNER_UNREADABLE" && !V6_UNCONSUMED.includes(k) && !(k in LAYOUT_L3) /* L3 constants are consumed by the L6+ filter bar */ && !new RegExp(`\\b${k}\\b`).test(others));
  assert.deepEqual(unused, []);
  // the exemption list must shrink as strings are consumed: a listed name that a lib module now uses is stale and must be removed from it
  const nowUsed = V6_UNCONSUMED.filter((k) => new RegExp(`\\b${k}\\b`).test(others));
  assert.deepEqual(nowUsed, [], "remove these names from V6_UNCONSUMED: a lib module consumes them");
  assert.deepEqual(V6_UNCONSUMED.filter((k) => !(k in copy)), [], "every listed name still exists in copy.js");
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

// --- Redesign R21 / AC-RD-55, AC-RD-62: spec section 7 strings -----------------------------------------------------------
const CONFIRMED_NOTE = "confirmed by the user 2026-11-08 or 2026-11-09";
const copySource = readFileSync(join(src, "lib", "copy.js"), "utf8");
const exportLine = (name) => copySource.split("\n").find((l) => l.startsWith(`export const ${name} `) || l.startsWith(`export const ${name}=`));
const isConfirmed = (name) => /confirmed by the user 2026-11-0[89]/.test(exportLine(name) ?? "");
const valueOf = (v) => (typeof v === "function" ? v : typeof v === "object" ? {...v} : v);

// Spec section 7 string -> [constant, accessor]. Strings that a later user decision renamed or dropped are listed in SECTION7_SUPERSEDED.
const SECTION7 = {
  "Choose a country": ["HOME_COUNTRIES_HEADING", (v) => v],
  "Choose an indicator": ["HOME_INDICATORS_HEADING", (v) => v],
  "Indicators without a value in this export": ["DRAFT_WITHOUT_VALUE_GROUP", (v) => v],
  "Show history": ["DRAFT_HISTORY_SHOW", (v) => v],
  "Compare countries": ["COMPARE_COUNTRIES", (v) => v],
  "About this value": ["DRAFT_ABOUT_SUMMARY", (v) => v],
  "About these series": ["DRAFT_ABOUT_SERIES_HEADING", (v) => v],
  "Open as time series": ["DRAFT_OPEN_AS_SERIES", (v) => v],
  "Data cut-off": ["FRESHNESS_LABEL", (v) => v],
  "Not published on this site.": ["DRAFT_NOT_PUBLISHED_SENTENCE", (v) => v],
  "Choose up to 5 countries to compare.": ["DRAFT_CHOOSE_COUNTRIES_HINT", (v) => v],
  "Read a value": ["POINT_READER_LEGEND", (v) => v],
  "Known at 2026-01-31": ["TIP_KNOWN_AT", (v) => v("2026-01-31")],
  "estimate": ["TIP_STATUS", (v) => v.EST],
  "provisional": ["TIP_STATUS", (v) => v.PROV],
  "Part of this link was not recognised and was ignored.": ["HASH_FALLBACK_NOTE", (v) => v],
  "Not selected: this export has no values of this indicator for A, B.": ["HASH_NO_ROWS_NOTE", (v) => v(["A", "B"])],
  // the three new missing-data sentences of section 5.1
  "A series is defined for this country, but this export holds no value for it.": ["DRAFT_NA_DEFINED_SENTENCE", (v) => v],
  "This export holds a value but no percentile for it.": ["DRAFT_NA_NO_PERCENTILE_SENTENCE", (v) => v],
  "No indicator of this domain has a ranked value for this country.": ["DRAFT_NA_NO_RANKED_SENTENCE", (v) => v]
};
// Section 7 labels that user decisions G-STR3, G-STR4 and the R6/R7 wording replaced (docs/ops/dashboard-redesign-decisions.md).
const SECTION7_REPLACED = {
  "Filter the list": ["HOME_FILTER_LABEL", {countries: "Filter countries", indicators: "Filter indicators"}],
  "Show: all indicators": ["DRAFT_COUNTRY_FILTER_ALL", "All indicators"],
  "Show: only indicators with a value": ["DRAFT_COUNTRY_FILTER_VALUE", "Only indicators with a value"]
};
// Confirmed on 2026-11-08 (spec section 7): these strings must keep exactly this text.
const CONFIRMED = {
  READER_NONE: "Choose a country",
  HOME_COUNTRIES_HEADING: "Choose a country",
  POINT_READER_LEGEND: "Read a value",
  HASH_FALLBACK_NOTE: "Part of this link was not recognised and was ignored.",
  G_STR1_NO_SERIES: "This export lists no series for this country and indicator.",
  COMPARE_COUNTRIES: "Compare countries",
  FRESHNESS_LABEL: "Data cut-off",
  HOME_AGGREGATES_HEADING: "Aggregates",
  HOME_INDICATORS_HEADING: "Choose an indicator"
};

test("AC-RD-55: every section 7 string is in copy.js with its exact text, and is DRAFT-marked unless annotated as confirmed", () => {
  for (const [text, [name, get]] of Object.entries(SECTION7)) {
    assert.ok(name in copy, `${name} is exported by copy.js`);
    assert.equal(get(copy[name]), text, name);
    assert.ok(name.startsWith("DRAFT_") || isConfirmed(name), `${name} is neither DRAFT_ nor annotated "${CONFIRMED_NOTE}"`);
  }
  for (const [text, [name, expected]] of Object.entries(SECTION7_REPLACED)) {
    assert.ok(name.startsWith("DRAFT_") || isConfirmed(name), `${name} (replaces "${text}") is DRAFT-marked or annotated confirmed`);
    assert.deepEqual(valueOf(copy[name]), expected, name);
  }
});

test("AC-RD-55: confirmed strings are unchanged and keep their annotation", () => {
  // Every export is already pinned to its exact text by the tests above, so an annotated constant cannot change unnoticed.
  for (const [name, text] of Object.entries(CONFIRMED)) {
    assert.equal(copy[name], text, name);
    assert.ok(isConfirmed(name), `${name} lost its confirmed annotation`);
  }
  assert.equal(copy.HOME_COUNTRIES_HEADING, CONFIRMED.READER_NONE);
  assert.equal(copy.TIP_KNOWN_AT("2026-01-31"), "Known at 2026-01-31");
  assert.deepEqual({...copy.TIP_STATUS}, {EST: "estimate", PROV: "provisional"});
  assert.equal(copy.HASH_NO_ROWS_NOTE(["A", "B"]), "Not selected: this export has no values of this indicator for A, B.");
});

test("AC-RD-55, 62: withdrawn strings are absent from copy.js, src and the built pages", () => {
  const withdrawn = [
    /\bGuide\b/,
    /\bData status\b/,
    /Projections are not shown in this version/,
    /A chart shows one indicator, so all lines share one unit/,
    /all lines share one unit/,
    /Look at one series over time/,
    /Domain overviews/,
    /Compare with other countries/,
    new RegExp(["first", "release"].join(" "), "i"),
    new RegExp(["first", "stored", "release"].join(" "), "i")
  ];
  const copyCode = copySource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const re of withdrawn) assert.ok(!re.test(copyCode), `copy.js contains ${re}`);
  for (const v of Object.values(copy)) {
    const s = typeof v === "string" ? v : typeof v === "object" && v ? JSON.stringify(v) : "";
    for (const re of withdrawn) assert.ok(!re.test(s), `a copy.js string matches ${re}`);
  }
  const files = [...walk(src, (n) => /\.(js|md)$/.test(n)).filter((f) => !f.endsWith(join("lib", "copy.js"))), ...(existsSync(dist) ? walk(dist, (n) => /\.html$/.test(n)) : [])];
  const hits = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    // Strip comments in sources: the removed-page names may still appear in explanatory comments, never in text.
    const body = f.startsWith(dist) ? t : t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");
    for (const re of withdrawn) if (re.test(body)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

// --- L26 / AC-DB-34: layout amendment section 7, checked against the amendment text itself ------------------------------------
const amendmentText = readFileSync(join(root, "..", "docs", "specs", "dashboard-layout-amendment.md"), "utf8");
// The plain quoted strings of section 7 (before "Existing confirmed strings"); the two function forms are checked in LAYOUT_L3.
const section7Strings = () => {
  const i = amendmentText.indexOf("## 7. New strings");
  const body = amendmentText.slice(i, amendmentText.indexOf("Existing confirmed strings", i));
  const noForms = body.replace(/`DRAFT_HIDDEN_ROW[^`]*`[^.]*?"<name>: latest value <period>" \(for example "[^"]*"\)/, "").replace(/"<n> rows[^"]*"|"1 row[^"]*"|"<name>[^"]*"/g, "");
  return [...new Set([...noForms.matchAll(/"([^"<>]+)"/g)].map((m) => m[1]))];
};
const flatten = (v) => (typeof v === "string" ? [v] : typeof v === "object" && v !== null ? Object.values(v).flatMap(flatten) : []);
// Returns, for each string, the copy exports that hold it verbatim.
const holders = (module, strings) => Object.fromEntries(strings.map((s) => [s, Object.keys(module).filter((k) => flatten(module[k]).includes(s))]));
const draftMarked = (module, name, source) => name.startsWith("DRAFT_") && (module === copy ? /^export const DRAFT_/m.test(source) : true);

test("AC-DB-34 (L26): every plain string of amendment section 7 is held by a DRAFT_ export of copy.js (Aggregates: the confirmed export)", () => {
  const strings = section7Strings();
  assert.ok(strings.length >= 32, `parsed only ${strings.length} strings from section 7`);
  const held = holders(copy, strings);
  for (const s of strings) {
    const names = held[s];
    assert.ok(names.length > 0, `section 7 string "${s}" is not in copy.js`);
    if (s === "Aggregates") {
      assert.ok(names.includes("HOME_AGGREGATES_HEADING") && isConfirmed("HOME_AGGREGATES_HEADING"), "Aggregates is the existing confirmed export, unchanged");
      continue;
    }
    // At least one holder is DRAFT-marked: DRAFT_ prefix, so the export is read as unconfirmed everywhere (ADR-025 decision 11).
    assert.ok(names.some((n) => draftMarked(copy, n, exportLine(n) ?? "")), `"${s}" has no DRAFT_ holder (found: ${names.join(", ")})`);
  }
  // A DRAFT_ holder never carries the confirmation annotation until the user confirms it.
  for (const s of strings.filter((x) => x !== "Aggregates")) for (const n of held[s].filter((k) => k.startsWith("DRAFT_"))) assert.ok(!isConfirmed(n), `${n} is annotated as confirmed`);
  // Only the strings the amendment names carry the h1 and band titles: both are DRAFT.
  assert.equal(copy.DRAFT_HOME_H1, "Macro dashboard");
  assert.deepEqual(Object.values(copy.DRAFT_BAND_TITLES), ["Overview", "Compare", "Indicators", "Over time"]);
});

test("AC-DB-34 (L26): the section 7 check fails for a missing string, a non-DRAFT holder and a stale confirmation (seeded)", () => {
  const fake = {DRAFT_A: "Alpha", DRAFT_OBJ: Object.freeze({x: "Beta"}), PLAIN: "Gamma"};
  assert.deepEqual(holders(fake, ["Alpha", "Beta", "Gamma", "Delta"]), {Alpha: ["DRAFT_A"], Beta: ["DRAFT_OBJ"], Gamma: ["PLAIN"], Delta: []});
  assert.equal(holders(fake, ["Delta"]).Delta.length, 0, "a missing string has no holder");
  assert.equal(draftMarked(fake, "PLAIN", "export const PLAIN = 'Gamma';"), false, "a holder without the DRAFT_ prefix is not DRAFT-marked");
  assert.equal(draftMarked(copy, "DRAFT_A", "export const DRAFT_A = 'Alpha';"), true);
  assert.ok(/confirmed by the user 2026-11-0[89]/.test("export const DRAFT_A = 'x'; // confirmed by the user 2026-11-09"), "the confirmation annotation is detected, so a DRAFT_ holder carrying it would fail");
  // The parser sees the plain strings and ignores the function forms.
  const s7 = section7Strings();
  for (const s of ["Filters", "Reset filters", "Load history", "Too few values in the selected period.", "Choose a country to see its key indicators."]) assert.ok(s7.includes(s), s);
  assert.ok(!s7.some((x) => x.includes("<n>") || x.includes("<name>")));
});

test("AC-DB-34 (L26): confirmed strings are unchanged (Aggregates, caveat, orientation note, Choose a country, Data cut-off)", () => {
  assert.equal(copy.HOME_AGGREGATES_HEADING, "Aggregates");
  assert.equal(copy.HOME_COUNTRIES_HEADING, "Choose a country");
  assert.equal(copy.FRESHNESS_LABEL, "Data cut-off");
  for (const n of ["CAVEAT", "ORIENTATION_NOTE"]) assert.equal(typeof copy[n], "string", n);
});

test("V17-V23 (Compare mode): the strings are DRAFT constants with their exact text; none is a bare n/a", () => {
  assert.deepEqual({...copy.DRAFT_COMPARE_CARD_TITLES}, {c1: "Time series by country", c2: "Ranked values", c3: "Two indicators", c4: "Countries by period", c5: "Percentile heatmap", t2: "Indicator table"});
  assert.deepEqual({...copy.DRAFT_COMPARE_CONTROL_LABELS}, {domain: "Domain", countries: "Countries", x: "X indicator", y: "Y indicator", p: "Reference period", choose: "Choose an indicator", latest: "Default period", sort: "Sort by"});
  assert.equal(copy.DRAFT_COMPARE_CONTROLS_LABEL("Ranked values"), "Controls: Ranked values");
  assert.equal(copy.DRAFT_COMPARE_CHOOSE_INDICATOR, "Choose an indicator to compare countries.");
  assert.equal(copy.DRAFT_COMPARE_CHOOSE_PAIR, "Choose two indicators to compare.");
  assert.deepEqual({...copy.DRAFT_COMPARE_SORTS}, {value: "Value", name: "Country (A to Z)", percentile: "Percentile"});
  assert.equal(copy.DRAFT_COMPARE_DEFAULT_COUNTRIES, "No country is chosen: the default countries are shown.");
  assert.equal(copy.DRAFT_C2_NO_RANK_REFERENCE, "No ranked reference period for this indicator.");
  assert.equal(copy.DRAFT_COMPARE_SERIES_PENDING, "Loading the series file of this indicator.");
  assert.equal(copy.DRAFT_COMPARE_SECONDARY("Percentile heatmap"), "Percentile layer: Percentile heatmap");
  assert.equal(copy.DRAFT_C1_MARKS, "Dashed grey line: a stored aggregate; square marker: the last point of a stale series; hollow marker: an estimate or provisional value");
  assert.equal(copy.DRAFT_C1_FIGURE_LABEL("GDP", "%", ["A", "B"]), "Line chart of GDP, one line per country, y-axis %: A; B; the table under the chart lists the plotted points");
  assert.equal(copy.DRAFT_C2_FIGURE_LABEL("Debt", "2025", "% of GDP"), "Bar chart of Debt, reference period 2025, in % of GDP; one bar per country; the table below lists the same values");
  assert.equal(copy.DRAFT_C2_MARKS, "Hollow bar: another reference period, with its period in the label; dashed outline: an aggregate, for reference only");
  assert.equal(copy.DRAFT_C2_TABLE_CAPTION("Debt", "2025"), "Debt: stored value by country, reference period 2025");
  assert.equal(copy.DRAFT_C3_FIGURE_LABEL("A", "%", "B", "EUR", "2025"), "Scatter plot, x-axis A in %, y-axis B in EUR, reference period 2025; one dot per country; the table below lists the same values");
  assert.equal(copy.DRAFT_C3_TABLE_CAPTION("A", "B", "2025"), "A and B: stored values by country, reference period 2025");
  assert.equal(copy.DRAFT_C3_NO_COMMON, "No reference period has a stored value of both indicators.");
  assert.equal(copy.DRAFT_C3_MARKS, "Labelled dots are the countries in focus; every country with both values is a dot and is listed in the table.");
  assert.equal(copy.DRAFT_NO_VALUE_FOR(["A", "B"]), "no value for A, B");
  assert.equal(copy.DRAFT_C4_FIGURE_LABEL("Debt", "% of GDP", "2000", "2025"), "Heatmap of Debt, in % of GDP, countries by period, 2000 to 2025; the table below lists the same values");
  assert.equal(copy.DRAFT_C4_SCALE("1", "9"), "Colour scale: 1 to 9, the lowest and highest cell shown");
  assert.equal(copy.DRAFT_C4_BLANK, "no stored value");
  assert.equal(copy.DRAFT_C4_MARKS, "Hatched cell: no stored value");
  assert.equal(copy.DRAFT_C4_OUTLINE_MARK, "Dashed outline: a stale row, shown because Show stale rows is on");
  assert.equal(copy.DRAFT_C4_TABLE_CAPTION("Debt", "% of GDP"), "Debt: stored value by country and period, in % of GDP");
  assert.deepEqual({...copy.DRAFT_C4_LEGEND}, {min: "lowest", max: "highest"});
  for (const n of ["DRAFT_COMPARE_CARD_TITLES", "DRAFT_COMPARE_CONTROL_LABELS", "DRAFT_COMPARE_SORTS", "DRAFT_C4_LEGEND"]) assert.ok(Object.isFrozen(copy[n]), n);
  const all = [...Object.values(copy.DRAFT_COMPARE_CARD_TITLES), ...Object.values(copy.DRAFT_COMPARE_CONTROL_LABELS), ...Object.values(copy.DRAFT_COMPARE_SORTS), copy.DRAFT_COMPARE_CHOOSE_INDICATOR, copy.DRAFT_COMPARE_CHOOSE_PAIR, copy.DRAFT_COMPARE_DEFAULT_COUNTRIES, copy.DRAFT_C2_NO_RANK_REFERENCE, copy.DRAFT_C1_MARKS, copy.DRAFT_C2_MARKS, copy.DRAFT_C3_MARKS, copy.DRAFT_C3_NO_COMMON, copy.DRAFT_C4_BLANK, copy.DRAFT_C4_MARKS, copy.DRAFT_C4_OUTLINE_MARK, copy.DRAFT_NO_VALUE_FOR(["x"])];
  assert.deepEqual(all.filter((t) => typeof t !== "string" || /\bn\/a\b/i.test(t)), [], "no n/a (AC-V2-83)");
  assert.ok(!/\bregress|correlat|projection\//i.test(all.join(" ")), "no regression or correlation wording (AC-V2-44)");
});

test("V53-V55 (C6 map): the strings are DRAFT constants with their exact text; each is a short single sentence or label, none is a bare n/a", () => {
  assert.equal(copy.DRAFT_C6_CARD_TITLE, "Map of values");
  assert.equal(copy.DRAFT_C6_FIGURE_LABEL("Debt", "2025", "% of GDP"), "Map of Europe: Debt, reference period 2025, in % of GDP; one shape per country; the table below lists the same values");
  assert.equal(copy.DRAFT_C6_SCALE("1", "9"), "Colour scale: 1 to 9, the lowest and highest country shown; continuous, no classes");
  assert.equal(copy.DRAFT_C6_LEGEND_UNIT("% of GDP"), "Unit: % of GDP");
  assert.equal(copy.DRAFT_C6_MARKS, "Hatched: no stored value; plain: a stored value not drawn here; circle: a small country; dashed outline: another reference period");
  assert.equal(copy.DRAFT_C6_AGGREGATES_NOTE, "Aggregates and countries outside the map are not drawn; they are listed under the hidden rows and in the table.");
  assert.equal(copy.DRAFT_C6_SOURCE_NOTE, "Map shapes: Natural Earth.");
  assert.equal(copy.DRAFT_C6_TABLE_CAPTION("Debt", "2025"), "Debt: stored value by country, reference period 2025, as drawn on the map");
  assert.equal(copy.DRAFT_C6_SKIP_TO_TABLE, "Skip to the table of map values");
  assert.deepEqual({...copy.DRAFT_C6_NOT_MAPPED}, {aggregate: "an aggregate, not drawn on the map", outside: "outside the map extent", nogeometry: "no map shape for this country"});
  assert.equal(copy.DRAFT_C6_NOT_MAPPED_SENTENCE("outside the map extent", "5 % (2025)"), "outside the map extent; 5 % (2025)");
  assert.equal(copy.DRAFT_C6_STORED("5 %", "2025"), "5 % (2025)");
  assert.equal(copy.DRAFT_C6_GEO_PENDING, "Loading the map shapes.");
  assert.equal(copy.DRAFT_C6_GEO_UNREADABLE, "The map shapes could not be read, so the map is not drawn; the table lists the same values");
  assert.ok(Object.isFrozen(copy.DRAFT_C6_NOT_MAPPED));
  const all = [copy.DRAFT_C6_CARD_TITLE, copy.DRAFT_C6_MARKS, copy.DRAFT_C6_AGGREGATES_NOTE, copy.DRAFT_C6_SOURCE_NOTE, copy.DRAFT_C6_SKIP_TO_TABLE, copy.DRAFT_C6_GEO_PENDING, copy.DRAFT_C6_GEO_UNREADABLE, ...Object.values(copy.DRAFT_C6_NOT_MAPPED)];
  assert.deepEqual(all.filter((t) => typeof t !== "string" || /\bn\/a\b/i.test(t) || t.length > 160), []);
  assert.ok(!/\bregress|correlat|projection\//i.test(all.join(" ")), "no regression or correlation wording (AC-V2-44)");
});

test("V57-V59 (Home composition): the strings are DRAFT constants with their exact text; each is a short single sentence or label, none is a bare n/a", () => {
  assert.deepEqual({...copy.DRAFT_HOME_PANEL_TITLES}, {c2: "Ranked values", c1: "Time series by country", c6: "Map of values", c4: "Countries by period"});
  assert.equal(copy.DRAFT_HOME_PANELS_LABEL, "Comparison panels");
  assert.equal(copy.DRAFT_HOME_CONTROLS_LABEL, "Controls: Home panels");
  assert.equal(copy.DRAFT_HOME_KPI_TITLE, "Key indicators");
  assert.equal(copy.DRAFT_HOME_KPI_FOR("Euro area"), "Latest stored value for Euro area");
  assert.equal(copy.DRAFT_HOME_KPI_NO_VALUE, "No stored value for this entity in this export.");
  assert.equal(copy.DRAFT_HOME_KPI_NOT_LOADED, "The scorecard of this indicator could not be read.");
  assert.equal(copy.DRAFT_HOME_MISSING_SUMMARY, "Some Home settings name an id this export does not carry");
  assert.equal(copy.DRAFT_HOME_MISSING_ITEM("HOME_KPI_IDS", "M18"), "HOME_KPI_IDS: M18 is not in the stored lists, so it is left out");
  assert.equal(copy.DRAFT_HOME_SCORECARD_PENDING, "Loading the stored values.");
  assert.equal(copy.DRAFT_HOME_COUNTRY_LABEL, "Open a country");
  assert.equal(copy.DRAFT_HOME_MODE_LABEL, "Mode");
  for (const k of Object.keys(copy).filter((n) => n.startsWith("DRAFT_HOME_") && /KPI|MISSING|PENDING|COUNTRY_LABEL|MODE_LABEL|PANELS|CONTROLS/.test(n))) assert.ok(!isConfirmed(k), `${k} is not marked confirmed`);
});
