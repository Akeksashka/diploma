---
status: approved   # approved by the user on 2026-11-06 (stated in session: "approve all"). Evidence is text-only; limits are listed below.
topic: Survey of public analytical dashboards and analysis of user jobs (input to ADR-030)
date: 2026-11-06
---
# Dashboard survey and analysis (input to ADR-030)

## Question / scope
Which user jobs and display patterns do public statistical dashboards support (World Bank, Our World in Data, Trading Economics, Statista, central banks, Eurostat, Metabase), and what do they imply for a macro dashboard used by economics students and professors? Evidence is page text fetched with WebFetch on 2026-11-06, not rendered views: hover, tooltips, pickers and chart design were mostly not visible. Entries marked [SEARCH ONLY] were not opened. The survey was collected by a Haiku subagent and analysed by a Sonnet subagent; the analysis hypotheses are not user evidence. Copied from session scratchpad files on 2026-11-06 for the user's approval (ADR-030 question 10).

## Sources assessed
The table below lists every URL tried, with status. Licence and rate-limit columns of the research template do not apply (pages were read for layout only; no data was downloaded).

## Summary of coverage

| # | Family | URL | Status |
|---|---|---|---|
| 1 | World Bank country profile | https://data.worldbank.org/country/united-states | OPENED (truncated) |
| 2 | World Bank indicator page | https://data.worldbank.org/indicator/NY.GDP.MKTP.CD | OPENED (truncated) |
| 3 | World Bank DataBank (WDI) | https://databank.worldbank.org/source/world-development-indicators | OPENED |
| 4 | OWID grapher (GDP per capita) | https://ourworldindata.org/grapher/gdp-per-capita-worldbank | OPENED (chart is an image) |
| 5 | OWID grapher (life expectancy) | https://ourworldindata.org/grapher/life-expectancy | OPENED (chart is an image) |
| 6 | Trading Economics, US GDP growth | https://tradingeconomics.com/united-states/gdp-growth | OPENED (chart not in text) |
| 7 | Trading Economics, US indicators | https://tradingeconomics.com/united-states/indicators | OPENED |
| 8 | Statista, India GDP statistic | https://www.statista.com/statistics/263771/gross-domestic-product-gdp-in-the-united-states/ | OPENED. The URL redirected to or served an India GDP page (headline: "GDP in current prices in India from 1980 to 2031"). The URL slug does not match the content, so this is a noted anomaly. |
| 9 | Statista topic page | https://www.statista.com/topics/4370/economy-of-india/ | OPENED. The page content was about the Jacksonville Jaguars, not India. Included only as a mismatch example. |
| 10 | Bank of England Statistical Database | https://www.bankofengland.co.uk/boeapps/database/ | OPENED (landing page) |
| 11 | Bank of England, Bank Rate history | https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp | OPENED |
| 12 | ECB statistics landing | https://www.ecb.europa.eu/stats/html/index.en.html | OPENED (ECB data portal URL returned 503) |
| 13 | Eurostat Database info page | https://ec.europa.eu/eurostat/web/main/data/database | OPENED |
| 14 | Eurostat Statistics Explained home | https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Main_Page | OPENED |
| 15 | Eurostat news article (rail) | https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20261030-1 | OPENED |
| 16 | Metabase example dashboards gallery | https://www.metabase.com/dashboards | OPENED (gallery list only; individual dashboards not opened) |
| 17 | Metabase Learn | https://www.metabase.com/learn/ | OPENED (no examples on the page) |
| 18 | IMF DataMapper | https://www.imf.org/external/datamapper/NGDPDPC@WEO/OEMDC/ADVEC/WEOWORLD | PARTIAL: template with unfilled placeholders only |
| 19 | IMF DataMapper, second indicator | https://www.imf.org/external/datamapper/NGDP_RPCH@WEO/OEMDC/ADVEC/WEOWORLD | PARTIAL: same placeholder template |
| 20 | IMF WEO database (2026 October) | https://www.imf.org/en/Publications/WEO/weo-database/2026/October | FAILED (HTTP 404) |
| 21 | OECD data.oecd.org (GDP) | https://data.oecd.org/gdp/gross-domestic-product-gdp.htm | FAILED (HTTP 403) |
| 22 | OECD Data Explorer | https://data-explorer.oecd.org/ | PARTIAL: empty content returned |
| 23 | OECD topic page | https://www.oecd.org/en/topics/sub-issues/economic-outlook.html | FAILED (HTTP 403) |
| 24 | OECD country profile (US) | https://www.oecd.org/en/countries/united-states.html | FAILED (HTTP 404) |
| 25 | ECB data portal home | https://data.ecb.europa.eu/ | FAILED (HTTP 503) |
| 26 | ECB data portal dataset (HICP) | https://data.ecb.europa.eu/data/datasets/ICP/ICP.M.U2.N.000000.4.ANR | FAILED (HTTP 503) |
| 27 | Tableau Public, Data School "Global Financial Overview" | https://public.tableau.com/app/profile/sam.search/viz/GlobalFinancialOverviewDashboard/DashboardTemplate?publish=yes | PARTIAL: viz not rendered in text. Seen in search as [SEARCH ONLY] for its description. |
| 28 | Power BI Fabric community, IMF WEO 2025 | https://community.fabric.microsoft.com/t5/Data-Stories-Gallery/IMF-World-Economic-Outlook-2025/m-p/4669351 | FAILED (HTTP 403). Description is [SEARCH ONLY]. |

