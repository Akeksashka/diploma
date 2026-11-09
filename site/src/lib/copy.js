// T103: every FIXED or user-confirmed string of the dashboard (ADR-025 decision 11; wording is the confirmed
// wording of T89-T93, unchanged). Strings built from parts (n/N, dates, counts, names) stay in the views
// and lib modules; only their fixed pieces live here, as *_HEAD / *_TAIL or a whole sentence.
// No imports, no colour, no markup. Plain strings so every view can use them.
//
// Stage 1 (T108-T112) wording has three states, each marked at its definition below:
//   APPROVED   - confirmed by the user in session on 2026-11-05 (gate G2: brief section 11 legend bin labels, state codes,
//                the 'ahead' tag, 'Skip to values table', 'Values and reference periods').
//   ADR-026    - the orientation sentence and the direction labels, named in ADR-026 and decided there as Q1/Q2; they ship at
//                the Stage 1 review (G3) together with the page.
//   DRAFT_     - new sentences or labels written by the implementation for Stage 1 (caption, scroll hint, legend title, fact
//                labels). Not confirmed; listed in docs/ops/dashboard-ux-baseline.md. Replace the text after review, keep the names.

// --- Global shell (T104) ------------------------------------------------------------------------------
// NEW wording, pending the user's confirmation (listed in docs/ops/dashboard-ux-baseline.md).
export const SKIP_LINK_TEXT = "Skip to main content";
export const NAV_LABEL = "Main navigation";

// --- State blocks (T105) ------------------------------------------------------------------------------
// DRAFT wording: NEW sentences of brief section 11 (loading, error, no-JS, next steps). They are NOT confirmed by
// the user (gate G2) and are listed in docs/ops/dashboard-ux-baseline.md under "New wording pending confirmation".
// They render so the states work; replace the text after confirmation, do not rename the constants.
// Each region names what failed in logical terms: never a URL, a file path or an error message.
export const DRAFT_LOADING = (what) => `Loading ${what}...`;
export const DRAFT_ERROR_TITLE = (region) => `Could not load ${region}.`;
export const DRAFT_ERROR_VERSION = (region) => `This page cannot read ${region}: its data version is not supported by this front-end.`;
export const DRAFT_ERROR_INVALID = (region) => `The data of ${region} did not pass the format check, so it is not used.`;
export const DRAFT_CONSEQUENCE = Object.freeze({
  lists: "The lists on this page are still shown.",
  scorecard: "The tables and charts on this page are not shown.",
  explorer: "The chart and tables on this page are not shown.",
  revisions: "The revision lists on this page are not shown."
});
export const DRAFT_SUBREGION_CONSEQUENCE = "The rest of this page is still shown. Choose another indicator to try again.";
export const DRAFT_NOSCRIPT = "This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page.";
export const DRAFT_NEXT_GROUP = "Choose another group or another indicator.";
export const DRAFT_NEXT_SERIES = "Choose at least one country, or another indicator or range.";
export const DRAFT_REGIONS = Object.freeze({
  manifest: "the data manifest",
  meta: "the descriptions of countries, indicators and series",
  scorecard: "the scorecard of this domain",
  domains: "the list of domains",
  alerts: "the current alerts",
  recent: "the list of recent revisions",
  series: "the series file of this indicator",
  revisionFile: "the revision file of this indicator",
  loadingData: "the dashboard data",
  loadingSeries: "the series of this indicator",
  loadingRevisions: "the revision history of this indicator"
});

// --- V1 / V2 fixed statements -------------------------------------------------------------------------
export const CAVEAT = "Percentiles are relative position in the covered panel, not a judgement of structural quality.";
export const PERCENTILE_COLUMN_LABEL = "percentile vs all ranked countries";
// Label of the country figure of a domain; the export carries the same text as `percentile_rank_label`.
export const DOMAIN_FIGURE_LABEL = "mean percentile of the domain's indicators";
export const NOT_DOMAIN_PERCENTILE = "It is not the percentile of the domain.";
export const UNRANKED_DOMAIN_STATEMENT = "This domain is informational and unranked: no percentile, rank or position is shown.";
export const PEER_NOTE_HEAD = "The indicators of this domain are ranked against different sets of countries";
export const PEER_NOTE_TAIL = ", so the mean percentile mixes peer sets and is only roughly comparable across countries.";
export const INFORMATIONAL_NOTICE = "informational, unranked";

