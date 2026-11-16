// V44 (ADR-037 A2.1): every fixed string now lives in site/src/i18n/en.json (verbatim the strings that were here) and site/src/i18n/uk.json
// (Ukrainian, machine-proposed, status "proposed" until the user marks an entry reviewed). This module keeps its exported names and reads the dictionaries
// through lib/i18n.js by MM_LANG. A Ukrainian entry that is not `reviewed` yields the English text (see i18n.js for the lang="en" wrapper); the plain
// strings exported here are therefore English in a production Ukrainian build. The comments below keep the original confirmation state of each string.
import {i18n} from "./i18n.4f9e47d5.js";
const t = (key, params) => i18n.t(key, params);
const tp = (base, n, params) => i18n.tp(base, n, params);
const s = (key) => t(key);
const obj = (name, keys) => Object.freeze(Object.fromEntries(keys.map((k) => [k, t(`${name}.${k}`)])));
const arr = (name, n) => Object.freeze(Array.from({length: n}, (_, i) => t(`${name}.${i}`)));

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
export const SKIP_LINK_TEXT = s("SKIP_LINK_TEXT");
export const NAV_LABEL = s("NAV_LABEL");

// --- State blocks (T105) ------------------------------------------------------------------------------
// DRAFT wording: NEW sentences of brief section 11 (loading, error, no-JS, next steps). They are NOT confirmed by
// the user (gate G2) and are listed in docs/ops/dashboard-ux-baseline.md under "New wording pending confirmation".
// They render so the states work; replace the text after confirmation, do not rename the constants.
// Each region names what failed in logical terms: never a URL, a file path or an error message.
export const DRAFT_LOADING = (what) => t("DRAFT_LOADING", {what});
export const DRAFT_ERROR_TITLE = (region) => t("DRAFT_ERROR_TITLE", {region});
export const DRAFT_ERROR_VERSION = (region) => t("DRAFT_ERROR_VERSION", {region});
export const DRAFT_ERROR_INVALID = (region) => t("DRAFT_ERROR_INVALID", {region});
export const DRAFT_CONSEQUENCE = obj("DRAFT_CONSEQUENCE", ["lists","scorecard","explorer","revisions"]);
export const DRAFT_SUBREGION_CONSEQUENCE = s("DRAFT_SUBREGION_CONSEQUENCE");
export const DRAFT_NOSCRIPT = s("DRAFT_NOSCRIPT");
export const DRAFT_NEXT_GROUP = s("DRAFT_NEXT_GROUP");
export const DRAFT_NEXT_SERIES = s("DRAFT_NEXT_SERIES");
export const DRAFT_REGIONS = obj("DRAFT_REGIONS", ["manifest","meta","scorecard","domains","alerts","recent","series","revisionFile","loadingData","loadingSeries","loadingRevisions"]);

// --- V1 / V2 fixed statements -------------------------------------------------------------------------
export const CAVEAT = s("CAVEAT");
export const PERCENTILE_COLUMN_LABEL = s("PERCENTILE_COLUMN_LABEL");
// Label of the country figure of a domain; the export carries the same text as `percentile_rank_label`.
export const DOMAIN_FIGURE_LABEL = s("DOMAIN_FIGURE_LABEL");
export const NOT_DOMAIN_PERCENTILE = s("NOT_DOMAIN_PERCENTILE");
export const UNRANKED_DOMAIN_STATEMENT = s("UNRANKED_DOMAIN_STATEMENT");
export const PEER_NOTE_HEAD = s("PEER_NOTE_HEAD");
export const PEER_NOTE_TAIL = s("PEER_NOTE_TAIL");
export const INFORMATIONAL_NOTICE = s("INFORMATIONAL_NOTICE");

// Cell and flag texts (V1 detail, V2 table).
export const NOT_PUBLISHED = s("NOT_PUBLISHED");
export const NA = s("NA");
export const NO_RANK_STALE = s("NO_RANK_STALE");
export const UNRANKED_DOMAIN_CELL = s("UNRANKED_DOMAIN_CELL");
export const DESCRIPTIVE_CELL = s("DESCRIPTIVE_CELL");
export const NOT_RANKED_INHERITED = s("NOT_RANKED_INHERITED");
export const NOT_RANKED_INFO_ONLY = s("NOT_RANKED_INFO_ONLY");
export const AGGREGATE_NOT_RANKED = s("AGGREGATE_NOT_RANKED");
export const UNRANKED = s("UNRANKED");
export const NO_POSITION = s("NO_POSITION");
export const NO_POSITION_LOW_COVERAGE = s("NO_POSITION_LOW_COVERAGE");
export const FLAG_LAGGING = s("FLAG_LAGGING");
export const FLAG_AHEAD = s("FLAG_AHEAD");
export const FLAG_UNALIGNED = s("FLAG_UNALIGNED");
export const FLAG_UNALIGNED_FISCAL = s("FLAG_UNALIGNED_FISCAL");
export const FLAG_INHERITED = s("FLAG_INHERITED");
export const FLAG_ESTIMATE = s("FLAG_ESTIMATE");
export const FLAG_LOW_COVERAGE = s("FLAG_LOW_COVERAGE");
export const notRankedCell = (alignment) => t("notRankedCell", {alignment});

// --- V2 peers -----------------------------------------------------------------------------------------
export const GROUP_LABELS = obj("GROUP_LABELS", ["g7","euro_area","non_euro_eu","advanced","emerging"]);
export const ALL_LABEL = s("ALL_LABEL");
export const FILTER_NOTE = s("FILTER_NOTE");
export const NON_EURO_MARK = s("NON_EURO_MARK");
export const SORT_LABELS = obj("SORT_LABELS", ["percentile","value_desc","value_asc","name"]);
export const NO_INDICATORS = s("NO_INDICATORS");
export const NO_RANKING_SPREAD = s("NO_RANKING_SPREAD");
export const EMPTY_GROUP = s("EMPTY_GROUP");

