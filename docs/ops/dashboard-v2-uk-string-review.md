# Ukrainian string review sheet (G-LANG-STR) - DRAFT

Prepared 2026-11-14 from `site/src/lib/copy.js` (every exported `DRAFT_*` constant, 347 leaf entries). Not approved. Rules (plan gate G-LANG-STR, ADR-025 decision 11): the Ukrainian column is empty on purpose: no agent translation is proposed here, because a machine-written string must not reach production unreviewed. Fill the column (or name a reviewer), then the status of an entry may be set to `reviewed` by the user or the named reviewer only. Entries with a function value take parameters; the full text is in `copy.js`.

## Items that need the user before any Ukrainian string is accepted

1. Quarter label forms: proposed en "Q1 2024", uk "1 кв. 2024" (from the plan). Confirm or change.
2. The Ukrainian judgement-word list (words the prose scan must reject in Ukrainian text). Not supplied; V44 cannot test it without it.
3. Ukrainian entity (country) names: V47 proposes, the user reviews.
4. Whether Ukrainian entries that are not `reviewed` fall back to English with `lang="en"` (plan default) in production.

## Strings

| # | Key | English (current DRAFT) | Ukrainian | Status |
|---|---|---|---|---|
| 1 | `DRAFT_ABOUT_LABELS.indicator` | Indicator |  | proposed (en only) |
| 2 | `DRAFT_ABOUT_LABELS.country` | Country |  | proposed (en only) |
| 3 | `DRAFT_ABOUT_LABELS.seriesId` | Series id |  | proposed (en only) |
| 4 | `DRAFT_ABOUT_LABELS.source` | Source |  | proposed (en only) |
| 5 | `DRAFT_ABOUT_LABELS.attribution` | Attribution |  | proposed (en only) |
| 6 | `DRAFT_ABOUT_LABELS.frequency` | Frequency |  | proposed (en only) |
| 7 | `DRAFT_ABOUT_LABELS.unit` | Unit |  | proposed (en only) |
| 8 | `DRAFT_ABOUT_LABELS.seasonal` | Seasonal adjustment |  | proposed (en only) |
| 9 | `DRAFT_ABOUT_LABELS.priceBasis` | Price basis |  | proposed (en only) |
| 10 | `DRAFT_ABOUT_LABELS.refPeriod` | Reference period |  | proposed (en only) |
| 11 | `DRAFT_ABOUT_LABELS.knownAt` | Known at |  | proposed (en only) |
| 12 | `DRAFT_ABOUT_LABELS.sourceRelease` | Source release at |  | proposed (en only) |
| 13 | `DRAFT_ABOUT_LABELS.age` | Age (days) |  | proposed (en only) |
| 14 | `DRAFT_ABOUT_LABELS.staleLimit` | Staleness limit (days) |  | proposed (en only) |
| 15 | `DRAFT_ABOUT_LABELS.transform` | Transform |  | proposed (en only) |
| 16 | `DRAFT_ABOUT_LABELS.flags` | Flags |  | proposed (en only) |
| 17 | `DRAFT_ABOUT_LABELS.reestimating` | Re-estimation |  | proposed (en only) |
| 18 | `DRAFT_ABOUT_SERIES_COLUMNS.country` | Country |  | proposed (en only) |
| 19 | `DRAFT_ABOUT_SERIES_COLUMNS.source` | Source |  | proposed (en only) |
| 20 | `DRAFT_ABOUT_SERIES_COLUMNS.attribution` | Attribution |  | proposed (en only) |
| 21 | `DRAFT_ABOUT_SERIES_COLUMNS.frequency` | Frequency |  | proposed (en only) |
| 22 | `DRAFT_ABOUT_SERIES_COLUMNS.unit` | Unit |  | proposed (en only) |
| 23 | `DRAFT_ABOUT_SERIES_COLUMNS.seasonal` | Seasonal adjustment |  | proposed (en only) |
| 24 | `DRAFT_ABOUT_SERIES_COLUMNS.priceBasis` | Price basis |  | proposed (en only) |
| 25 | `DRAFT_ABOUT_SERIES_COLUMNS.lastPeriod` | Last period |  | proposed (en only) |
| 26 | `DRAFT_ABOUT_SERIES_COLUMNS.knownAt` | Known at (last period) |  | proposed (en only) |
| 27 | `DRAFT_ABOUT_SERIES_COLUMNS.reestimating` | Re-estimation |  | proposed (en only) |
| 28 | `DRAFT_ABOUT_SERIES_HEADING` | About these series |  | proposed (en only) |
| 29 | `DRAFT_ABOUT_SUMMARY` | About this value |  | proposed (en only) |
| 30 | `DRAFT_ALL_DOMAINS_LINK` | All domains |  | proposed (en only) |
| 31 | `DRAFT_BAND_REVISIONS` | Revisions |  | proposed (en only) |
| 32 | `DRAFT_BAND_TABLE` | Table |  | proposed (en only) |
| 33 | `DRAFT_BAND_TITLES.overview` | Overview |  | proposed (en only) |
| 34 | `DRAFT_BAND_TITLES.compare` | Compare |  | proposed (en only) |
| 35 | `DRAFT_BAND_TITLES.indicators` | Indicators |  | proposed (en only) |
| 36 | `DRAFT_BAND_TITLES.overTime` | Over time |  | proposed (en only) |
| 37 | `DRAFT_BAR_LABEL` | Bar length (revision %) is relative to the largest revision shown. |  | proposed (en only) |
| 38 | `DRAFT_BLOCKED_FIELD_LABELS.unit_code` | unit code |  | proposed (en only) |
| 39 | `DRAFT_BLOCKED_FIELD_LABELS.unit_mult` | unit multiplier |  | proposed (en only) |
| 40 | `DRAFT_BLOCKED_FIELD_LABELS.price_basis` | price basis |  | proposed (en only) |
| 41 | `DRAFT_BLOCKED_FIELD_LABELS.flow_basis` | flow basis |  | proposed (en only) |
| 42 | `DRAFT_BLOCKED_FIELD_LABELS.base_period` | base period |  | proposed (en only) |
| 43 | `DRAFT_BLOCKED_FIELD_LABELS.frequency` | frequency |  | proposed (en only) |
| 44 | `DRAFT_BLOCKED_MESSAGE` | (function) (fields) => `Not drawn together; differing stored fields: ${fields.join(", ")}` |  | proposed (en only) |
| 45 | `DRAFT_BROWSE_SUMMARY` | Countries, indicators and other pages |  | proposed (en only) |
| 46 | `DRAFT_C1_FIGURE_LABEL` | (function) (name, unit, parts) => `Line chart of ${name}, one line per country, y-axis ${un |  | proposed (en only) |
| 47 | `DRAFT_C1_MARKS` | Dashed grey line: a stored aggregate; square marker: the last point of a stale series; hollow marker: an estimate or provisional value |  | proposed (en only) |
| 48 | `DRAFT_C2_FIGURE_LABEL` | (function) (name, period, unit) => `Bar chart of ${name}, reference period ${period}, in ${ |  | proposed (en only) |
| 49 | `DRAFT_C2_MARKS` | Hollow bar: another reference period, with its period in the label; dashed outline: an aggregate, for reference only |  | proposed (en only) |
| 50 | `DRAFT_C2_NO_RANK_REFERENCE` | No ranked reference period for this indicator. |  | proposed (en only) |
| 51 | `DRAFT_C2_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}` |  | proposed (en only) |
| 52 | `DRAFT_C3_FIGURE_LABEL` | (function) (xName, xUnit, yName, yUnit, period) => `Scatter plot, x-axis ${xName} in ${xUni |  | proposed (en only) |
| 53 | `DRAFT_C3_MARKS` | Labelled dots are the countries in focus; every country with both values is a dot and is listed in the table. |  | proposed (en only) |
| 54 | `DRAFT_C3_NO_COMMON` | No reference period has a stored value of both indicators. |  | proposed (en only) |
| 55 | `DRAFT_C3_TABLE_CAPTION` | (function) (xName, yName, period) => `${xName} and ${yName}: stored values by country, refe |  | proposed (en only) |
| 56 | `DRAFT_C4_BLANK` | no stored value |  | proposed (en only) |
| 57 | `DRAFT_C4_FIGURE_LABEL` | (function) (name, unit, first, last) => `Heatmap of ${name}, in ${unit}, countries by perio |  | proposed (en only) |
| 58 | `DRAFT_C4_LEGEND.min` | lowest |  | proposed (en only) |
| 59 | `DRAFT_C4_LEGEND.max` | highest |  | proposed (en only) |
| 60 | `DRAFT_C4_MARKS` | Hatched cell: no stored value |  | proposed (en only) |
| 61 | `DRAFT_C4_OUTLINE_MARK` | Dashed outline: a stale row, shown because Show stale rows is on |  | proposed (en only) |
| 62 | `DRAFT_C4_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest cell shown` |  | proposed (en only) |
| 63 | `DRAFT_C4_TABLE_CAPTION` | (function) (name, unit) => `${name}: stored value by country and period, in ${unit}` |  | proposed (en only) |
| 64 | `DRAFT_C6_AGGREGATES_NOTE` | Aggregates and countries outside the map are not drawn; they are listed under the hidden rows and in the table. |  | proposed (en only) |
| 65 | `DRAFT_C6_CARD_TITLE` | Map of values |  | proposed (en only) |
| 66 | `DRAFT_C6_FIGURE_LABEL` | (function) (name, period, unit) => `Map of Europe: ${name}, reference period ${period}, in  |  | proposed (en only) |
| 67 | `DRAFT_C6_GEO_PENDING` | Loading the map shapes. |  | proposed (en only) |
| 68 | `DRAFT_C6_GEO_UNREADABLE` | The map shapes could not be read, so the map is not drawn; the table lists the same values |  | proposed (en only) |
| 69 | `DRAFT_C6_LEGEND_UNIT` | (function) (unit) => `Unit: ${unit}` |  | proposed (en only) |
| 70 | `DRAFT_C6_MARKS` | Hatched: no stored value; plain: a stored value not drawn here; circle: a small country; dashed outline: another reference period |  | proposed (en only) |
| 71 | `DRAFT_C6_NOT_MAPPED.aggregate` | an aggregate, not drawn on the map |  | proposed (en only) |
| 72 | `DRAFT_C6_NOT_MAPPED.outside` | outside the map extent |  | proposed (en only) |
| 73 | `DRAFT_C6_NOT_MAPPED.nogeometry` | no map shape for this country |  | proposed (en only) |
| 74 | `DRAFT_C6_NOT_MAPPED_SENTENCE` | (function) (why, stored) => `${why}; ${stored}` |  | proposed (en only) |
| 75 | `DRAFT_C6_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest country shown; continuou |  | proposed (en only) |
| 76 | `DRAFT_C6_SKIP_TO_TABLE` | Skip to the table of map values |  | proposed (en only) |
| 77 | `DRAFT_C6_SOURCE_NOTE` | Map shapes: Natural Earth. |  | proposed (en only) |
| 78 | `DRAFT_C6_STORED` | (function) (value, period) => `${value} (${period})` |  | proposed (en only) |
| 79 | `DRAFT_C6_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}, |  | proposed (en only) |
| 80 | `DRAFT_CAPTION_LABELS.indicator` | Indicator |  | proposed (en only) |
| 81 | `DRAFT_CAPTION_LABELS.unit` | Unit |  | proposed (en only) |
| 82 | `DRAFT_CAPTION_LABELS.frequency` | Frequency |  | proposed (en only) |
| 83 | `DRAFT_CAPTION_LABELS.seasonal` | Seasonal adjustment |  | proposed (en only) |
| 84 | `DRAFT_CAPTION_LABELS.period` | Reference period |  | proposed (en only) |
| 85 | `DRAFT_CAPTION_LABELS.scale` | Colour scale |  | proposed (en only) |
| 86 | `DRAFT_CAPTION_LABELS.source` | Source |  | proposed (en only) |
| 87 | `DRAFT_CAPTION_LABELS.vintage` | Vintage |  | proposed (en only) |
| 88 | `DRAFT_CAPTION_LEGEND.EST` | estimate |  | proposed (en only) |
| 89 | `DRAFT_CAPTION_LEGEND.PROV` | provisional |  | proposed (en only) |
| 90 | `DRAFT_CAPTION_SEASONAL.SA` | SA |  | proposed (en only) |
| 91 | `DRAFT_CAPTION_SEASONAL.NSA` | NSA |  | proposed (en only) |
| 92 | `DRAFT_CAPTION_SEASONAL.NA` | not applicable |  | proposed (en only) |
| 93 | `DRAFT_CAPTION_VINTAGE` | (function) (date) => `latest vintage as of ${date}` |  | proposed (en only) |
| 94 | `DRAFT_CARD_REVISIONS` | Revisions and vintages |  | proposed (en only) |
| 95 | `DRAFT_CHART_MARKS` | A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each. |  | proposed (en only) |
| 96 | `DRAFT_CHART_MODES.lines` | Lines |  | proposed (en only) |
| 97 | `DRAFT_CHART_MODES.bars` | Bars |  | proposed (en only) |
| 98 | `DRAFT_CHART_SHOWS` | Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value. |  | proposed (en only) |
| 99 | `DRAFT_CHART_TYPE_LEGEND` | Chart type |  | proposed (en only) |
| 100 | `DRAFT_CHOOSE_COUNTRIES_HINT` | Choose up to 5 countries to compare. |  | proposed (en only) |
| 101 | `DRAFT_CHOOSE_COUNTRY_PLACEHOLDER` | Choose a country to see its key indicators. |  | proposed (en only) |
| 102 | `DRAFT_COMPARE_CARD_TITLES.c1` | Time series by country |  | proposed (en only) |
| 103 | `DRAFT_COMPARE_CARD_TITLES.c2` | Ranked values |  | proposed (en only) |
| 104 | `DRAFT_COMPARE_CARD_TITLES.c3` | Two indicators |  | proposed (en only) |
| 105 | `DRAFT_COMPARE_CARD_TITLES.c4` | Countries by period |  | proposed (en only) |
| 106 | `DRAFT_COMPARE_CARD_TITLES.c5` | Percentile heatmap |  | proposed (en only) |
| 107 | `DRAFT_COMPARE_CARD_TITLES.t2` | Indicator table |  | proposed (en only) |
| 108 | `DRAFT_COMPARE_CHOOSE_INDICATOR` | Choose an indicator to compare countries. |  | proposed (en only) |
| 109 | `DRAFT_COMPARE_CHOOSE_PAIR` | Choose two indicators to compare. |  | proposed (en only) |
| 110 | `DRAFT_COMPARE_CONTROLS_LABEL` | (function) (title) => `Controls: ${title}` |  | proposed (en only) |
| 111 | `DRAFT_COMPARE_CONTROL_LABELS.domain` | Domain |  | proposed (en only) |
| 112 | `DRAFT_COMPARE_CONTROL_LABELS.countries` | Countries |  | proposed (en only) |
| 113 | `DRAFT_COMPARE_CONTROL_LABELS.x` | X indicator |  | proposed (en only) |
| 114 | `DRAFT_COMPARE_CONTROL_LABELS.y` | Y indicator |  | proposed (en only) |
| 115 | `DRAFT_COMPARE_CONTROL_LABELS.p` | Reference period |  | proposed (en only) |
| 116 | `DRAFT_COMPARE_CONTROL_LABELS.choose` | Choose an indicator |  | proposed (en only) |
| 117 | `DRAFT_COMPARE_CONTROL_LABELS.latest` | Default period |  | proposed (en only) |
| 118 | `DRAFT_COMPARE_CONTROL_LABELS.sort` | Sort by |  | proposed (en only) |
| 119 | `DRAFT_COMPARE_DEFAULT_COUNTRIES` | No country is chosen: the default countries are shown. |  | proposed (en only) |
| 120 | `DRAFT_COMPARE_SECONDARY` | (function) (title) => `Percentile layer: ${title}` |  | proposed (en only) |
| 121 | `DRAFT_COMPARE_SERIES_PENDING` | Loading the series file of this indicator. |  | proposed (en only) |
| 122 | `DRAFT_COMPARE_SORTS.value` | Value |  | proposed (en only) |
| 123 | `DRAFT_COMPARE_SORTS.name` | Country (A to Z) |  | proposed (en only) |
| 124 | `DRAFT_COMPARE_SORTS.percentile` | Percentile |  | proposed (en only) |
| 125 | `DRAFT_COMPAT_SKIPPED` | (function) (fields) => `Not compared, no stored value: ${fields.join(", ")}` |  | proposed (en only) |
| 126 | `DRAFT_CONSEQUENCE.lists` | The lists on this page are still shown. |  | proposed (en only) |
| 127 | `DRAFT_CONSEQUENCE.scorecard` | The tables and charts on this page are not shown. |  | proposed (en only) |
| 128 | `DRAFT_CONSEQUENCE.explorer` | The chart and tables on this page are not shown. |  | proposed (en only) |
| 129 | `DRAFT_CONSEQUENCE.revisions` | The revision lists on this page are not shown. |  | proposed (en only) |
| 130 | `DRAFT_CONTEXT_LINES` | Context lines |  | proposed (en only) |
| 131 | `DRAFT_COUNTRY_CARD_TITLES.k1` | Latest values |  | proposed (en only) |
| 132 | `DRAFT_COUNTRY_CARD_TITLES.l1` | Time series |  | proposed (en only) |
| 133 | `DRAFT_COUNTRY_CARD_TITLES.p1` | Position among countries |  | proposed (en only) |
| 134 | `DRAFT_COUNTRY_CARD_TITLES.t1` | Indicator table |  | proposed (en only) |
| 135 | `DRAFT_COUNTRY_CARD_TITLES.l2` | Series |  | proposed (en only) |
| 136 | `DRAFT_COUNTRY_CHIP_HELP` | Select up to 5 countries. |  | proposed (en only) |
| 137 | `DRAFT_COUNTRY_COLUMNS.indicator` | Indicator |  | proposed (en only) |
| 138 | `DRAFT_COUNTRY_COLUMNS.value` | Latest value |  | proposed (en only) |
| 139 | `DRAFT_COUNTRY_COLUMNS.period` | Reference period |  | proposed (en only) |
| 140 | `DRAFT_COUNTRY_COLUMNS.percentile` | percentile vs all ranked countries |  | proposed (en only) |
| 141 | `DRAFT_COUNTRY_COLUMNS.source` | Source |  | proposed (en only) |
| 142 | `DRAFT_COUNTRY_COLUMNS.actions` | Actions |  | proposed (en only) |
| 143 | `DRAFT_COUNTRY_COLUMNS.reason` | Why there is no value |  | proposed (en only) |
| 144 | `DRAFT_COUNTRY_FILTER_ALL` | All indicators |  | proposed (en only) |
| 145 | `DRAFT_COUNTRY_FILTER_LEGEND` | Show |  | proposed (en only) |
| 146 | `DRAFT_COUNTRY_FILTER_VALUE` | Only indicators with a value |  | proposed (en only) |
| 147 | `DRAFT_COUNTRY_GROUPS_LABEL` | Groups |  | proposed (en only) |
| 148 | `DRAFT_COUNTRY_KIND_LABEL` | Kind |  | proposed (en only) |
| 149 | `DRAFT_COUNTRY_LIMIT` | (function) (n) => `You can select up to ${n} countries. Clear one to select another.` |  | proposed (en only) |
| 150 | `DRAFT_COUNTRY_NO_GROUPS` | none |  | proposed (en only) |
| 151 | `DRAFT_COUNTRY_SELECTED` | (function) (n) => `${n} selected` |  | proposed (en only) |
| 152 | `DRAFT_COUNTRY_SWITCHER_GO` | Go |  | proposed (en only) |
| 153 | `DRAFT_COUNTRY_SWITCHER_LABEL` | Switch country |  | proposed (en only) |
| 154 | `DRAFT_COUNTRY_TABLE_CAPTION` | (function) (domainName, countryName) => `${domainName}: indicators of ${countryName}` |  | proposed (en only) |
| 155 | `DRAFT_CRUMB_COUNTRIES` | Countries |  | proposed (en only) |
| 156 | `DRAFT_CRUMB_HOME` | Home |  | proposed (en only) |
| 157 | `DRAFT_CRUMB_INDICATORS` | Indicators |  | proposed (en only) |
| 158 | `DRAFT_CRUMB_LABEL` | Breadcrumb |  | proposed (en only) |
| 159 | `DRAFT_DOMAINS_BAND` | All domains |  | proposed (en only) |
| 160 | `DRAFT_DOWNLOAD` | Download the data file of this indicator |  | proposed (en only) |
| 161 | `DRAFT_EMPTY_CARD` | No values for this selection. |  | proposed (en only) |
| 162 | `DRAFT_ERROR_INVALID` | (function) (region) => `The data of ${region} did not pass the format check, so it is not u |  | proposed (en only) |
| 163 | `DRAFT_ERROR_TITLE` | (function) (region) => `Could not load ${region}.` |  | proposed (en only) |
| 164 | `DRAFT_ERROR_VERSION` | (function) (region) => `This page cannot read ${region}: its data version is not supported  |  | proposed (en only) |
| 165 | `DRAFT_EXPLORER_FIGURE_LABEL` | (function) (title, yLabel, parts) => `Line chart of ${title}, y-axis ${yLabel}. ${parts.joi |  | proposed (en only) |
| 166 | `DRAFT_FACET_COLLAPSE` | Collapse |  | proposed (en only) |
| 167 | `DRAFT_FACET_EXPAND` | Expand |  | proposed (en only) |
| 168 | `DRAFT_FACET_STATEMENT` | More than 5 countries are selected, so each country has its own chart. |  | proposed (en only) |
| 169 | `DRAFT_FACT_LABELS.value` | Latest value |  | proposed (en only) |
| 170 | `DRAFT_FACT_LABELS.refPeriod` | Reference period |  | proposed (en only) |
| 171 | `DRAFT_FACT_LABELS.refOffset` | Reference offset (days) |  | proposed (en only) |
| 172 | `DRAFT_FACT_LABELS.release` | Source release |  | proposed (en only) |
| 173 | `DRAFT_FACT_LABELS.age` | Age (days) |  | proposed (en only) |
| 174 | `DRAFT_FACT_LABELS.limit` | Staleness limit (days) |  | proposed (en only) |
| 175 | `DRAFT_FACT_LABELS.flags` | Flags |  | proposed (en only) |
| 176 | `DRAFT_FIGURE_COVERAGE` | (function) (nAvailable, nDefined) => `${nAvailable} of ${nDefined} indicators available` |  | proposed (en only) |
| 177 | `DRAFT_FIGURE_POSITION` | (function) (position, nRanked) => `position ${position} of ${nRanked}` |  | proposed (en only) |
| 178 | `DRAFT_FILTER_ALL.countries` | All countries |  | proposed (en only) |
| 179 | `DRAFT_FILTER_ALL.domains` | All domains |  | proposed (en only) |
| 180 | `DRAFT_FILTER_ALL.frequencies` | All frequencies |  | proposed (en only) |
| 181 | `DRAFT_FILTER_CHIP_SUMMARY` | (function) (label, value) => `${label}: ${value}` |  | proposed (en only) |
| 182 | `DRAFT_FILTER_LABELS.filters` | Filters |  | proposed (en only) |
| 183 | `DRAFT_FILTER_LABELS.group` | Group |  | proposed (en only) |
| 184 | `DRAFT_FILTER_LABELS.country` | Country |  | proposed (en only) |
| 185 | `DRAFT_FILTER_LABELS.domain` | Domain |  | proposed (en only) |
| 186 | `DRAFT_FILTER_LABELS.indicator` | Indicator |  | proposed (en only) |
| 187 | `DRAFT_FILTER_LABELS.period` | Period |  | proposed (en only) |
| 188 | `DRAFT_FILTER_LABELS.frequency` | Frequency |  | proposed (en only) |
| 189 | `DRAFT_FILTER_LABELS.from` | From |  | proposed (en only) |
| 190 | `DRAFT_FILTER_LABELS.to` | To |  | proposed (en only) |
| 191 | `DRAFT_FILTER_LABELS.all` | All |  | proposed (en only) |
| 192 | `DRAFT_FILTER_LABELS.reset` | Reset filters |  | proposed (en only) |
| 193 | `DRAFT_FREE_Y_LABEL` | Free y-axis (used when more than 5 countries are selected) |  | proposed (en only) |
| 194 | `DRAFT_FREQUENCY_NAMES.D` | Daily |  | proposed (en only) |
| 195 | `DRAFT_FREQUENCY_NAMES.M` | Monthly |  | proposed (en only) |
| 196 | `DRAFT_FREQUENCY_NAMES.Q` | Quarterly |  | proposed (en only) |
| 197 | `DRAFT_FREQUENCY_NAMES.A` | Annual |  | proposed (en only) |
| 198 | `DRAFT_GROUP_BROWSE` | Browse |  | proposed (en only) |
| 199 | `DRAFT_GROUP_REFERENCE_ROWS` | Reference rows |  | proposed (en only) |
| 200 | `DRAFT_HEATMAP_CAPTION` | (function) (domainName, label) => `${domainName}: ${label}, and the percentile of each indi |  | proposed (en only) |
| 201 | `DRAFT_HEATMAP_CAPTION_INFO` | (function) (domainName) => `${domainName}: latest value of each indicator, by country (${IN |  | proposed (en only) |
| 202 | `DRAFT_HIDDEN_LIST_ITEM` | (function) (label, reasonLabel, period, sentence) => `${label}: ${reasonLabel}; latest valu |  | proposed (en only) |
| 203 | `DRAFT_HIDDEN_REASON_LABELS.no_data` | No data |  | proposed (en only) |
| 204 | `DRAFT_HIDDEN_REASON_LABELS.stale` | Stale |  | proposed (en only) |
| 205 | `DRAFT_HIDDEN_REASON_LABELS.other_period` | Other period |  | proposed (en only) |
| 206 | `DRAFT_HIDDEN_REASON_LABELS.other` | Other |  | proposed (en only) |
| 207 | `DRAFT_HIDDEN_ROWS` | (function) (n) => (n > 1 ? `${n} rows hidden by the period filter` : n === 1 ? "1 row hidde |  | proposed (en only) |
| 208 | `DRAFT_HIDDEN_ROW_ITEM` | (function) (name, period) => `${name}: latest value ${period}` |  | proposed (en only) |
| 209 | `DRAFT_HIDDEN_SUMMARY` | (function) (counts) => {   const parts = Object.keys(HIDDEN_PARTS).filter((k) => counts?.[k |  | proposed (en only) |
| 210 | `DRAFT_HISTORY_CONSEQUENCE` | No history chart is shown for this indicator. |  | proposed (en only) |
| 211 | `DRAFT_HISTORY_FIGURE_LABEL` | (function) (indicatorName, countryName, unit) => `history of ${indicatorName} for ${country |  | proposed (en only) |
| 212 | `DRAFT_HISTORY_HIDE` | Hide history |  | proposed (en only) |
| 213 | `DRAFT_HISTORY_REGION` | the history of this indicator |  | proposed (en only) |
| 214 | `DRAFT_HISTORY_SHOW` | Show history |  | proposed (en only) |
| 215 | `DRAFT_HISTORY_TABLE_TITLE` | (function) (indicatorName, countryName) => `${indicatorName}: ${countryName}` |  | proposed (en only) |
| 216 | `DRAFT_HOME_DOMAINS_TITLE` | Domains |  | proposed (en only) |
| 217 | `DRAFT_HOME_FILTER_COUNT` | (function) (n) => `${n} shown` |  | proposed (en only) |
| 218 | `DRAFT_HOME_FILTER_NONE` | No match. |  | proposed (en only) |
| 219 | `DRAFT_HOME_H1` | Macro dashboard |  | proposed (en only) |
| 220 | `DRAFT_INCLUDE_OTHER_PERIODS` | Include rows from other reference periods |  | proposed (en only) |
| 221 | `DRAFT_INDICATOR_COLUMNS.country` | Country |  | proposed (en only) |
| 222 | `DRAFT_INDICATOR_COLUMNS.value` | Latest value |  | proposed (en only) |
| 223 | `DRAFT_INDICATOR_COLUMNS.period` | Reference period |  | proposed (en only) |
| 224 | `DRAFT_INDICATOR_COLUMNS.offset` | Offset (days) |  | proposed (en only) |
| 225 | `DRAFT_INDICATOR_COLUMNS.percentile` | percentile vs all ranked countries |  | proposed (en only) |
| 226 | `DRAFT_INDICATOR_COLUMNS_MORE.flags` | Flags |  | proposed (en only) |
| 227 | `DRAFT_INDICATOR_COLUMNS_MORE.source` | Source |  | proposed (en only) |
| 228 | `DRAFT_INDICATOR_COLUMNS_MORE.actions` | Actions |  | proposed (en only) |
| 229 | `DRAFT_INDICATOR_COLUMNS_MORE.reason` | Why there is no value |  | proposed (en only) |
| 230 | `DRAFT_INDICATOR_FACT_LABELS.id` | Identifier |  | proposed (en only) |
| 231 | `DRAFT_INDICATOR_FACT_LABELS.domains` | Domains |  | proposed (en only) |
| 232 | `DRAFT_INDICATOR_FACT_LABELS.unit` | Unit |  | proposed (en only) |
| 233 | `DRAFT_INDICATOR_FACT_LABELS.frequency` | Frequency |  | proposed (en only) |
| 234 | `DRAFT_INDICATOR_FACT_LABELS.direction` | Direction |  | proposed (en only) |
| 235 | `DRAFT_INDICATOR_FACT_LABELS.notes` | Notes |  | proposed (en only) |
| 236 | `DRAFT_INDICATOR_FACT_LABELS.transform` | Transform |  | proposed (en only) |
| 237 | `DRAFT_INDICATOR_SORT_LABEL` | Sort by |  | proposed (en only) |
| 238 | `DRAFT_INDICATOR_SORT_LABELS.name` | Country |  | proposed (en only) |
| 239 | `DRAFT_INDICATOR_SORT_LABELS.value` | Value |  | proposed (en only) |
| 240 | `DRAFT_INDICATOR_SORT_LABELS.percentile` | Percentile |  | proposed (en only) |
| 241 | `DRAFT_INDICATOR_SORT_LABELS.period` | Reference period |  | proposed (en only) |
| 242 | `DRAFT_INDICATOR_SWITCHER_GO` | Go |  | proposed (en only) |
| 243 | `DRAFT_INDICATOR_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest values by country` |  | proposed (en only) |
| 244 | `DRAFT_KPI_ERROR_CONSEQUENCE` | The key indicators are not shown. |  | proposed (en only) |
| 245 | `DRAFT_L1_SUMMARY` | (function) (domainName) => `${domainName}: time series` |  | proposed (en only) |
| 246 | `DRAFT_LEGEND_BINS` | Percentile bins |  | proposed (en only) |
| 247 | `DRAFT_LEGEND_STATES` | Cell marks |  | proposed (en only) |
| 248 | `DRAFT_LEGEND_TITLE` | Legend |  | proposed (en only) |
| 249 | `DRAFT_LOADING` | (function) (what) => `Loading ${what}...` |  | proposed (en only) |
| 250 | `DRAFT_LOAD_HISTORY` | Load history |  | proposed (en only) |
| 251 | `DRAFT_MARKED_SEASONAL` | Mixes SA and NSA series |  | proposed (en only) |
| 252 | `DRAFT_MODE_LABELS.country` | Country |  | proposed (en only) |
| 253 | `DRAFT_MODE_LABELS.compare` | Compare |  | proposed (en only) |
| 254 | `DRAFT_MODE_SWITCH_LABEL` | Mode |  | proposed (en only) |
| 255 | `DRAFT_NA_DEFINED_SENTENCE` | A series is defined for this country, but this export holds no value for it. |  | proposed (en only) |
| 256 | `DRAFT_NA_NO_PERCENTILE_SENTENCE` | This export holds a value but no percentile for it. |  | proposed (en only) |
| 257 | `DRAFT_NA_NO_RANKED_SENTENCE` | No indicator of this domain has a ranked value for this country. |  | proposed (en only) |
| 258 | `DRAFT_NEXT_GROUP` | Choose another group or another indicator. |  | proposed (en only) |
| 259 | `DRAFT_NEXT_SERIES` | Choose at least one country, or another indicator or range. |  | proposed (en only) |
| 260 | `DRAFT_NOSCRIPT` | This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page. |  | proposed (en only) |
| 261 | `DRAFT_NOT_PUBLISHED_SENTENCE` | Not published on this site. |  | proposed (en only) |
| 262 | `DRAFT_NOT_STATED` | not stated |  | proposed (en only) |
| 263 | `DRAFT_NO_ALIGNED` | No aligned values for this selection |  | proposed (en only) |
| 264 | `DRAFT_NO_VALUE_FOR` | (function) (names) => `no value for ${names.join(", ")}` |  | proposed (en only) |
| 265 | `DRAFT_OFFSET_FLAG` | (function) (days) => `offset ${days} days` |  | proposed (en only) |
| 266 | `DRAFT_OPEN_AS_SERIES` | Open as time series |  | proposed (en only) |
| 267 | `DRAFT_P1A_AGGREGATES_NOTE` | Dashed lines mark the stored value of an aggregate, for reference only. |  | proposed (en only) |
| 268 | `DRAFT_P1A_FIGURE_LABEL` | (function) (indicatorName, period, unit) => `Strip plot of ${indicatorName}, reference peri |  | proposed (en only) |
| 269 | `DRAFT_P1A_MARKS` | Ring: the country in focus; hollow dot: an estimate or a value of another reference period |  | proposed (en only) |
| 270 | `DRAFT_P1A_NO_REFERENCE` | The scorecard states no reference period for this indicator. |  | proposed (en only) |
| 271 | `DRAFT_P1A_REFERENCE` | (function) (period) => `Reference period: ${period}` |  | proposed (en only) |
| 272 | `DRAFT_P1A_TABLE_CAPTION` | (function) (indicatorName, period) => `${indicatorName}: latest stored value by country, re |  | proposed (en only) |
| 273 | `DRAFT_PEER_DIRECTION` | (function) (directionText) => `Direction of this indicator: ${directionText}.` |  | proposed (en only) |
| 274 | `DRAFT_PEER_FIGURE_LABEL` | (function) (indicatorName, n, column) => `Dot plot of the ${column} for ${indicatorName}, $ |  | proposed (en only) |
| 275 | `DRAFT_PEER_FOCUS_HINT` | Select a country name to highlight it in the chart and the table; select it again to clear. |  | proposed (en only) |
| 276 | `DRAFT_PEER_GUIDES` | The grey lines mark 0.25, 0.5 and 0.75 on the scale. |  | proposed (en only) |
| 277 | `DRAFT_PEER_MARKS` | Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus. |  | proposed (en only) |
| 278 | `DRAFT_PEER_NOT_DRAWN` | A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only. |  | proposed (en only) |
| 279 | `DRAFT_PEER_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest value and stored percentile, by cou |  | proposed (en only) |
| 280 | `DRAFT_PERIOD_INVALID` | The From year must not be after the To year. The period was not changed. |  | proposed (en only) |
| 281 | `DRAFT_PERIOD_PRESETS.all` | All |  | proposed (en only) |
| 282 | `DRAFT_PERIOD_PRESETS.last10` | Last 10 years |  | proposed (en only) |
| 283 | `DRAFT_PERIOD_PRESETS.last5` | Last 5 years |  | proposed (en only) |
| 284 | `DRAFT_PERIOD_REGION` | the period range |  | proposed (en only) |
| 285 | `DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE` | The period filter is not available; all years are shown. |  | proposed (en only) |
| 286 | `DRAFT_PERIOD_VALUE` | (function) (from, to) => `${from} to ${to}` |  | proposed (en only) |
| 287 | `DRAFT_PICKER_LABELS.country` | Country |  | proposed (en only) |
| 288 | `DRAFT_PICKER_LABELS.group` | Group |  | proposed (en only) |
| 289 | `DRAFT_PICKER_LABELS.countries` | Countries |  | proposed (en only) |
| 290 | `DRAFT_PICKER_LABELS.aggregates` | Aggregates |  | proposed (en only) |
| 291 | `DRAFT_PICKER_LABELS.placeholder` | Choose a country |  | proposed (en only) |
| 292 | `DRAFT_PRINT_FILTERS` | (function) (parts) => `Filters: ${parts.length ? parts.join("; ") : "none"}` |  | proposed (en only) |
| 293 | `DRAFT_PROFILE_DOT_LABEL` | (function) (name, percentileText) => `${name}: ${percentileText}` |  | proposed (en only) |
| 294 | `DRAFT_PROFILE_FIGURE_LABEL` | (function) (countryName, domainName) => `percentile of each indicator for ${countryName}, d |  | proposed (en only) |
| 295 | `DRAFT_RANK_COLUMNS.bar` | Bar |  | proposed (en only) |
| 296 | `DRAFT_RANK_COLUMNS.dot` | Percentile position |  | proposed (en only) |
| 297 | `DRAFT_RANK_SORT_LABELS.name` | Country (A to Z) |  | proposed (en only) |
| 298 | `DRAFT_RANK_SORT_LABELS.value` | Value |  | proposed (en only) |
| 299 | `DRAFT_RANK_SORT_LABELS.percentile` | Percentile |  | proposed (en only) |
| 300 | `DRAFT_REBASE_MARKS` | The grey lines mark the index value 100 and the base period. |  | proposed (en only) |
| 301 | `DRAFT_REBASE_STATEMENT` | (function) (period) => `Index, ${period} = 100, rebased for display; stored values unchange |  | proposed (en only) |
| 302 | `DRAFT_REESTIMATED_MARK` | re-estimated |  | proposed (en only) |
| 303 | `DRAFT_REGIONS.manifest` | the data manifest |  | proposed (en only) |
| 304 | `DRAFT_REGIONS.meta` | the descriptions of countries, indicators and series |  | proposed (en only) |
| 305 | `DRAFT_REGIONS.scorecard` | the scorecard of this domain |  | proposed (en only) |
| 306 | `DRAFT_REGIONS.domains` | the list of domains |  | proposed (en only) |
| 307 | `DRAFT_REGIONS.alerts` | the current alerts |  | proposed (en only) |
| 308 | `DRAFT_REGIONS.recent` | the list of recent revisions |  | proposed (en only) |
| 309 | `DRAFT_REGIONS.series` | the series file of this indicator |  | proposed (en only) |
| 310 | `DRAFT_REGIONS.revisionFile` | the revision file of this indicator |  | proposed (en only) |
| 311 | `DRAFT_REGIONS.loadingData` | the dashboard data |  | proposed (en only) |
| 312 | `DRAFT_REGIONS.loadingSeries` | the series of this indicator |  | proposed (en only) |
| 313 | `DRAFT_REGIONS.loadingRevisions` | the revision history of this indicator |  | proposed (en only) |
| 314 | `DRAFT_REVISIONS_LINK_LABEL` | (function) (indicatorName) => `Revisions of ${indicatorName}` |  | proposed (en only) |
| 315 | `DRAFT_SCROLL_HINT` | Scroll sideways to see more indicators. |  | proposed (en only) |
| 316 | `DRAFT_SELECT_GROUP` | Select group |  | proposed (en only) |
| 317 | `DRAFT_SERIES_LABEL_PART` | (function) (name, from, to, latestText) => `${name}, ${from} to ${to}, latest stored value  |  | proposed (en only) |
| 318 | `DRAFT_SERIES_UNREADABLE` | The series file of this indicator could not be read. |  | proposed (en only) |
| 319 | `DRAFT_SHOW_MORE` | Show more |  | proposed (en only) |
| 320 | `DRAFT_SHOW_PERCENTILE` | Show percentile |  | proposed (en only) |
| 321 | `DRAFT_SHOW_STALE` | Show stale rows |  | proposed (en only) |
| 322 | `DRAFT_SPARKLINE_TOO_FEW` | Too few values in the selected period. |  | proposed (en only) |
| 323 | `DRAFT_STALE_CODE` | stale |  | proposed (en only) |
| 324 | `DRAFT_STALE_PERIOD` | (function) (period) => `stale, ${period}` |  | proposed (en only) |
| 325 | `DRAFT_STALE_TIP` | (function) (period) => `stale, latest stored period ${period}` |  | proposed (en only) |
| 326 | `DRAFT_STATE_COLUMN` | State |  | proposed (en only) |
| 327 | `DRAFT_STEP_CHOOSE_PERIOD` | Choose one reference period to see its step chart. |  | proposed (en only) |
| 328 | `DRAFT_STEP_FIGURE_LABEL` | (function) (title, country, period, yLabel, parts) => `Step chart of ${title} for ${country |  | proposed (en only) |
| 329 | `DRAFT_STEP_FIGURE_PART` | (function) (known, valueText) => `${known}: ${valueText}` |  | proposed (en only) |
| 330 | `DRAFT_STEP_NOTE` | Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal. |  | proposed (en only) |
| 331 | `DRAFT_STEP_REMOVED` | removed |  | proposed (en only) |
| 332 | `DRAFT_STEP_SKIP` | Skip to version table |  | proposed (en only) |
| 333 | `DRAFT_SUBREGION_CONSEQUENCE` | The rest of this page is still shown. Choose another indicator to try again. |  | proposed (en only) |
| 334 | `DRAFT_TABLE_CAPTION` | (function) (title, n) => `${title}: plotted values, latest ${n} periods of each series` |  | proposed (en only) |
| 335 | `DRAFT_TABLE_CAPTION_ALL` | (function) (title) => `${title}: plotted values, every plotted period of each series` |  | proposed (en only) |
| 336 | `DRAFT_TABLE_HEADERS.value` | Value |  | proposed (en only) |
| 337 | `DRAFT_TABLE_HEADERS.status` | Status |  | proposed (en only) |
| 338 | `DRAFT_TITLE_UNIT` | (function) (unit) => ` (${unit})` |  | proposed (en only) |
| 339 | `DRAFT_TRANSFORMED_HEADER` | (function) (transformLabel) => `Transformed value (${transformLabel})` |  | proposed (en only) |
| 340 | `DRAFT_UNIT_MISSING_SENTENCE` | This export holds no unit for this value. |  | proposed (en only) |
| 341 | `DRAFT_VALUE_AXIS_TITLE` | (function) (indicatorName, unit) => `${indicatorName} (${unit \|\| DRAFT_UNIT_MISSING_SENTENC |  | proposed (en only) |
| 342 | `DRAFT_VALUE_ESTIMATE_MARK` | e |  | proposed (en only) |
| 343 | `DRAFT_VALUE_FIGURE_LABEL` | (function) (indicatorName, unit, n) => `Bar chart of ${indicatorName}, ${unit ? `in ${unit} |  | proposed (en only) |
| 344 | `DRAFT_VALUE_HEADER_UNIT` | (function) (unit) => `Value (${unit})` |  | proposed (en only) |
| 345 | `DRAFT_VALUE_NEUTRAL_LEGEND` | No percentile |  | proposed (en only) |
| 346 | `DRAFT_WITHOUT_VALUE_GROUP` | Indicators without a value in this export |  | proposed (en only) |
| 347 | `DRAFT_Y_MODE` | (function) (free) => (free   ? "Each chart has its own y-axis scale: the shape of a series  |  | proposed (en only) |