// Cell and flag texts (V1 detail, V2 table).
export const NOT_PUBLISHED = "not published";
export const NA = "n/a";
export const NO_RANK_STALE = "no rank (stale)";
export const UNRANKED_DOMAIN_CELL = "unranked domain";
export const DESCRIPTIVE_CELL = "descriptive, not ranked";
export const NOT_RANKED_INHERITED = "not ranked (inherited)";
export const NOT_RANKED_INFO_ONLY = "not ranked (information only)";
export const AGGREGATE_NOT_RANKED = "aggregate (not ranked)";
export const UNRANKED = "unranked";
export const NO_POSITION = "no position";
export const NO_POSITION_LOW_COVERAGE = "no position (low coverage)";
export const FLAG_LAGGING = "lagging";
export const FLAG_AHEAD = "ahead";
export const FLAG_UNALIGNED = "unaligned";
export const FLAG_UNALIGNED_FISCAL = "unaligned (fiscal-year basis)";
export const FLAG_INHERITED = "inherited from the euro area";
export const FLAG_ESTIMATE = "estimate";
export const FLAG_LOW_COVERAGE = "low coverage";
export const notRankedCell = (alignment) => `not ranked (${alignment})`; // alignment: "lagging" or "unaligned"

// --- V2 peers -----------------------------------------------------------------------------------------
export const GROUP_LABELS = Object.freeze({
  g7: "G7",
  euro_area: "Euro area",
  non_euro_eu: "EU members outside the euro area",
  advanced: "Advanced economies",
  emerging: "Emerging economies"
});
export const ALL_LABEL = "All countries";
export const FILTER_NOTE = `The group filter only filters and sorts the list. Every percentile shown is the ${PERCENTILE_COLUMN_LABEL}; it is not recomputed within the group.`;
export const NON_EURO_MARK = "non-euro: see the note above";
export const SORT_LABELS = Object.freeze({
  percentile: "Percentile (stored), highest first",
  value_desc: "Latest value, highest first",
  value_asc: "Latest value, lowest first",
  name: "Country name"
});
export const NO_INDICATORS = "This domain has no indicators.";
export const NO_RANKING_SPREAD = "No ranking for this indicator, so there is no common reference period or spread.";
export const EMPTY_GROUP = "No countries of this group have a value for this indicator in this domain.";

// DRAFT (not confirmed): Stage 3 (T117-T119) sentences of the V2 dot plot, written by the implementation.
export const DRAFT_PEER_DIRECTION = (directionText) => `Direction of this indicator: ${directionText}.`;
export const DRAFT_PEER_FIGURE_LABEL = (indicatorName, n, column) => `Dot plot of the ${column} for ${indicatorName}, ${n} ${n === 1 ? "country" : "countries"}. The table below lists the same values.`;
export const DRAFT_PEER_TABLE_CAPTION = (indicatorName) => `${indicatorName}: latest value and stored percentile, by country`;
export const DRAFT_PEER_MARKS = "Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus.";
export const DRAFT_PEER_GUIDES = "The grey lines mark 0.25, 0.5 and 0.75 on the scale.";
export const DRAFT_PEER_NOT_DRAWN = "A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only.";
export const DRAFT_PEER_FOCUS_HINT = "Select a country name to highlight it in the chart and the table; select it again to clear.";

// --- V3 explorer --------------------------------------------------------------------------------------
export const TRANSFORM_LABELS = Object.freeze({value: "Level", value_default_tf: "Indicator default", value_yoy: "Year-on-year"});
export const REBASE_NOTE = "Rebasing is a display scaling only (value / value at the base period x 100). It needs a positive value at the base period.";
export const REBASE_TOGGLE_LABEL = "Rebase to 100 (display only)";
export const NO_SERIES = "No series to draw for this selection.";
export const NOT_SHOWN_TRANSFORM = "this transform is not offered for a series that is not seasonally adjusted";
export const NOT_SHOWN_NO_VALUES = "no values for this transform in the chosen range";
export const NOT_SHOWN_NO_BASE = "no usable (positive) value at the base period, so it cannot be rebased";
export const NO_SERIES_FILE = "No series file for this indicator in this export.";
export const REBASED_UNIT = "index, base period = 100";
export const REBASED_Y_LABEL = "Index (base period = 100)";
export const ALERTS_HEADING = "Current alerts (latest run only)";
export const ALERT_NOT_DRAWN = " (not drawn: no plotted value at that period)";