// DRAFT (not confirmed): Stage 3 (T117-T119) sentences of the V2 dot plot, written by the implementation.
export const DRAFT_PEER_DIRECTION = (directionText) => t("DRAFT_PEER_DIRECTION", {directionText});
export const DRAFT_PEER_FIGURE_LABEL = (indicatorName, n, column) => t("DRAFT_PEER_FIGURE_LABEL", {column, indicatorName, count: tp("DRAFT_COUNT_COUNTRIES", n)});
export const DRAFT_PEER_TABLE_CAPTION = (indicatorName) => t("DRAFT_PEER_TABLE_CAPTION", {indicatorName});
export const DRAFT_PEER_MARKS = s("DRAFT_PEER_MARKS");
export const DRAFT_PEER_GUIDES = s("DRAFT_PEER_GUIDES");
export const DRAFT_PEER_NOT_DRAWN = s("DRAFT_PEER_NOT_DRAWN");
export const DRAFT_PEER_FOCUS_HINT = s("DRAFT_PEER_FOCUS_HINT");

// --- V3 explorer --------------------------------------------------------------------------------------
export const TRANSFORM_LABELS = obj("TRANSFORM_LABELS", ["value","value_default_tf","value_yoy"]);
export const REBASE_NOTE = s("REBASE_NOTE");
export const REBASE_TOGGLE_LABEL = s("REBASE_TOGGLE_LABEL");
export const NO_SERIES = s("NO_SERIES");
export const NOT_SHOWN_TRANSFORM = s("NOT_SHOWN_TRANSFORM");
export const NOT_SHOWN_NO_VALUES = s("NOT_SHOWN_NO_VALUES");
export const NOT_SHOWN_NO_BASE = s("NOT_SHOWN_NO_BASE");
export const NO_SERIES_FILE = s("NO_SERIES_FILE");
export const REBASED_UNIT = s("REBASED_UNIT");
export const REBASED_Y_LABEL = s("REBASED_Y_LABEL");
export const ALERTS_HEADING = s("ALERTS_HEADING");
export const ALERT_NOT_DRAWN = s("ALERT_NOT_DRAWN");

// --- V4 revisions -------------------------------------------------------------------------------------
// Spec section 7 ("V4 vintage text", AC-EXP-12): the same for every series, equal to the spec sentence.
export const VINTAGE_TEXT = s("VINTAGE_TEXT");
export const EARLIEST_LABEL = s("EARLIEST_LABEL"); // spec section 7: never any other name for it
export const REVISED_DATA_NOTICE = s("REVISED_DATA_NOTICE");
export const REESTIMATION_NOTE = s("REESTIMATION_NOTE");
export const KIND_LABELS = obj("KIND_LABELS", ["all","regular","reestimation"]);
export const CLASS_LABEL = obj("CLASS_LABEL", ["regular","reestimation"]);
export const CHOOSE_INDICATOR_OPTION = s("CHOOSE_INDICATOR_OPTION");
export const ALL_PERIODS = s("ALL_PERIODS");
export const NO_ORDINARY = s("NO_ORDINARY");
export const NO_ORDINARY_CLASS = s("NO_ORDINARY_CLASS");
export const EDITIONS_INTRO = s("EDITIONS_INTRO");
export const NO_EDITIONS = s("NO_EDITIONS");
export const VINTAGE_CHOOSE = s("VINTAGE_CHOOSE");
export const VINTAGE_NONE = s("VINTAGE_NONE");
export const VINTAGE_EMPTY = s("VINTAGE_EMPTY");
export const NAMED_EDITION_MARK = s("NAMED_EDITION_MARK");
export const REVISED_DATA_HISTORY_MARK = s("REVISED_DATA_HISTORY_MARK");

// --- Global freshness line (G-STR2, decisions record section 4). CONFIRMED by the user (R20); replaces "Data as of". ---
export const FRESHNESS_LABEL = s("FRESHNESS_LABEL"); // confirmed by the user 2026-11-08
export const FRESHNESS_LINE = (date, buildId) => t("FRESHNESS_LINE", {label: FRESHNESS_LABEL, date: date ?? t("FRESHNESS_UNKNOWN"), buildId: buildId ?? t("FRESHNESS_UNKNOWN")}); // confirmed by the user 2026-11-08

// --- Stale banner (G-STALE, ADR-031). CONFIRMED by the user (R20); never prints the manifest field name. `date` is YYYY-MM-DD (UTC). ---
export const STALE_BANNER = (date, days, limit) => t("STALE_BANNER", {date, days, limit});
export const STALE_BANNER_UNREADABLE = s("STALE_BANNER_UNREADABLE");

// --- Stage 1: state vocabulary, percentile bins, legend, heatmap (T108-T112) --------------------------
// APPROVED (G2, 2026-11-05). Bin labels carry no judgement words. The brief fixes the first and the last label
// ("lowest fifth of the panel" .. "highest fifth of the panel"); the three between are the same pattern, written
// by the implementation (flagged for the Stage 1 review).
export const BIN_LABELS = arr("BIN_LABELS", 5);
// APPROVED: the visible short codes of the cells (brief section 5 and 11).
export const STATE_CODES = obj("STATE_CODES", ["stale","lagging","unaligned","na","not_published"]);
export const AHEAD_TAG = s("AHEAD_TAG");
// APPROVED (brief section 5, 'ahead' row).
export const AHEAD_NAME = s("AHEAD_NAME");
// APPROVED (brief section 4, 5 and 8).
export const SKIP_TO_TABLE = s("SKIP_TO_TABLE");
export const DETAILS_SUMMARY = s("DETAILS_SUMMARY");
// Accessible name of a stale cell (brief section 5: "stale: no rank" + age and limit).
export const STALE_NAME = s("STALE_NAME");
export const ALERT_LEVEL_PREFIX = s("ALERT_LEVEL_PREFIX"); // the stored level (watch or alert) follows; same text as the existing flag
export const COUNTRY_HEADER = s("COUNTRY_HEADER");
export const COVERAGE_HEADER = s("COVERAGE_HEADER");
export const POSITION_HEADER = s("POSITION_HEADER");

// ADR-026 decisions 2 and 4 (user decisions Q1 and Q2 recorded 2026-11-04): shown in the legend and as the description of
// the domain-figure column header; always this exact string.
export const ORIENTATION_NOTE = s("ORIENTATION_NOTE");
export const DIRECTION_LABELS = obj("DIRECTION_LABELS", ["higher","lower","target","descriptive"]);
// `closer to target is better (target <stored value> <unit_label>)`, only when the target value is stored.
export const directionWithTarget = (label, value, unit) => t("directionWithTarget", {label, target: `${value}${unit ? ` ${unit}` : ""}`});

