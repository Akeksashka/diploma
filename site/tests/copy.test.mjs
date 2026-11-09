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
const DRAFT = [
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
  "DRAFT_INDICATOR_GROUP_LEGEND", "DRAFT_INDICATOR_SORT_LABEL", "DRAFT_INDICATOR_SORT_LABELS", "DRAFT_INDICATOR_SWITCHER_LABEL", "DRAFT_INDICATOR_SWITCHER_GO", "DRAFT_INDICATOR_COLUMNS_MORE",
  "DRAFT_TRANSFORMED_HEADER", "DRAFT_OPEN_AS_SERIES", "DRAFT_VALUE_AXIS_TITLE", "DRAFT_VALUE_FIGURE_LABEL", "DRAFT_VALUE_ESTIMATE_MARK", "DRAFT_VALUE_NEUTRAL_LEGEND",
  "DRAFT_CHOOSE_COUNTRIES_HINT",
  // Redesign R14: PG-SERIES about table and units; DRAFT
  "DRAFT_ABOUT_SERIES_HEADING", "DRAFT_ABOUT_SERIES_COLUMNS", "DRAFT_TITLE_UNIT", "DRAFT_VALUE_HEADER_UNIT",
  // Redesign R16: point reader and tip
  
  // Redesign R17/R18: home and domains pages
  "DRAFT_HOME_FILTER_COUNT",
  "DRAFT_HOME_FILTER_NONE", "DRAFT_HOME_DOMAINS_TITLE"
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
  assert.equal(copy.DRAFT_INDICATOR_GROUP_LEGEND, "Peer group (filter)");
  assert.equal(copy.DRAFT_INDICATOR_SORT_LABEL, "Sort by");
  assert.deepEqual({...copy.DRAFT_INDICATOR_SORT_LABELS}, {name: "Country", value: "Value", percentile: "Percentile", period: "Reference period"});
  assert.equal(copy.DRAFT_INDICATOR_SWITCHER_LABEL, "Switch indicator");
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

test("R11: the heatmap column link has the full indicator name in its accessible name, starting with the visible text", () => {
  assert.equal(copy.HEATMAP_INDICATOR_LINK, "Indicator page");
  assert.equal(copy.HEATMAP_INDICATOR_LINK_LABEL("Unemployment rate"), "Indicator page: Unemployment rate");
  assert.ok(copy.HEATMAP_INDICATOR_LINK_LABEL("x").startsWith(copy.HEATMAP_INDICATOR_LINK));
});

test("copy.js exports nothing that is not covered above (a new string needs a verbatim assertion)", () => {
  const known = new Set(["BIN_LABELS", "FRESHNESS_LABEL", "STALE_BANNER", "STALE_BANNER_UNREADABLE", ...Object.keys(VERBATIM), ...Object.keys(OBJECTS), "notRankedCell", "directionWithTarget", ...CONFIRMED_NAMES, ...DRAFT]);
  assert.deepEqual(Object.keys(copy).filter((k) => !known.has(k)), []);
});

test("copy.js has no imports and every export other than the data label is used by a lib module", () => {
  const text = readFileSync(join(src, "lib", "copy.js"), "utf8");
  assert.ok(!/^\s*import\b/m.test(text));
  const others = readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js") && n !== "copy.js").map((n) => readFileSync(join(src, "lib", n), "utf8")).join("\n");
  const unused = Object.keys(copy).filter((k) => k !== "DOMAIN_FIGURE_LABEL" && k !== "FRESHNESS_LABEL" && k !== "STALE_BANNER" && k !== "STALE_BANNER_UNREADABLE" && !new RegExp(`\\b${k}\\b`).test(others));
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