// --- V4 revisions -------------------------------------------------------------------------------------
// Spec section 7 ("V4 vintage text", AC-EXP-12): the same for every series, equal to the spec sentence.
export const VINTAGE_TEXT =
  "Vintages are recorded from this system's first fetch and are collected once a month. A revision that happens and is corrected between two fetches is not visible, and the earliest stored version is not necessarily the value the source published first. History before the first fetch is revised data, not real time.";
export const EARLIEST_LABEL = "earliest stored version"; // spec section 7: never any other name for it
export const REVISED_DATA_NOTICE =
  "Revised data: this view is not a real-time record. Early periods show few revisions because versions exist only from this system's first fetch, and history before that fetch is shown as it stood at that fetch.";
export const REESTIMATION_NOTE =
  "Re-estimation revisions come from sources that re-estimate a whole history at once; they are marked and can be hidden so that they do not crowd out ordinary revisions.";
export const KIND_LABELS = Object.freeze({all: "All revisions", regular: "Regular revisions only", reestimation: "Re-estimation revisions only"});
export const CLASS_LABEL = Object.freeze({regular: "regular", reestimation: "re-estimation"});
export const CHOOSE_INDICATOR_OPTION = "choose an indicator";
export const ALL_PERIODS = "All reference periods";
export const NO_ORDINARY = "No ordinary revisions in the last 12 months.";
export const NO_ORDINARY_CLASS = "No revisions of this class in the last 12 months.";
export const EDITIONS_INTRO = "A named edition (for example an IMF WEO release) can rebase history for thousands of keys at once, so it is shown as one line and never ranked among the ordinary revisions.";
export const NO_EDITIONS = "No named edition revised published history in the last 12 months.";
export const VINTAGE_CHOOSE = "Choose an indicator to load its revision file (one file per indicator).";
export const VINTAGE_NONE = "No revised key of a headline series in this file.";
export const VINTAGE_EMPTY = "No stored versions of this series for that reference period.";
export const NAMED_EDITION_MARK = " (named edition)";
export const REVISED_DATA_HISTORY_MARK = " (revised-data history)";

// --- Global freshness line (G-STR2, decisions record section 4). CONFIRMED by the user (R20); replaces "Data as of". ---
export const FRESHNESS_LABEL = "Data cut-off"; // confirmed by the user 2026-11-08
export const FRESHNESS_LINE = (date, buildId) => `${FRESHNESS_LABEL}: ${date ?? "unknown"} (build ${buildId ?? "unknown"}).`; // confirmed by the user 2026-11-08

// --- Stale banner (G-STALE, ADR-031). CONFIRMED by the user (R20); never prints the manifest field name. `date` is YYYY-MM-DD (UTC). ---
export const STALE_BANNER = (date, days, limit) => `Data may be out of date: the data cut-off (${date}) is ${days} days old, more than ${limit} days.`;
export const STALE_BANNER_UNREADABLE = "Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date.";

// --- Stage 1: state vocabulary, percentile bins, legend, heatmap (T108-T112) --------------------------
// APPROVED (G2, 2026-11-05). Bin labels carry no judgement words. The brief fixes the first and the last label
// ("lowest fifth of the panel" .. "highest fifth of the panel"); the three between are the same pattern, written
// by the implementation (flagged for the Stage 1 review).
export const BIN_LABELS = Object.freeze(["lowest fifth of the panel", "second fifth of the panel", "middle fifth of the panel", "fourth fifth of the panel", "highest fifth of the panel"]);
// APPROVED: the visible short codes of the cells (brief section 5 and 11).
export const STATE_CODES = Object.freeze({stale: "stale", lagging: "lagging", unaligned: "unaligned", na: "n/a", not_published: "np"});
export const AHEAD_TAG = "ahead";
// APPROVED (brief section 5, 'ahead' row).
export const AHEAD_NAME = "ranked at its latest value, ahead of the common period";
// APPROVED (brief section 4, 5 and 8).
export const SKIP_TO_TABLE = "Skip to values table";
export const DETAILS_SUMMARY = "Values and reference periods";
// Accessible name of a stale cell (brief section 5: "stale: no rank" + age and limit).
export const STALE_NAME = "stale: no rank";
export const ALERT_LEVEL_PREFIX = "alert level: "; // the stored level (watch or alert) follows; same text as the existing flag
export const COUNTRY_HEADER = "Country";
export const COVERAGE_HEADER = "Indicators available (n/N)";
export const POSITION_HEADER = "Position";