// DRAFT (not confirmed): new Stage 1 sentences and labels written by the implementation.
export const DRAFT_LEGEND_TITLE = s("DRAFT_LEGEND_TITLE");
export const DRAFT_LEGEND_BINS = s("DRAFT_LEGEND_BINS");
export const DRAFT_LEGEND_STATES = s("DRAFT_LEGEND_STATES");
export const DRAFT_SCROLL_HINT = s("DRAFT_SCROLL_HINT");
export const DRAFT_HEATMAP_CAPTION = (domainName, label) => t("DRAFT_HEATMAP_CAPTION", {domainName, label});
export const DRAFT_HEATMAP_CAPTION_INFO = (domainName) => t("DRAFT_HEATMAP_CAPTION_INFO", {domainName, INFORMATIONAL_NOTICE});
export const DRAFT_FACT_LABELS = obj("DRAFT_FACT_LABELS", ["value","refPeriod","refOffset","release","age","limit","flags"]);
// APPROVED (brief section 5): the table mark of an estimated value, a suffix "e" after the figure.
export const ESTIMATE_MARK = s("ESTIMATE_MARK");

// --- Stage 4: V3 explorer chart (T120-T125) -----------------------------------------------------------
// APPROVED (G2, brief section 11, confirmed by the user 2026-11-05): "View as table" and "Selection".
export const VIEW_AS_TABLE = s("VIEW_AS_TABLE");
export const SELECTION_LABEL = s("SELECTION_LABEL");
// DRAFT (not confirmed): every other new Stage 4 string, written by the implementation. Listed in docs/ops/dashboard-ux-baseline.md.
export const DRAFT_SELECT_GROUP = s("DRAFT_SELECT_GROUP");
export const DRAFT_FREE_Y_LABEL = s("DRAFT_FREE_Y_LABEL");
export const DRAFT_CHART_SHOWS = s("DRAFT_CHART_SHOWS");
export const DRAFT_CHART_MARKS = s("DRAFT_CHART_MARKS");
export const DRAFT_REBASE_MARKS = s("DRAFT_REBASE_MARKS");
export const DRAFT_FACET_STATEMENT = s("DRAFT_FACET_STATEMENT");
export const DRAFT_Y_MODE = (free) => t(free ? "DRAFT_Y_MODE.free" : "DRAFT_Y_MODE.shared");
export const DRAFT_SERIES_LABEL_PART = (name, from, to, latestText) => t("DRAFT_SERIES_LABEL_PART", {name, from, to, latestText});
export const DRAFT_EXPLORER_FIGURE_LABEL = (title, yLabel, parts) => t("DRAFT_EXPLORER_FIGURE_LABEL", {title, yLabel, parts: parts.join("; ")});
export const DRAFT_TABLE_CAPTION_ALL = (title) => t("DRAFT_TABLE_CAPTION_ALL", {title}); // spec 5.6: every plotted value is in a table
export const DRAFT_TABLE_CAPTION = (title, n) => t("DRAFT_TABLE_CAPTION", {title, n});
export const DRAFT_TABLE_HEADERS = obj("DRAFT_TABLE_HEADERS", ["value","status"]);
export const DRAFT_DOWNLOAD = s("DRAFT_DOWNLOAD");

// --- V4 revisions table (T126) ---------------------------------------------------------------------------
// DRAFT (not confirmed, gate G2): the bar-length label. Brief section 3.3 quotes "bar length is relative to the largest revision
// shown"; the "(revision %)" part says which column the bar draws. Listed in docs/ops/dashboard-ux-baseline.md.
export const DRAFT_BAR_LABEL = s("DRAFT_BAR_LABEL");

// --- V4 vintage step chart (T127) ---------------------------------------------------------------------------
// DRAFT (not confirmed, gate G2): the sentences around the step chart. The FIXED vintage text and EARLIEST_LABEL are unchanged.
export const DRAFT_STEP_CHOOSE_PERIOD = s("DRAFT_STEP_CHOOSE_PERIOD");
export const DRAFT_STEP_NOTE = s("DRAFT_STEP_NOTE");
export const DRAFT_STEP_REMOVED = s("DRAFT_STEP_REMOVED");
export const DRAFT_STEP_FIGURE_LABEL = (title, country, period, yLabel, parts) => t("DRAFT_STEP_FIGURE_LABEL", {title, country, period, yLabel, parts: parts.join("; ")});
export const DRAFT_STEP_FIGURE_PART = (known, valueText) => t("DRAFT_STEP_FIGURE_PART", {known, valueText});
export const DRAFT_STEP_SKIP = s("DRAFT_STEP_SKIP");

// --- Redesign R3: missing-data sentences (spec 5.1 and 7). DRAFT: written from the spec, not confirmed by the user. ---
export const DRAFT_NOT_PUBLISHED_SENTENCE = s("DRAFT_NOT_PUBLISHED_SENTENCE");
export const DRAFT_NA_DEFINED_SENTENCE = s("DRAFT_NA_DEFINED_SENTENCE");
// G-STR1 (docs/ops/dashboard-redesign-decisions.md section 4): the test (pair absent from meta/series.json) only shows
// "not in this export's series list", so the sentence says that.
export const G_STR1_NO_SERIES = s("G_STR1_NO_SERIES"); // confirmed by the user 2026-11-08
// DRAFT: a value (or domain row) is stored without a percentile and no stored field states why.
export const DRAFT_NA_NO_PERCENTILE_SENTENCE = s("DRAFT_NA_NO_PERCENTILE_SENTENCE");
export const DRAFT_NA_NO_RANKED_SENTENCE = s("DRAFT_NA_NO_RANKED_SENTENCE");

// DRAFT (not confirmed): Redesign R6 country page labels and figure-line wording (spec C-CTRY-1, 4.2 header, section 2 breadcrumb).
export const DRAFT_CRUMB_LABEL = s("DRAFT_CRUMB_LABEL");
export const DRAFT_CRUMB_HOME = s("DRAFT_CRUMB_HOME");
export const DRAFT_CRUMB_COUNTRIES = s("DRAFT_CRUMB_COUNTRIES");
export const DRAFT_COUNTRY_KIND_LABEL = s("DRAFT_COUNTRY_KIND_LABEL");
export const DRAFT_COUNTRY_GROUPS_LABEL = s("DRAFT_COUNTRY_GROUPS_LABEL");
export const DRAFT_COUNTRY_NO_GROUPS = s("DRAFT_COUNTRY_NO_GROUPS");
export const DRAFT_WITHOUT_VALUE_GROUP = s("DRAFT_WITHOUT_VALUE_GROUP");
export const DRAFT_FIGURE_COVERAGE = (nAvailable, nDefined) => t("DRAFT_FIGURE_COVERAGE", {nAvailable, nDefined});
export const DRAFT_FIGURE_POSITION = (position, nRanked) => t("DRAFT_FIGURE_POSITION", {position, nRanked});