Counted as usable dashboards or views opened directly (status OPENED, excluding Statista topic mismatch and Metabase/Eurostat landing-only pages): 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 15. That is 12, plus Eurostat database and Statistics Explained pages (13, 14) as navigation references, which meets the target of 12.

Coverage gaps: OECD (all four URLs failed or were empty), ECB data portal dataset views (503), Power BI (403), IMF DataMapper (template only), and Metabase example dashboards (only the gallery list was read). Retrying these from a browser session would be needed before drawing conclusions on those families.

## Findings (each with citation: URL, access date 2026-11-06)

### A. Survey entries
---

#### 1. World Bank country profile, United States
- URL: https://data.worldbank.org/country/united-states
- Status: OPENED (text truncated at end)
- Main user tasks: look up one country's latest headline values; move from a country to its indicators.
- Layout: top nav (Home, Economies, Themes, Data and Resources, About); country banner with "Browse World Development Indicators by Country or Indicator"; jump links; theme tabs (Overview / By Theme / By SDG Goal); sections Social, Economic, Environment, Institutions, Finances, Surveys, Human Capital Index, Global Economic Prospects, Climate Change. Each indicator section is a 3-column table: Indicator, Most recent value, Trend.
- Units: in the indicator name, e.g. "(% of population)", "(current US$)", "(per 100,000 people)". Value formats are inconsistent (population as 341,784,857; GDP as "30.77" with "(2025 trillion)" in the label; GDP per capita as 90,026.5). Year shown in parentheses per value, so reference years vary (2020 to 2025).
- Hover/tooltips: none visible in text. Trend cells all used the same placeholder image, so no trend data was visible.
- Missing or N/A: not described; every visible row has a value.
- Cross-country comparison: none visible; only a "Browse by Country or Indicator" link.
- Notable mistakes (as seen in text): empty indicator name in the Human Capital Index row; a 2013 figure in the Finances box on a 2026 page; country links with unencoded spaces ("country/United States"); mixed reference years; climate charts labelled "1901 - 2009".