// ADR-026 decisions 2 and 4 (user decisions Q1 and Q2 recorded 2026-11-04): shown in the legend and as the description of
// the domain-figure column header; always this exact string.
export const ORIENTATION_NOTE = "Higher percentile means a more favourable position by each indicator's stated direction.";
export const DIRECTION_LABELS = Object.freeze({higher: "higher is better", lower: "lower is better", target: "closer to target is better", descriptive: DESCRIPTIVE_CELL});
// `closer to target is better (target <stored value> <unit_label>)`, only when the target value is stored.
export const directionWithTarget = (label, value, unit) => `${label} (target ${value}${unit ? ` ${unit}` : ""})`;

// DRAFT (not confirmed): new Stage 1 sentences and labels written by the implementation.
export const DRAFT_LEGEND_TITLE = "Legend";
export const DRAFT_LEGEND_BINS = "Percentile bins";
export const DRAFT_LEGEND_STATES = "Cell marks";
export const DRAFT_SCROLL_HINT = "Scroll sideways to see more indicators.";
export const DRAFT_HEATMAP_CAPTION = (domainName, label) => `${domainName}: ${label}, and the percentile of each indicator, by country`;
export const DRAFT_HEATMAP_CAPTION_INFO = (domainName) => `${domainName}: latest value of each indicator, by country (${INFORMATIONAL_NOTICE})`;
export const DRAFT_FACT_LABELS = Object.freeze({
  value: "Latest value",
  refPeriod: "Reference period",
  refOffset: "Reference offset (days)",
  release: "Source release",
  age: "Age (days)",
  limit: "Staleness limit (days)",
  flags: "Flags"
});
// APPROVED (brief section 5): the table mark of an estimated value, a suffix "e" after the figure.
export const ESTIMATE_MARK = "e";

// --- Stage 4: V3 explorer chart (T120-T125) -----------------------------------------------------------
// APPROVED (G2, brief section 11, confirmed by the user 2026-11-05): "View as table" and "Selection".
export const VIEW_AS_TABLE = "View as table";
export const SELECTION_LABEL = "Selection";
// DRAFT (not confirmed): every other new Stage 4 string, written by the implementation. Listed in docs/ops/dashboard-ux-baseline.md.
export const DRAFT_SELECT_GROUP = "Select group";
export const DRAFT_FREE_Y_LABEL = "Free y-axis (used when more than 5 countries are selected)";
export const DRAFT_CHART_SHOWS = "Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value.";
export const DRAFT_CHART_MARKS = "A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each.";
export const DRAFT_REBASE_MARKS = "The grey lines mark the index value 100 and the base period.";
export const DRAFT_FACET_STATEMENT = "More than 5 countries are selected, so each country has its own chart.";
export const DRAFT_Y_MODE = (free) => (free
  ? "Each chart has its own y-axis scale: the shape of a series is easy to see, but levels cannot be compared between charts."
  : "All charts share one y-axis scale, so the levels of the countries can be compared.");
export const DRAFT_SERIES_LABEL_PART = (name, from, to, latestText) => `${name}, ${from} to ${to}, latest stored value ${latestText}`;
export const DRAFT_EXPLORER_FIGURE_LABEL = (title, yLabel, parts) => `Line chart of ${title}, y-axis ${yLabel}. ${parts.join("; ")}. The table under the chart lists the plotted points.`;
export const DRAFT_TABLE_CAPTION_ALL = (title) => `${title}: plotted values, every plotted period of each series`; // spec 5.6: every plotted value is in a table
export const DRAFT_TABLE_CAPTION = (title, n) => `${title}: plotted values, latest ${n} periods of each series`;
export const DRAFT_TABLE_HEADERS = Object.freeze({value: "Value", status: "Status"});
export const DRAFT_DOWNLOAD = "Download the data file of this indicator";

// --- V4 revisions table (T126) ---------------------------------------------------------------------------
// DRAFT (not confirmed, gate G2): the bar-length label. Brief section 3.3 quotes "bar length is relative to the largest revision
// shown"; the "(revision %)" part says which column the bar draws. Listed in docs/ops/dashboard-ux-baseline.md.
export const DRAFT_BAR_LABEL = "Bar length (revision %) is relative to the largest revision shown.";