// DRAFT (not confirmed): Redesign R7 country page rendering (spec C-CTRY-2, C-CTRY-3, 4.2 controls).
export const DRAFT_COUNTRY_SWITCHER_LABEL = s("DRAFT_COUNTRY_SWITCHER_LABEL");
export const DRAFT_COUNTRY_SWITCHER_GO = s("DRAFT_COUNTRY_SWITCHER_GO");
export const DRAFT_COUNTRY_FILTER_LEGEND = s("DRAFT_COUNTRY_FILTER_LEGEND");
export const DRAFT_COUNTRY_FILTER_ALL = s("DRAFT_COUNTRY_FILTER_ALL");
export const DRAFT_COUNTRY_FILTER_VALUE = s("DRAFT_COUNTRY_FILTER_VALUE");
export const DRAFT_COUNTRY_COLUMNS = obj("DRAFT_COUNTRY_COLUMNS", ["indicator","value","period","percentile","source","actions","reason"]);
export const DRAFT_COUNTRY_TABLE_CAPTION = (domainName, countryName) => t("DRAFT_COUNTRY_TABLE_CAPTION", {domainName, countryName});
export const DRAFT_PROFILE_FIGURE_LABEL = (countryName, domainName) => t("DRAFT_PROFILE_FIGURE_LABEL", {countryName, domainName});
export const DRAFT_PROFILE_DOT_LABEL = (name, percentileText) => t("DRAFT_PROFILE_DOT_LABEL", {name, percentileText});
export const DRAFT_OFFSET_FLAG = (days) => t("DRAFT_OFFSET_FLAG", {days});
// G-STR3 (decisions record section 4): one label per target. "Compare with other countries" is dropped.
export const COMPARE_COUNTRIES = s("COMPARE_COUNTRIES"); // to PG-INDICATOR // confirmed by the user 2026-11-08
export const COMPARE_COUNTRIES_LABEL = (indicatorName) => t("COMPARE_COUNTRIES_LABEL", {indicatorName}); // confirmed by the user 2026-11-08
export const SERIES_LINK_LABEL = (indicatorName, countryName) => t("SERIES_LINK_LABEL", {indicatorName, countryName}); // confirmed by the user 2026-11-08
export const HEATMAP_INDICATOR_LINK = s("HEATMAP_INDICATOR_LINK"); // visible text of the column-header link (R11); confirmed by the user 2026-11-08
export const HEATMAP_INDICATOR_LINK_LABEL = (name) => t("HEATMAP_INDICATOR_LINK_LABEL", {name}); // full name for assistive tech, starts with the visible text; confirmed by the user 2026-11-08

// DRAFT (not confirmed): Redesign R8 "About this value" field list (spec 5.5) and "Show history" (C-CTRY-3, AC-RD-14). Labels only; no prose.
export const DRAFT_ABOUT_SUMMARY = s("DRAFT_ABOUT_SUMMARY");
export const DRAFT_ABOUT_LABELS = obj("DRAFT_ABOUT_LABELS", ["indicator","country","seriesId","source","attribution","frequency","unit","seasonal","priceBasis","refPeriod","knownAt","sourceRelease","age","staleLimit","transform","flags","reestimating"]);
export const DRAFT_REESTIMATED_MARK = s("DRAFT_REESTIMATED_MARK");
export const DRAFT_HISTORY_SHOW = s("DRAFT_HISTORY_SHOW");
export const DRAFT_HISTORY_HIDE = s("DRAFT_HISTORY_HIDE");
export const DRAFT_HISTORY_REGION = s("DRAFT_HISTORY_REGION");
export const DRAFT_HISTORY_CONSEQUENCE = s("DRAFT_HISTORY_CONSEQUENCE");
export const DRAFT_HISTORY_FIGURE_LABEL = (indicatorName, countryName, unit) => t("DRAFT_HISTORY_FIGURE_LABEL", {indicatorName, countryName, unit});
export const DRAFT_HISTORY_TABLE_TITLE = (indicatorName, countryName) => t("DRAFT_HISTORY_TABLE_TITLE", {indicatorName, countryName});

// DRAFT (not confirmed): Redesign R9 indicator page header and row table labels (spec 4.3 header, C-IND-5). Labels only; no prose.
export const DRAFT_CRUMB_INDICATORS = s("DRAFT_CRUMB_INDICATORS");
export const DRAFT_INDICATOR_FACT_LABELS = obj("DRAFT_INDICATOR_FACT_LABELS", ["id","domains","unit","frequency","direction","notes","transform"]);
export const DRAFT_INDICATOR_COLUMNS = obj("DRAFT_INDICATOR_COLUMNS", ["country","value","period","offset","percentile"]);
export const DRAFT_INDICATOR_TABLE_CAPTION = (indicatorName) => t("DRAFT_INDICATOR_TABLE_CAPTION", {indicatorName});