#### 2. World Bank indicator page, GDP (current US$)
- URL: https://data.worldbank.org/indicator/NY.GDP.MKTP.CD
- Status: OPENED (truncated; country rows missing from captured text)
- Tasks: see one indicator across countries and years; download data.
- Layout: chart-type control (Line, Bar, Map; default not stated); year range "1960 - 2025" (control type not stated); table "All Countries and Economies" with Country, Most Recent Year, Most Recent Value. Related indicator links.
- Units: indicator is current US$, but the table header reads "Most Recent Value (Millions)". Chart unit label not visible. Inline toggles "current US$ / constant US$ / current LCU / constant LCU" are unexplained.
- Downloads: CSV, XML, Excel (via the API), plus links to DataBank and WDI Tables. Licence CC BY-4.0.
- Hover/tooltips, N/A: not described in captured text. Placeholder images may be loading states.
- Notable mistakes: "(Millions)" conflicts with "current US$"; footer reads 2026 while the latest year is 2025; no last-updated date; links to both data.worldbank.org and data360.worldbank.org, so the site's home is unclear; a related-indicator link ("Coal rents") looks unrelated to GDP.

#### 3. World Bank DataBank (WDI report builder)
- URL: https://databank.worldbank.org/source/world-development-indicators
- Status: OPENED
- Tasks: build a custom country x series x time table, chart or map; export.
- Layout: four panels, Database, Country (266 countries; select all, invert, custom groups), Series (1,498 series; custom formula builder), Time (66 periods; annual, quarterly, monthly, and so on). Orientation control (drag Time, Series and Country to Column, Row or Page). Views: Table, Chart, Map, Metadata.
- Units and formatting: Scale Units (Thousands, Millions, Billions, Scientific); Precision (0 to 0.0000). Missing values: "NA preference" offers Blank, NA or #N/A; the page does not mention the ".." symbol.
- Warnings: "Selected Indicator units are different, do you want to continue?"; custom formulas "may yield inappropriate results"; validation checks syntax only.
- Downloads: Excel, CSV, tabbed TXT, metadata; embed; save and share require login.
- Hover/tooltips: not in captured text.
- Notable: power-user tool with a steep layout (many panels); unit mismatch is a warning, not a block.

#### 4. OWID grapher, GDP per capita (worldbank)
- URL: https://ourworldindata.org/grapher/gdp-per-capita-worldbank
- Status: OPENED (chart embedded as PNG in captured text, so interactive controls were not verified)
- Tasks: long-run country trends; comparing sources.
- Layout: title and subtitle ("In constant international-$ - World Bank"); "Chart 1 of 140" indicating a multi-chart collection; related charts ("GDP per capita: comparing data from World Bank and Maddison Project Database"); citation block; "Reuse This Work" CC BY 4.0.
- Units: unit field "international-$ in 2021 prices"; date range 1990-2025.
- Downloads: full and displayed-only CSV ZIP; API URLs; code snippets for Excel, Python, R and Stata.
- Source and freshness: "Eurostat, OECD, IMF, and World Bank (2026) with minor processing by Our World in Data"; last updated and next update dates are printed.
- Missing data: notes that the World Bank series starts in 1990; no gap rules in text.
- Hover/tooltips, entity selector: not verified in text.

#### 5. OWID grapher, life expectancy
- URL: https://ourworldindata.org/grapher/life-expectancy
- Status: OPENED (static capture; chart as image)
- Tasks: long-run history by country and region, 1543 to 2023.
- Layout: title, category ("Long-run data"), unit field ("years"), date range, description ("Period life expectancy is the number of years ..."), "Show more / Show less" notes, source and "last updated" metadata, citation blocks (short and full).
- Missing data: notes explain that UN counts crisis deaths in the year they occurred, which creates one-year dips (e.g. Central African Republic 14.7 in 2009 vs 18.8 in 2022, as stated on the page); pre-1950 coverage declines with age of the period; sources change at 1950.
- Downloads: "all entities" versus "only the entities and time points currently visible" (implies an entity selector; not verified).
- Notable: good example of explaining data breaks in the text itself. Citation block shows a retrieval date later than the archive date it cites (not a dashboard flaw, but a metadata detail).