// --- V4 vintage step chart (T127) ---------------------------------------------------------------------------
// DRAFT (not confirmed, gate G2): the sentences around the step chart. The FIXED vintage text and EARLIEST_LABEL are unchanged.
export const DRAFT_STEP_CHOOSE_PERIOD = "Choose one reference period to see its step chart.";
export const DRAFT_STEP_NOTE = "Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal.";
export const DRAFT_STEP_REMOVED = "removed";
export const DRAFT_STEP_FIGURE_LABEL = (title, country, period, yLabel, parts) => `Step chart of ${title} for ${country}, reference period ${period}, y-axis ${yLabel}. ${parts.join("; ")}. The version table below lists the same points.`;
export const DRAFT_STEP_FIGURE_PART = (known, valueText) => `${known}: ${valueText}`;
export const DRAFT_STEP_SKIP = "Skip to version table";

// --- Redesign R3: missing-data sentences (spec 5.1 and 7). DRAFT: written from the spec, not confirmed by the user. ---
export const DRAFT_NOT_PUBLISHED_SENTENCE = "Not published on this site.";
export const DRAFT_NA_DEFINED_SENTENCE = "A series is defined for this country, but this export holds no value for it.";
// G-STR1 (docs/ops/dashboard-redesign-decisions.md section 4): the test (pair absent from meta/series.json) only shows
// "not in this export's series list", so the sentence says that.
export const G_STR1_NO_SERIES = "This export lists no series for this country and indicator."; // confirmed by the user 2026-11-08
// DRAFT: a value (or domain row) is stored without a percentile and no stored field states why.
export const DRAFT_NA_NO_PERCENTILE_SENTENCE = "This export holds a value but no percentile for it.";
export const DRAFT_NA_NO_RANKED_SENTENCE = "No indicator of this domain has a ranked value for this country.";

// DRAFT (not confirmed): Redesign R6 country page labels and figure-line wording (spec C-CTRY-1, 4.2 header, section 2 breadcrumb).
export const DRAFT_CRUMB_LABEL = "Breadcrumb";
export const DRAFT_CRUMB_HOME = "Home";
export const DRAFT_CRUMB_COUNTRIES = "Countries";
export const DRAFT_COUNTRY_KIND_LABEL = "Kind";
export const DRAFT_COUNTRY_GROUPS_LABEL = "Groups";
export const DRAFT_COUNTRY_NO_GROUPS = "none";
export const DRAFT_WITHOUT_VALUE_GROUP = "Indicators without a value in this export";
export const DRAFT_FIGURE_COVERAGE = (nAvailable, nDefined) => `${nAvailable} of ${nDefined} indicators available`;
export const DRAFT_FIGURE_POSITION = (position, nRanked) => `position ${position} of ${nRanked}`;

// DRAFT (not confirmed): Redesign R7 country page rendering (spec C-CTRY-2, C-CTRY-3, 4.2 controls).
export const DRAFT_COUNTRY_SWITCHER_LABEL = "Switch country";
export const DRAFT_COUNTRY_SWITCHER_GO = "Go";
export const DRAFT_COUNTRY_FILTER_LEGEND = "Show";
export const DRAFT_COUNTRY_FILTER_ALL = "All indicators";
export const DRAFT_COUNTRY_FILTER_VALUE = "Only indicators with a value";
export const DRAFT_COUNTRY_COLUMNS = Object.freeze({indicator: "Indicator", value: "Latest value", period: "Reference period", percentile: PERCENTILE_COLUMN_LABEL, source: "Source", actions: "Actions", reason: "Why there is no value"});
export const DRAFT_COUNTRY_TABLE_CAPTION = (domainName, countryName) => `${domainName}: indicators of ${countryName}`;
export const DRAFT_PROFILE_FIGURE_LABEL = (countryName, domainName) => `percentile of each indicator for ${countryName}, domain ${domainName}; table below lists the same values`;
export const DRAFT_PROFILE_DOT_LABEL = (name, percentileText) => `${name}: ${percentileText}`;
export const DRAFT_OFFSET_FLAG = (days) => `offset ${days} days`;
// G-STR3 (decisions record section 4): one label per target. "Compare with other countries" is dropped.
export const COMPARE_COUNTRIES = "Compare countries"; // to PG-INDICATOR // confirmed by the user 2026-11-08
export const COMPARE_COUNTRIES_LABEL = (indicatorName) => `Compare countries: ${indicatorName}`; // confirmed by the user 2026-11-08
export const SERIES_LINK_LABEL = (indicatorName, countryName) => `Time series: ${indicatorName}, ${countryName}`; // confirmed by the user 2026-11-08
export const HEATMAP_INDICATOR_LINK = "Indicator page"; // visible text of the column-header link (R11); confirmed by the user 2026-11-08
export const HEATMAP_INDICATOR_LINK_LABEL = (name) => `Indicator page: ${name}`; // full name for assistive tech, starts with the visible text; confirmed by the user 2026-11-08