// DRAFT (not confirmed): Redesign R10 indicator page controls, table and charts (spec C-IND-1 to C-IND-7). Labels only. The reference-period line (C-IND-2)
// reuses the confirmed spreadText() sentence of peers.js (decisions record 2b).
export const DRAFT_INDICATOR_SORT_LABEL = s("DRAFT_INDICATOR_SORT_LABEL");
export const DRAFT_INDICATOR_SORT_LABELS = obj("DRAFT_INDICATOR_SORT_LABELS", ["name","value","percentile","period"]);
export const DRAFT_INDICATOR_SWITCHER_GO = s("DRAFT_INDICATOR_SWITCHER_GO");
export const DRAFT_INDICATOR_COLUMNS_MORE = obj("DRAFT_INDICATOR_COLUMNS_MORE", ["flags","source","actions","reason"]);
export const DRAFT_TRANSFORMED_HEADER = (transformLabel) => t("DRAFT_TRANSFORMED_HEADER", {transformLabel});
export const DRAFT_OPEN_AS_SERIES = s("DRAFT_OPEN_AS_SERIES");
export const INDICATOR_SERIES_LINK = s("INDICATOR_SERIES_LINK"); // row link to PG-SERIES (also used on the country page, G-STR3) // confirmed by the user 2026-11-08
// DRAFT (AC-RD-42): a value with no stored unit is a defect; it is stated, never shown as a bare number or "n/a".
export const DRAFT_UNIT_MISSING_SENTENCE = s("DRAFT_UNIT_MISSING_SENTENCE");
export const DRAFT_VALUE_AXIS_TITLE = (indicatorName, unit) => t("DRAFT_VALUE_AXIS_TITLE", {indicatorName, unit: unit || DRAFT_UNIT_MISSING_SENTENCE});
export const DRAFT_VALUE_FIGURE_LABEL = (indicatorName, unit, n) => t("DRAFT_VALUE_FIGURE_LABEL", {indicatorName, unitPhrase: unit ? t("DRAFT_IN_UNIT", {unit}) : DRAFT_UNIT_MISSING_SENTENCE, count: tp("DRAFT_COUNT_COUNTRIES", n)});
export const DRAFT_VALUE_ESTIMATE_MARK = s("DRAFT_VALUE_ESTIMATE_MARK");
export const DRAFT_VALUE_NEUTRAL_LEGEND = s("DRAFT_VALUE_NEUTRAL_LEGEND");

// DRAFT (not confirmed): Redesign R13 PG-SERIES defaults (spec C-SER-1, C-SER-2, AC-RD-31, AC-RD-34).
export const DRAFT_CHOOSE_COUNTRIES_HINT = s("DRAFT_CHOOSE_COUNTRIES_HINT");
// Visible notes (AC-RD-34; decisions record section 3): unrecognised parts, and valid countries with no rows in this export.
export const HASH_FALLBACK_NOTE = s("HASH_FALLBACK_NOTE"); // confirmed by the user 2026-11-08
export const HASH_NO_ROWS_NOTE = (names) => t("HASH_NO_ROWS_NOTE", {names: names.join(", ")}); // confirmed by the user 2026-11-08
export const OTHER_INDICATORS_GROUP = s("OTHER_INDICATORS_GROUP"); // confirmed by the user 2026-11-08

// DRAFT (not confirmed): Redesign R14 PG-SERIES "About these series" table (spec C-SER-6) and the unit in the title and table header (AC-RD-32).
export const DRAFT_ABOUT_SERIES_HEADING = s("DRAFT_ABOUT_SERIES_HEADING");
export const DRAFT_ABOUT_SERIES_COLUMNS = obj("DRAFT_ABOUT_SERIES_COLUMNS", ["country","source","attribution","frequency","unit","seasonal","priceBasis","lastPeriod","knownAt","reestimating"]);
export const DRAFT_TITLE_UNIT = (unit) => t("DRAFT_TITLE_UNIT", {unit});
export const DRAFT_VALUE_HEADER_UNIT = (unit) => t("DRAFT_VALUE_HEADER_UNIT", {unit});

// DRAFT (not confirmed): Redesign R16 point reader and tip (amendment 3.3). Labels reuse COUNTRY_HEADER and DRAFT_FACT_LABELS.refPeriod.
export const POINT_READER_LEGEND = s("POINT_READER_LEGEND"); // confirmed by the user 2026-11-08
export const TIP_STATUS = obj("TIP_STATUS", ["EST","PROV"]); // any other value_status: no status line // confirmed by the user 2026-11-08
export const TIP_KNOWN_AT = (date) => t("TIP_KNOWN_AT", {date}); // confirmed by the user 2026-11-08
export const READER_NONE = s("READER_NONE"); // confirmed by the user 2026-11-08; first option of the PG-INDICATOR reader select while no country is in focus

// DRAFT (not confirmed): Redesign R17/R18 home and domains pages (spec 4.1 C-HOME-2..4, 4.5; decisions record G-STR4). Labels only.
export const HOME_LINKS = obj("HOME_LINKS", ["series","domains","revisions"]); // equal to the nav page names (G-STR4) // confirmed by the user 2026-11-08
export const HOME_COUNTRIES_HEADING = s("HOME_COUNTRIES_HEADING"); // confirmed by the user 2026-11-08
export const HOME_AGGREGATES_HEADING = s("HOME_AGGREGATES_HEADING"); // confirmed by the user 2026-11-08
export const HOME_INDICATORS_HEADING = s("HOME_INDICATORS_HEADING"); // confirmed by the user 2026-11-08
export const HOME_FILTER_LABEL = obj("HOME_FILTER_LABEL", ["countries","indicators"]); // confirmed by the user 2026-11-09 (spec re-approval)
export const DRAFT_HOME_FILTER_COUNT = (n) => t("DRAFT_HOME_FILTER_COUNT", {n});
export const DRAFT_HOME_FILTER_NONE = s("DRAFT_HOME_FILTER_NONE");
export const DRAFT_HOME_DOMAINS_TITLE = HOME_LINKS.domains; // title and h1 of PG-DOMAINS (R17); the confirmed home-link text