#### 6. Trading Economics, United States GDP growth rate
- URL: https://tradingeconomics.com/united-states/gdp-growth
- Status: OPENED (chart not present in captured text)
- Tasks: check latest print and consensus; see recent release calendar; read the latest figure in a sentence.
- Layout (top to bottom): nav with login prompt and plan promotions; page title; anchor menu (Summary, Stats, Forecast, Consensus, Calendar, Alerts, Download); summary text; Calendar table (GMT, Reference, Actual, Previous, Consensus, TEForecast); Components table; related-indicators table; stats strip (Actual, Previous, Highest, Lowest, Dates, Unit, Frequency); news; indicator index.
- Units: percent for growth, percentage points for contributions, USD Billion for components. Unit appears in a stats-strip column and in the table.
- Forecast vs actual: forecasts appear in a TEForecast column and in summary prose (2.10 percent for 2027 and 2.70 percent for 2028 per text).
- Missing values: no explicit marker in text.
- Hover/tooltips and range buttons: not verifiable from text.
- Notable: the text itself contains a possible date inconsistency (a Q2 row showing an Actual for a date later than the stated update; flagged as an ambiguity by the summariser, not verified). Login and upsell prompts are visible but no data is hidden.

#### 7. Trading Economics, United States indicators
- URL: https://tradingeconomics.com/united-states/indicators
- Status: OPENED
- Tasks: scan many US indicators at once; find the latest value and unit of each.
- Layout: in-page menu (Overview, GDP, Labour, Prices, Money, Trade, Government, Business, Consumer, Housing, Energy, Health); each section is a table with columns Last, Previous, Highest, Lowest; each row shows name (linked), unit, and a reference month (e.g. "Sep/26").
- Units: per row ("percent", "Thousand", "USD Billion", "points").
- Search or filter: none visible in text. Navigation by anchors and category sections.
- Gating: indicator tables visible without login; only promotions.
- Notable: the reference-month column has no header in text (position-inferred). Some indicators appear in more than one section (e.g. Corporate Tax Rate). Mixed units and mixed reference dates in one table; "Last" and "Previous" are not labelled with their dates.

#### 8. Statista, India GDP statistic
- URL: https://www.statista.com/statistics/263771/gross-domestic-product-gdp-in-the-united-states/ (the content served was an India GDP page; see anomaly)
- Status: OPENED
- Headline: "Gross domestic product (GDP) in current prices in India from 1980 to 2031 (in billion U.S. dollars)".
- Tasks: quick country fact with source and method; find related statistics.
- Layout: headline, chart (type not named in text), summary prose, methodology note, source and last-update date, ~50 related-statistic links.
- Units: headline says billion U.S. dollars; prose uses trillions (e.g. 3.91 trillion for 2025). Mixed units on one page.
- Forecasts: 2025 to 2031 described as a projection in prose; individual years are not labelled actual or estimated.
- Paywall: summary and metadata visible; the full series is not in text. Header has Log in and Contact sales links.
- Notable: URL slug names the United States but content is India (anomaly to check before any reuse of this link). Forecast years are not visually marked in the text.