// DRAFT (not confirmed): Redesign R8 "About this value" field list (spec 5.5) and "Show history" (C-CTRY-3, AC-RD-14). Labels only; no prose.
export const DRAFT_ABOUT_SUMMARY = "About this value";
export const DRAFT_ABOUT_LABELS = Object.freeze({
  indicator: "Indicator",
  country: "Country",
  seriesId: "Series id",
  source: "Source",
  attribution: "Attribution",
  frequency: "Frequency",
  unit: "Unit",
  seasonal: "Seasonal adjustment",
  priceBasis: "Price basis",
  refPeriod: "Reference period",
  knownAt: "Known at",
  sourceRelease: "Source release at",
  age: "Age (days)",
  staleLimit: "Staleness limit (days)",
  transform: "Transform",
  flags: "Flags",
  reestimating: "Re-estimation"
});
export const DRAFT_REESTIMATED_MARK = "re-estimated";
export const DRAFT_HISTORY_SHOW = "Show history";
export const DRAFT_HISTORY_HIDE = "Hide history";
export const DRAFT_HISTORY_REGION = "the history of this indicator";
export const DRAFT_HISTORY_CONSEQUENCE = "No history chart is shown for this indicator.";
export const DRAFT_HISTORY_FIGURE_LABEL = (indicatorName, countryName, unit) => `history of ${indicatorName} for ${countryName}, in ${unit}; table below lists the latest values`;
export const DRAFT_HISTORY_TABLE_TITLE = (indicatorName, countryName) => `${indicatorName}: ${countryName}`;

// DRAFT (not confirmed): Redesign R9 indicator page header and row table labels (spec 4.3 header, C-IND-5). Labels only; no prose.
export const DRAFT_CRUMB_INDICATORS = "Indicators";
export const DRAFT_INDICATOR_FACT_LABELS = Object.freeze({id: "Identifier", domains: "Domains", unit: "Unit", frequency: "Frequency", direction: "Direction", notes: "Notes", transform: "Transform"});
export const DRAFT_INDICATOR_COLUMNS = Object.freeze({country: "Country", value: "Latest value", period: "Reference period", offset: "Offset (days)", percentile: PERCENTILE_COLUMN_LABEL});
export const DRAFT_INDICATOR_TABLE_CAPTION = (indicatorName) => `${indicatorName}: latest values by country`;

// DRAFT (not confirmed): Redesign R10 indicator page controls, table and charts (spec C-IND-1 to C-IND-7). Labels only. The reference-period line (C-IND-2)
// reuses the confirmed spreadText() sentence of peers.js (decisions record 2b).
export const DRAFT_INDICATOR_GROUP_LEGEND = "Peer group (filter)";
export const DRAFT_INDICATOR_SORT_LABEL = "Sort by";
export const DRAFT_INDICATOR_SORT_LABELS = Object.freeze({name: "Country", value: "Value", percentile: "Percentile", period: "Reference period"});
export const DRAFT_INDICATOR_SWITCHER_LABEL = "Switch indicator";
export const DRAFT_INDICATOR_SWITCHER_GO = "Go";
export const DRAFT_INDICATOR_COLUMNS_MORE = Object.freeze({flags: "Flags", source: "Source", actions: "Actions", reason: "Why there is no value"});
export const DRAFT_TRANSFORMED_HEADER = (transformLabel) => `Transformed value (${transformLabel})`;
export const DRAFT_OPEN_AS_SERIES = "Open as time series";
export const INDICATOR_SERIES_LINK = "Time series"; // row link to PG-SERIES (also used on the country page, G-STR3) // confirmed by the user 2026-11-08
// DRAFT (AC-RD-42): a value with no stored unit is a defect; it is stated, never shown as a bare number or "n/a".
export const DRAFT_UNIT_MISSING_SENTENCE = "This export holds no unit for this value.";
export const DRAFT_VALUE_AXIS_TITLE = (indicatorName, unit) => `${indicatorName} (${unit || DRAFT_UNIT_MISSING_SENTENCE})`;
export const DRAFT_VALUE_FIGURE_LABEL = (indicatorName, unit, n) => `Bar chart of ${indicatorName}, ${unit ? `in ${unit}` : DRAFT_UNIT_MISSING_SENTENCE}, ${n} ${n === 1 ? "country" : "countries"}; table below lists the same values`;
export const DRAFT_VALUE_ESTIMATE_MARK = "e";
export const DRAFT_VALUE_NEUTRAL_LEGEND = "No percentile";