// DRAFT (not confirmed): Layout L3 (layout amendment sections 6 and 7; ADR-025 decision 11). Labels and single sentences only.
export const DRAFT_FILTER_LABELS = obj("DRAFT_FILTER_LABELS", ["filters","group","country","domain","indicator","period","frequency","from","to","all","reset"]);
export const DRAFT_FILTER_ALL = obj("DRAFT_FILTER_ALL", ["countries","domains","frequencies"]);
export const DRAFT_FREQUENCY_NAMES = obj("DRAFT_FREQUENCY_NAMES", ["D","M","Q","A"]);
export const DRAFT_PERIOD_PRESETS = obj("DRAFT_PERIOD_PRESETS", ["all","last10","last5"]);
export const DRAFT_BAND_TITLES = obj("DRAFT_BAND_TITLES", ["overview","compare","indicators","overTime"]);
export const DRAFT_BAND_TABLE = s("DRAFT_BAND_TABLE"); // L23: band title named in amendment 4.3 but absent from the section 7 string list (pending user confirmation)
export const DRAFT_BAND_REVISIONS = s("DRAFT_BAND_REVISIONS"); // L24: PG-REVISIONS band title (h2), previously a literal in scripts/lib.mjs (pending user confirmation)
export const DRAFT_CARD_REVISIONS = s("DRAFT_CARD_REVISIONS"); // L24: PG-REVISIONS card title (h3, amendment heading rule); not in the amendment string list (pending confirmation)
export const DRAFT_DOMAINS_BAND = s("DRAFT_DOMAINS_BAND"); // L24: h2 of PG-DOMAINS; a constant of its own, no longer DRAFT_FILTER_ALL.domains (pending confirmation)
export const DRAFT_ALL_DOMAINS_LINK = s("DRAFT_ALL_DOMAINS_LINK"); // L24: link from PG-DOMAIN to PG-DOMAINS (pending confirmation)
export const DRAFT_GROUP_BROWSE = s("DRAFT_GROUP_BROWSE");
export const DRAFT_BROWSE_SUMMARY = s("DRAFT_BROWSE_SUMMARY");
export const DRAFT_GROUP_REFERENCE_ROWS = s("DRAFT_GROUP_REFERENCE_ROWS");
export const DRAFT_LOAD_HISTORY = s("DRAFT_LOAD_HISTORY");
export const DRAFT_SHOW_MORE = s("DRAFT_SHOW_MORE");
export const DRAFT_CHART_MODES = obj("DRAFT_CHART_MODES", ["lines","bars"]);
export const DRAFT_CHART_TYPE_LEGEND = s("DRAFT_CHART_TYPE_LEGEND"); // L20: legend of the Lines / Bars radio group; not in the amendment string list (pending confirmation)
export const DRAFT_CHOOSE_COUNTRY_PLACEHOLDER = s("DRAFT_CHOOSE_COUNTRY_PLACEHOLDER");
export const DRAFT_EMPTY_CARD = s("DRAFT_EMPTY_CARD");
export const DRAFT_KPI_ERROR_CONSEQUENCE = s("DRAFT_KPI_ERROR_CONSEQUENCE"); // L14: shown inside the overview card only when its scorecard fails
export const DRAFT_SPARKLINE_TOO_FEW = s("DRAFT_SPARKLINE_TOO_FEW");
export const DRAFT_HOME_H1 = s("DRAFT_HOME_H1"); // pending user confirmation (ADR-034 A1 item 5); the home page h1 is not switched yet (B-H1)
export const DRAFT_FILTER_CHIP_SUMMARY = (label, value) => t("DRAFT_FILTER_CHIP_SUMMARY", {label, value});
export const DRAFT_PERIOD_VALUE = (from, to) => t("DRAFT_PERIOD_VALUE", {from, to});
export const DRAFT_PRINT_FILTERS = (parts) => t("DRAFT_PRINT_FILTERS", {parts: parts.length ? parts.join("; ") : t("DRAFT_PRINT_FILTERS_NONE")});
// The one count sentence (amendment 2.2, AC-DB-36): shown only when n > 0, no percentage, share or total.
export const DRAFT_HIDDEN_ROWS = (n) => (n > 0 ? tp("DRAFT_HIDDEN_ROWS", n) : ""); // ADR-036 decision 5: singular fix
export const DRAFT_HIDDEN_ROW_ITEM = (name, period) => t("DRAFT_HIDDEN_ROW_ITEM", {name, period}); // ADR-036 decision 5: one list item per hidden row
// DRAFT (not confirmed): Layout L12, the ranked comparison card (layout amendment 4.7). Labels only.
export const DRAFT_RANK_SORT_LABELS = obj("DRAFT_RANK_SORT_LABELS", ["name","value","percentile"]);
export const DRAFT_RANK_COLUMNS = obj("DRAFT_RANK_COLUMNS", ["bar","dot"]);
// DRAFT (not confirmed): Layout L8 and L9, the Country and Period chips (layout amendment 2.1, 2.5).
export const DRAFT_COUNTRY_LIMIT = (n) => t("DRAFT_COUNTRY_LIMIT", {n});
export const DRAFT_COUNTRY_SELECTED = (n) => t("DRAFT_COUNTRY_SELECTED", {n});
export const DRAFT_COUNTRY_CHIP_HELP = s("DRAFT_COUNTRY_CHIP_HELP"); // visible help text inside the open Country chip
export const DRAFT_PERIOD_INVALID = s("DRAFT_PERIOD_INVALID");
export const DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE = s("DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE");
export const DRAFT_PERIOD_REGION = s("DRAFT_PERIOD_REGION");

// DRAFT (not confirmed): Dashboard v2 (ADR-037) V5 caption block labels (spec 6.1). Labels and one fixed vintage line; the user confirms wording.
export const DRAFT_NOT_STATED = s("DRAFT_NOT_STATED");
export const DRAFT_CAPTION_LABELS = obj("DRAFT_CAPTION_LABELS", ["indicator","unit","frequency","seasonal","period","scale","source","vintage"]);
export const DRAFT_CAPTION_SEASONAL = obj("DRAFT_CAPTION_SEASONAL", ["SA","NSA","NA"]);
export const DRAFT_CAPTION_VINTAGE = (date) => t("DRAFT_CAPTION_VINTAGE", {date}); // spec 6.1
export const DRAFT_CAPTION_LEGEND = obj("DRAFT_CAPTION_LEGEND", ["EST","PROV"]); // legend text codes for the value_status marks (spec 6.8); the code itself is stored

// DRAFT (not confirmed): Dashboard v2 (ADR-037 A1.4, ADR-036 Amendment 1) V4 hidden-rows disclosure. English plural variants per category arrive with V45.
export const DRAFT_HIDDEN_REASON_LABELS = obj("DRAFT_HIDDEN_REASON_LABELS", ["no_data","stale","other_period","other"]);
// "{N} rows hidden: {X} no data, {Y} stale, {Z} other period" with ", {W} other" only when W > 0; a zero part is omitted; singular "1 row hidden: 1 no data"; "" at N = 0 (ADR-036 I7).
export const DRAFT_HIDDEN_SUMMARY = (counts) => {
  const parts = ["no_data", "stale", "other_period", "other"].filter((k) => counts?.[k] > 0).map((k) => t(`HIDDEN_PART.${k}`, {n: counts[k]}));
  return counts?.total > 0 ? tp("DRAFT_HIDDEN_SUMMARY", counts.total, {parts: parts.join(", ")}) : "";
};
export const DRAFT_HIDDEN_LIST_ITEM = (label, reasonLabel, period, sentence) => t("DRAFT_HIDDEN_LIST_ITEM", {label, reasonLabel, period, sentence}); // label, reason category, stored period or the not-stated marker, stored reason sentence