#### 9. Statista, topic page (mismatch)
- URL: https://www.statista.com/topics/4370/economy-of-india/
- Status: OPENED, but content was about the Jacksonville Jaguars NFL franchise, not India. Recorded as a wrong-page example.
- Layout (as seen): table of contents (Overview, Editor's Picks, Statistics); "Key insights" teasers; "Recommended statistics" grouped with item counts; key figures; related topics; paid report with "Top Seller" label.
- Units: explicit per chart title ("million U.S. dollars"); scales shown as "bn" or "m".
- Gating: many headline values masked ("***bn USD"); message "Log in or register to access full data"; detailed charts behind login; some summary values visible.
- Notable: clear pattern of teaser cards with thumbnail charts, but gating hides the key numbers. Wrong topic for the URL (taxonomy or redirect issue).

#### 10. Bank of England Statistical Interactive Database (landing)
- URL: https://www.bankofengland.co.uk/boeapps/database/
- Status: OPENED (landing page; no series picker or chart visible in text)
- Tasks: browse by topic, table, country, category or sector; search by keyword or code; check exchange rates.
- Layout: "Browse data" menu (Topics, Tables, Countries, Financial categories, Economic/industrial sectors, A-Z); separate "Exchange rates" menu (GBP, EUR, USD daily rates); "Search the database" with quick search and multi-code input (comma-separated, AND/OR); quick links (top 10 series, Bank Rate history); "Visual summaries" linking to chart pages.
- Units, tooltips, missing data, date controls: not visible on this landing page.
- Notable: separate browse, search and quick-link routes; last-updated stamp is printed on the page.

#### 11. Bank of England, Bank Rate history
- URL: https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp
- Status: OPENED
- Tasks: check current policy rate; see history of changes.
- Layout: headline "Current official Bank Rate" (4%); table with two columns, Date Changed and Rate, in reverse chronological order from 05 Nov 26 (4.00) back to 20 Jan 75 (11.25).
- Date range, chart, hover: none visible; the table runs the full history with no controls shown. No chart.
- Units: rate column is unitless numbers with two decimals; the headline shows "%".
- Downloads: "Export the data" heading with no formats listed in text; XML subscription link.
- Notable: clean single-purpose table. No source citation on the table itself beyond the database header.

#### 12. ECB statistics landing (Key figures)
- URL: https://www.ecb.europa.eu/stats/html/index.en.html
- Status: OPENED. The ECB Data Portal (https://data.ecb.europa.eu/) returned HTTP 503, and the dataset page returned HTTP 503.
- Tasks: check headline euro-area figures; find releases; jump to detailed statistics.
- Layout: "Quick links" (Key figures, ECB Data Portal); "Accessing our data" page link; eight indicator cards, each with latest value and reference period (e.g. Inflation rate 4.0% Oct 2026; €STR 2.442 on 05 Nov 2026; 10-year AAA yield 3.34%; GDP volume growth 0.0% Q1 2026); featured topics; "Latest statistical data releases" with dates and dataset codes; search with date filters and sort; request form for unpublished statistics; feedback widget.
- Country selection: none (euro area only on this page).
- Units: in each card (percent, % of, bln EUR, 2.442 with no unit label for €STR).
- Notable: the €STR card shows a bare number with no unit label; the period is shown per card rather than as a page date.

#### 13. Eurostat, Database information page
- URL: https://ec.europa.eu/eurostat/web/main/data/database
- Status: OPENED (information page; the Data Browser was not opened)
- Tasks: understand dataset types before filtering.
- Layout: navigation tree with "Detailed datasets" (multi-dimensional) and "Selected datasets" (2- or 3-dimensional tables), organised into 9 statistical themes plus "EU policies" and "Cross-cutting"; keyword search; links to the Data Browser (filter, customise, save bookmarks) and dataset compression downloads.
- Missing data: ":" means not available; observation status codes "m" (missing where data cannot exist) and "n" (not significant); coding conventions "0" (real zero) and "0n" (below half the unit, not zero).
- Notable: a strong reference for how to flag missing values in text. The filter panel itself (geo, time, unit) was not visible in this page.

#### 14. Eurostat Statistics Explained home
- URL: https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Main_Page
- Status: OPENED
- Tasks: read explanatory articles by theme; find the most-read articles.
- Layout: "Latest articles" (dated list); "Top 10 most visited articles" (numbered ranking); "Statistical themes" (nine themes); "In focus" highlight; keyword search; language selector (machine translation, about 25 languages).
- Country-level content: none on this page. No country selector and no charts.
- Notable: article-driven rather than a dashboard. Useful as a pattern for a "what changed" feed.

#### 15. Eurostat news article, rail passenger transport (30 Oct 2026)
- URL: https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20261030-1
- Status: OPENED
- Tasks: read a short finding with country comparison.
- Layout: prose headline (EU rail passenger-km up 2.6% in 2025, 457 bn from 445 bn); two charts shown as images (EU line chart 2015 to 2025; country bar chart 2025), each linking to Eurostat Data Browser bookmarks and dataset codes; country figures in text; statistic-explained link; share widget; feedback form.
- Units: "billions of passenger-kilometres" linked to a glossary entry; per-inhabitant ratios in text. Unit for passenger-km per inhabitant implied, not stated.
- Missing or footnotes: no footnote markers; "main undertakings" threshold defined in text (100,000,000 passenger-km).
- Notable: number formatting inconsistent in the same paragraph ("2 954" with a space vs "1692" without). Charts are static images, so values are not in page text; the underlying values need the Data Browser.

#### 16. Metabase example dashboards gallery
- URL: https://www.metabase.com/dashboards
- Status: OPENED (gallery list only; no individual example dashboard was opened)
- Tasks: pick a starting dashboard by use case.
- Layout: cards with screenshot, name, "Explore dashboard" link; four sections (Explore example dashboards, Dashboards for teams, Dashboards for specific products and technologies, Dashboards for measuring KPIs). Only the KPI section has short descriptions.
- Content: almost entirely IT, DevOps, marketing and sales examples. No macro, economic or country dashboards in the list.
- Filters, tooltips, units: not in captured text.
- Notable: no economic example in the gallery; relevant only as a layout reference for card-based galleries.

#### 17. Metabase Learn
- URL: https://www.metabase.com/learn/
- Status: OPENED
- Content: dashboard guides (create a dashboard, BI dashboard best practices, linking filters, cross-filtering). No example dashboards on this page; footer links to /dashboards.
- Notable: guidance pages on filter linking are relevant to a filter-panel design.

#### 18. IMF DataMapper
- URLs: https://www.imf.org/external/datamapper/NGDPDPC@WEO/OEMDC/ADVEC/WEOWORLD and https://www.imf.org/external/datamapper/NGDP_RPCH@WEO/OEMDC/ADVEC/WEOWORLD
- Status: PARTIAL. Both returned an unrendered template with unfilled placeholders ({ indicator.label }, { indicator.unit }, { related.length }). Footer read "2021". No chart, table or country list was in the text.
- Tasks (from DataMapper's known purpose, not verified here): indicator-by-country view with projections.
- Projections vs actuals: could not be determined.
- Notable: the captured page is not usable evidence for layout; it shows that the live site relies on client-side rendering, so screenshots from a browser would be needed.

#### 19. IMF WEO database
- URL: https://www.imf.org/en/Publications/WEO/weo-database/2026/October
- Status: FAILED (HTTP 404)

#### 20. OECD (data.oecd.org, data-explorer.oecd.org, topic page, country profile)
- URLs: https://data.oecd.org/gdp/gross-domestic-product-gdp.htm (HTTP 403); https://data-explorer.oecd.org/ (empty content); https://www.oecd.org/en/topics/sub-issues/economic-outlook.html (HTTP 403); https://www.oecd.org/en/countries/united-states.html (HTTP 404)
- Status: FAILED or EMPTY for all four. No OECD layout, filter or unit claims are made in this survey.
- Next step: open these in a browser, not WebFetch, before judging the OECD family.

#### 21. ECB Data Portal (data.ecb.europa.eu)
- URLs: https://data.ecb.europa.eu/ (HTTP 503) and https://data.ecb.europa.eu/data/datasets/ICP/ICP.M.U2.N.000000.4.ANR (HTTP 503)
- Status: FAILED. Only the ECB statistics landing page (entry 12) was read.

#### 22. Tableau Public, Data School "Global Financial Overview" (pick 1 of 2)
- URL: https://public.tableau.com/app/profile/sam.search/viz/GlobalFinancialOverviewDashboard/DashboardTemplate?publish=yes
- Status: PARTIAL. The page returned no rendered viz (separator lines only). Description below is [SEARCH ONLY].
- [SEARCH ONLY] Described in search results as a Tableau Prep project covering 196 countries, with a country picker and line charts for GDP, inflation and unemployment over time. Not verified.
- Source of the description: web search results (Tableau Public / Data School), not opened.

#### 23. Power BI, Fabric community "IMF World Economic Outlook 2025" (pick 2 of 2)
- URL: https://community.fabric.microsoft.com/t5/Data-Stories-Gallery/IMF-World-Economic-Outlook-2025/m-p/4669351
- Status: FAILED (HTTP 403). Description is [SEARCH ONLY].
- [SEARCH ONLY] Search snippet says it covers national accounts, inflation, unemployment, balance of payments, fiscal metrics and trade, described as a two-page layout. Not verified.

---

### Cross-cutting observations (from fetched pages only)

- Units: strongest practice seen is OWID (unit field plus subtitle plus citation) and Eurostat (explicit flag codes). Weakest: World Bank country profile (mixed scales in one column, "Millions" label against "current US$"), Statista topic (units in chart titles, scales in mixed suffixes), and Trading Economics (unit column with no header date label).
- Missing data: Eurostat's coded flags (":", m, n, 0n) are the most explicit. DataBank offers an NA preference setting but does not mention "..". OWID explains breaks in prose. Many pages showed no missing-value rule at all.
- Forecasts vs actuals: Trading Economics (TEForecast column), Statista (prose only, years not labelled) and the World Bank page (no labelling) are the cases seen. Forecast labelling is inconsistent across sites.
- Country comparison: DataBank and OWID offer multi-entity selection (DataBank confirmed in text; OWID partially, via "entities"). Most country pages show only the one country.
- Hover and tooltips: could not be verified on any site because most charts are client-side or images. Treat tooltip behaviour as unknown until checked in a browser.
- Gating: Statista (masked values behind login), Trading Economics (upsell prompts, data visible), World Bank DataBank (save and share need login).
- Mistakes found in pages: World Bank (empty indicator name, stale 2013 figure, unencoded URLs, mismatched units label); Statista (URL slug names the US but content is India; topic page for India served Jaguars content); IMF DataMapper (unrendered placeholders in captured HTML; footer date 2021); Trading Economics (possible date inconsistency in the Q2 row, flagged, not verified).

### Limits of this survey

- WebFetch returns text, not a rendered page. Charts, hover behaviour, filter panels and tooltips were not seen directly for most sites.
- Failed and 403 or 503 pages (OECD, ECB data portal, IMF WEO, Fabric) were not retried with another route.
- No screenshots were taken. Visual design claims are limited to what text describes.
- Metabase example dashboards themselves were not opened.

### B. Analysis of the survey
Evidence is page text from WebFetch, not rendered views. Numbers in brackets are survey entries (#). [SEARCH ONLY] = unverified.

#### 1. Recurring user jobs

| Job | Done well by | What they show |
|---|---|---|
| Look up one country, latest values | World Bank country profile (#1); Trading Economics indicators (#7) | #1: per-theme tables, Indicator / Most recent value / Trend, year per value. #7: sections (GDP, Labour, Prices...) with Last, Previous, Highest, Lowest, unit and reference month per row |
| Compare one indicator across countries | World Bank indicator page (#2); DataBank (#3); OWID (#4, partly) | #2: all-country table (Most Recent Year, Value) plus line/bar/map toggle. #3: country x series x time builder with multi-select. OWID: entity selection implied by download options only |
| Track one series over time | OWID (#4, #5); Bank Rate history (#11); TE GDP (#6) | OWID: title, unit, date range, notes on breaks. #11: plain dated table, current value as headline. #6: Actual / Previous / Consensus / Forecast calendar |
| Check headline and release news | ECB key figures (#12); TE calendar (#6); Eurostat articles (#14) | #12: eight cards, each with value, unit and its own reference period; dated release list. #14: dated "latest articles" feed |
| Check freshness and provenance | OWID (#4, #5); Statista (#8); BoE (#10) | OWID prints last/next update and a source line; Statista shows source and update date; BoE prints a last-updated stamp |
| Get the data out | OWID, DataBank, World Bank | CSV/API; OWID separates "all" from "visible only" |

No opened example offers a country-by-indicator matrix with ranks, so our scorecard has no direct precedent in the evidence.

#### 2. Patterns that work vs fail

Works (supported):
- Reference period shown per value, not per page: ECB cards (#12), WB profile (#1), TE rows (#7).
- Unit as a dedicated field plus subtitle: OWID (#4, #5); per row: TE (#7).
- Coded missing values with a legend: Eurostat ":" , "m", "n", "0n" (#13); OWID explains breaks in prose (#5). DataBank lets users choose the NA marker (#3).
- Source, update dates and citation next to the data: OWID (#4); Statista (#8).
- Single-purpose tables with a headline value: BoE Bank Rate (#11).
- Forecast in its own column (TEForecast, Consensus): TE (#6).
- Unit-mismatch warning before combining series: DataBank (#3).
- Section anchors for long pages: TE (#6, #7).

Fails (supported):
- Mixed scales in one column; "(Millions)" against current US$ (#1, #2); billions vs trillions on one page (#8).
- Bare number with no unit: ECB EUR STR card (#12). Unlabelled Last/Previous dates (#7).
- Mixed reference years in one table with no spread flagged (#1, #7). Our ADR-010 decision 10 already addresses this for rankings.
- Forecast years unmarked: Statista (#8), World Bank (#2).
- No last-updated date: WB indicator page (#2).
- Masked values behind login (#9); wrong content for a URL (#8, #9).
- Trend cells empty, empty indicator name (#1).

Unverified or unknown: hover/tooltips, country-picker behaviour, chart forecast shading, range controls. No fetched page showed them. The Tableau (country picker, line charts for GDP, inflation, unemployment; #22) and Power BI (#23) descriptions are [SEARCH ONLY]. Country-picker claims therefore rest on DataBank text alone (#3: select all, invert, custom groups; 266 countries).

#### 3. Candidate user journeys (hypotheses to test, not observed behaviour)

1. "How is country X doing?" Entry: country name or domain page. Steps: pick the country, scan domain rows with percentile, value, reference period, and n/a states; open an indicator. Answered by: a country profile (rows = domains/indicators, TE #7 and WB #1 pattern). Today only reachable via scorecards or the peer view.
2. "Where does X stand against peers on indicator Y?" Entry: indicator or domain scorecard. Steps: choose indicator, see ranked list with reference-period spread, filter to a peer group. Answered by: peer view (V2), WB #2 style table.
3. "What changed since last month?" Entry: home. Steps: see new releases, alerts, moved ranks, revised values. Answered by: a "what changed" feed (Eurostat #14, ECB release list #12) plus the revisions page. Not present as a landing view today.
4. "Can I trust this number?" Entry: any cell. Steps: open the value, see source, unit, vintage, last update, missing/estimate flag. Answered by: explorer detail plus status page (OWID #4 metadata block).
5. "Take this series away." Entry: explorer. Steps: select series and countries, review unit warnings, export visible data. Answered by: explorer with download (OWID, DataBank).

#### 4. Gaps and browser checks

- No rendered view for IMF DataMapper, OECD, ECB data portal, Power BI, Tableau, Metabase examples (#16, #18-#26). Retry in a browser.
- Hover, tooltips, legends, forecast shading, picker interaction, mobile layout, and chart defaults were not seen anywhere.
- OWID and WB charts were images or placeholders, so chart design is unevaluated.
- Trading Economics Q2 date inconsistency is unconfirmed (#6).
- No user evidence: journeys above are inferred from the survey, not from users. Test them with the user before design.
- Sites sampled are mostly public-data portals for general readers; analyst-grade tools (Bloomberg, Haver, FRED) were not surveyed.

## Risks / unknowns
- Text-only fetch: hover, tooltips, range controls, country pickers, forecast shading and mobile layout were not seen on any site.
- OECD, IMF DataMapper and WEO, ECB data portal, Power BI and Tableau views could not be opened; Tableau and Power BI descriptions are [SEARCH ONLY].
- Metabase example dashboards were not opened; the gallery has no economic examples.
- Analyst-grade tools (Bloomberg, Haver, FRED) were not surveyed.
- The five user journeys are hypotheses inferred from the survey; none was observed or tested with users.

## Open questions for design
- Which journeys do economics students and professors actually use (to be tested with users, ADR-030 spec section 8)?
- Should the failed families be re-checked in a browser before the survey is relied on further?