// DRAFT (not confirmed): Redesign R13 PG-SERIES defaults (spec C-SER-1, C-SER-2, AC-RD-31, AC-RD-34).
export const DRAFT_CHOOSE_COUNTRIES_HINT = "Choose up to 5 countries to compare.";
// Visible notes (AC-RD-34; decisions record section 3): unrecognised parts, and valid countries with no rows in this export.
export const HASH_FALLBACK_NOTE = "Part of this link was not recognised and was ignored."; // confirmed by the user 2026-11-08
export const HASH_NO_ROWS_NOTE = (names) => `Not selected: this export has no values of this indicator for ${names.join(", ")}.`; // confirmed by the user 2026-11-08
export const OTHER_INDICATORS_GROUP = "Other indicators"; // confirmed by the user 2026-11-08

// DRAFT (not confirmed): Redesign R14 PG-SERIES "About these series" table (spec C-SER-6) and the unit in the title and table header (AC-RD-32).
export const DRAFT_ABOUT_SERIES_HEADING = "About these series";
export const DRAFT_ABOUT_SERIES_COLUMNS = Object.freeze({
  country: "Country",
  source: "Source",
  attribution: "Attribution",
  frequency: "Frequency",
  unit: "Unit",
  seasonal: "Seasonal adjustment",
  priceBasis: "Price basis",
  lastPeriod: "Last period",
  knownAt: "Known at (last period)",
  reestimating: "Re-estimation"
});
export const DRAFT_TITLE_UNIT = (unit) => ` (${unit})`;
export const DRAFT_VALUE_HEADER_UNIT = (unit) => `Value (${unit})`;

// DRAFT (not confirmed): Redesign R16 point reader and tip (amendment 3.3). Labels reuse COUNTRY_HEADER and DRAFT_FACT_LABELS.refPeriod.
export const POINT_READER_LEGEND = "Read a value"; // confirmed by the user 2026-11-08
export const TIP_STATUS = Object.freeze({EST: "estimate", PROV: "provisional"}); // any other value_status: no status line // confirmed by the user 2026-11-08
export const TIP_KNOWN_AT = (date) => `Known at ${date}`; // confirmed by the user 2026-11-08
export const READER_NONE = "Choose a country"; // confirmed by the user 2026-11-08; first option of the PG-INDICATOR reader select while no country is in focus

// DRAFT (not confirmed): Redesign R17/R18 home and domains pages (spec 4.1 C-HOME-2..4, 4.5; decisions record G-STR4). Labels only.
export const HOME_LINKS = Object.freeze({series: "Time series", domains: "Domains", revisions: "Revisions"}); // equal to the nav page names (G-STR4) // confirmed by the user 2026-11-08
export const HOME_COUNTRIES_HEADING = "Choose a country"; // confirmed by the user 2026-11-08
export const HOME_AGGREGATES_HEADING = "Aggregates"; // confirmed by the user 2026-11-08
export const HOME_INDICATORS_HEADING = "Choose an indicator"; // confirmed by the user 2026-11-08
export const HOME_FILTER_LABEL = Object.freeze({countries: "Filter countries", indicators: "Filter indicators"}); // confirmed by the user 2026-11-09 (spec re-approval)
export const DRAFT_HOME_FILTER_COUNT = (n) => `${n} shown`;
export const DRAFT_HOME_FILTER_NONE = "No match.";
export const DRAFT_HOME_DOMAINS_TITLE = HOME_LINKS.domains; // title and h1 of PG-DOMAINS (R17); the confirmed home-link text