// DRAFT (not confirmed): Dashboard v2 (ADR-037) V6 strings consumed by the later chart, mode and picker tasks. Labels and short messages only; the user confirms wording (G-STR).
export const DRAFT_NO_ALIGNED = s("DRAFT_NO_ALIGNED"); // AC-V2-81: empty card of a snapshot chart whose rows are all hidden, with the disclosure
export const DRAFT_BLOCKED_FIELD_LABELS = obj("DRAFT_BLOCKED_FIELD_LABELS", ["unit_code","unit_mult","price_basis","flow_basis","base_period","frequency"]); // stored field -> label (compat.js blocking fields)
export const DRAFT_BLOCKED_MESSAGE = (fields) => t("DRAFT_BLOCKED_MESSAGE", {fields: fields.join(", ")});
export const DRAFT_MARKED_SEASONAL = s("DRAFT_MARKED_SEASONAL"); // compat.js marks, never blocks, a seasonal_adjustment mix (spec 6.6)
export const DRAFT_COMPAT_SKIPPED = (fields) => t("DRAFT_COMPAT_SKIPPED", {fields: fields.join(", ")}); // fields absent from every series of the selection (A1.6)
export const DRAFT_MODE_SWITCH_LABEL = s("DRAFT_MODE_SWITCH_LABEL");
export const DRAFT_MODE_LABELS = obj("DRAFT_MODE_LABELS", ["country","compare"]);
export const DRAFT_PICKER_LABELS = obj("DRAFT_PICKER_LABELS", ["country","group","countries","aggregates","placeholder"]);
export const DRAFT_SHOW_PERCENTILE = s("DRAFT_SHOW_PERCENTILE");
export const DRAFT_SHOW_STALE = s("DRAFT_SHOW_STALE");
export const DRAFT_INCLUDE_OTHER_PERIODS = s("DRAFT_INCLUDE_OTHER_PERIODS");
export const DRAFT_CONTEXT_LINES = s("DRAFT_CONTEXT_LINES");
export const DRAFT_STALE_CODE = s("DRAFT_STALE_CODE"); // text code printed after a stale row label or in a tip (non-colour channel, A1.1)
export const DRAFT_REBASE_STATEMENT = (period) => t("DRAFT_REBASE_STATEMENT", {period}); // kept for when CR-18 exists (spec 6.4)

// DRAFT (not confirmed): Dashboard v2 Country mode (ADR-037, plan V11 to V16): card titles, facet controls, tip lines and labels of the K1, L1, L2, P1a and T1 cards. The user confirms wording (G-STR).
export const DRAFT_COUNTRY_CARD_TITLES = obj("DRAFT_COUNTRY_CARD_TITLES", ["k1","l1","p1","t1","l2"]);
export const DRAFT_L1_SUMMARY = (domainName) => t("DRAFT_L1_SUMMARY", {domainName});
export const DRAFT_FACET_EXPAND = s("DRAFT_FACET_EXPAND");
export const DRAFT_FACET_COLLAPSE = s("DRAFT_FACET_COLLAPSE");
export const DRAFT_SERIES_UNREADABLE = s("DRAFT_SERIES_UNREADABLE");
export const DRAFT_STALE_TIP = (period) => t("DRAFT_STALE_TIP", {period}); // tip line of the last point of a stale series (A1.1)
export const DRAFT_STALE_PERIOD = (period) => t("DRAFT_STALE_PERIOD", {period}); // K1 card marker text: the code and the stored period
export const DRAFT_REVISIONS_LINK_LABEL = (indicatorName) => t("DRAFT_REVISIONS_LINK_LABEL", {indicatorName});
export const DRAFT_STATE_COLUMN = s("DRAFT_STATE_COLUMN"); // T1 and P1a table column of the stored state sentence (percentile layer off)
export const DRAFT_P1A_FIGURE_LABEL = (indicatorName, period, unit) => t("DRAFT_P1A_FIGURE_LABEL", {indicatorName, period, unit});
export const DRAFT_P1A_REFERENCE = (period) => t("DRAFT_P1A_REFERENCE", {period}); // printed beside the strip: the one stored period the drawn rows share
export const DRAFT_P1A_TABLE_CAPTION = (indicatorName, period) => t("DRAFT_P1A_TABLE_CAPTION", {indicatorName, period});
export const DRAFT_P1A_MARKS = s("DRAFT_P1A_MARKS");
export const DRAFT_P1A_AGGREGATES_NOTE = s("DRAFT_P1A_AGGREGATES_NOTE");
export const DRAFT_P1A_NO_REFERENCE = s("DRAFT_P1A_NO_REFERENCE");

// DRAFT (not confirmed): Dashboard v2 Compare mode (ADR-037, plan V17 to V23): card titles, control labels, tip lines and labels of C1 to C5 and T2. Labels and short messages only; the user confirms wording (G-STR).
export const DRAFT_COMPARE_CARD_TITLES = obj("DRAFT_COMPARE_CARD_TITLES", ["c1","c2","c3","c4","c5","t2"]);
export const DRAFT_COMPARE_CONTROL_LABELS = obj("DRAFT_COMPARE_CONTROL_LABELS", ["domain","countries","x","y","p","choose","latest","sort"]);
export const DRAFT_COMPARE_CONTROLS_LABEL = (title) => t("DRAFT_COMPARE_CONTROLS_LABEL", {title});
export const DRAFT_COMPARE_CHOOSE_INDICATOR = s("DRAFT_COMPARE_CHOOSE_INDICATOR");
export const DRAFT_COMPARE_CHOOSE_PAIR = s("DRAFT_COMPARE_CHOOSE_PAIR");
export const DRAFT_COMPARE_SORTS = obj("DRAFT_COMPARE_SORTS", ["value","name","percentile"]);
export const DRAFT_COMPARE_DEFAULT_COUNTRIES = s("DRAFT_COMPARE_DEFAULT_COUNTRIES");
export const DRAFT_C2_NO_RANK_REFERENCE = s("DRAFT_C2_NO_RANK_REFERENCE"); // D2: the stored rank_reference_period is null; no period is chosen for the reader
export const DRAFT_COMPARE_SERIES_PENDING = s("DRAFT_COMPARE_SERIES_PENDING");
export const DRAFT_COMPARE_SECONDARY = (title) => t("DRAFT_COMPARE_SECONDARY", {title}); // summary of the collapsed secondary block (C5, T2), present only while pc is on
export const DRAFT_C1_MARKS = s("DRAFT_C1_MARKS");
export const DRAFT_C1_FIGURE_LABEL = (name, unit, parts) => t("DRAFT_C1_FIGURE_LABEL", {name, unit, parts: parts.join("; ")});
export const DRAFT_C2_FIGURE_LABEL = (name, period, unit) => t("DRAFT_C2_FIGURE_LABEL", {name, period, unit});
export const DRAFT_C2_MARKS = s("DRAFT_C2_MARKS");
export const DRAFT_C2_TABLE_CAPTION = (name, period) => t("DRAFT_C2_TABLE_CAPTION", {name, period});
export const DRAFT_C3_FIGURE_LABEL = (xName, xUnit, yName, yUnit, period) => t("DRAFT_C3_FIGURE_LABEL", {xName, xUnit, yName, yUnit, period});
export const DRAFT_C3_TABLE_CAPTION = (xName, yName, period) => t("DRAFT_C3_TABLE_CAPTION", {xName, yName, period});
export const DRAFT_C3_NO_COMMON = s("DRAFT_C3_NO_COMMON");
export const DRAFT_C3_MARKS = s("DRAFT_C3_MARKS");
export const DRAFT_NO_VALUE_FOR = (names) => t("DRAFT_NO_VALUE_FOR", {names: names.join(", ")}); // stored reason of a country left out of C3 (names of the indicators it lacks)
export const DRAFT_C4_FIGURE_LABEL = (name, unit, first, last) => t("DRAFT_C4_FIGURE_LABEL", {name, unit, first, last});
export const DRAFT_C4_SCALE = (min, max) => t("DRAFT_C4_SCALE", {min, max});
export const DRAFT_C4_BLANK = s("DRAFT_C4_BLANK");
export const DRAFT_C4_MARKS = s("DRAFT_C4_MARKS");
export const DRAFT_C4_TABLE_CAPTION = (name, unit) => t("DRAFT_C4_TABLE_CAPTION", {name, unit});
export const DRAFT_C4_OUTLINE_MARK = s("DRAFT_C4_OUTLINE_MARK");
export const DRAFT_C4_LEGEND = obj("DRAFT_C4_LEGEND", ["min","max"]);

// DRAFT (not confirmed): Dashboard v2 chart C6, the choropleth map (ADR-037 A2.2, plan V53 to V55). Labels and short messages only; the user confirms the wording.
export const DRAFT_C6_CARD_TITLE = s("DRAFT_C6_CARD_TITLE");
export const DRAFT_C6_FIGURE_LABEL = (name, period, unit) => t("DRAFT_C6_FIGURE_LABEL", {name, period, unit});
export const DRAFT_C6_SCALE = (min, max) => t("DRAFT_C6_SCALE", {min, max});
export const DRAFT_C6_LEGEND_UNIT = (unit) => t("DRAFT_C6_LEGEND_UNIT", {unit});
export const DRAFT_C6_MARKS = s("DRAFT_C6_MARKS");
export const DRAFT_C6_AGGREGATES_NOTE = s("DRAFT_C6_AGGREGATES_NOTE");
export const DRAFT_C6_SOURCE_NOTE = s("DRAFT_C6_SOURCE_NOTE");
export const DRAFT_C6_TABLE_CAPTION = (name, period) => t("DRAFT_C6_TABLE_CAPTION", {name, period});
export const DRAFT_C6_SKIP_TO_TABLE = s("DRAFT_C6_SKIP_TO_TABLE");
export const DRAFT_C6_NOT_MAPPED = obj("DRAFT_C6_NOT_MAPPED", ["aggregate","outside","nogeometry"]);
export const DRAFT_C6_NOT_MAPPED_SENTENCE = (why, stored) => t("DRAFT_C6_NOT_MAPPED_SENTENCE", {why, stored});
export const DRAFT_C6_GEO_PENDING = s("DRAFT_C6_GEO_PENDING");
export const DRAFT_C6_GEO_UNREADABLE = s("DRAFT_C6_GEO_UNREADABLE");
export const DRAFT_C6_STORED = (value, period) => t("DRAFT_C6_STORED", {value, period}); // the stored value and its period, in the state text of a country that is not drawn

// DRAFT (not confirmed): Dashboard v2 Home composition (plan V56 to V59, G-HOME-CONST). Labels and short messages only; the user confirms the wording.
export const DRAFT_HOME_PANEL_TITLES = obj("DRAFT_HOME_PANEL_TITLES", ["c2","c1","c6","c4"]); // panels A, B, C, D
export const DRAFT_HOME_PANELS_LABEL = s("DRAFT_HOME_PANELS_LABEL");
export const DRAFT_HOME_CONTROLS_LABEL = s("DRAFT_HOME_CONTROLS_LABEL");
export const DRAFT_HOME_KPI_TITLE = s("DRAFT_HOME_KPI_TITLE");
export const DRAFT_HOME_KPI_FOR = (name) => t("DRAFT_HOME_KPI_FOR", {name});
export const DRAFT_HOME_KPI_NO_VALUE = s("DRAFT_HOME_KPI_NO_VALUE");
export const DRAFT_HOME_KPI_NOT_LOADED = s("DRAFT_HOME_KPI_NOT_LOADED");
export const DRAFT_HOME_MISSING_SUMMARY = s("DRAFT_HOME_MISSING_SUMMARY");
export const DRAFT_HOME_MISSING_ITEM = (constant, id) => t("DRAFT_HOME_MISSING_ITEM", {constant, id});
export const DRAFT_HOME_SCORECARD_PENDING = s("DRAFT_HOME_SCORECARD_PENDING");
export const DRAFT_HOME_COUNTRY_LABEL = s("DRAFT_HOME_COUNTRY_LABEL");
export const DRAFT_HOME_MODE_LABEL = s("DRAFT_HOME_MODE_LABEL");
