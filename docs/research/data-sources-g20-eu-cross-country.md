---
status: approved   # approved by the user on 2026-10-17
topic: Data sources, access methods, terms, coverage and vintages for the approved G20 (ex Russia, ex AU) + EU27 indicator selection
date: 2026-10-17   # first version 2026-10-11; follow-up pass 2026-10-17; coverage-completion pass 2026-10-17 (this revision, live requests)
---
# Data sources for the cross-country indicator selection (G20 + EU27)

Input: `docs/research/indicator-selection-g20-eu-cross-country.md` (status: approved; decisions D1-D19). That document was NOT edited in this pass. The user decisions of 2026-10-17 below change some of its rows; the user must decide whether to update it (see open questions).

Access dates: items first written on 2026-10-11 keep that date; everything added or re-checked in the follow-up pass has access date 2026-10-17 (marked "(17 Oct)" where the two are mixed). Source URLs are given inline.

Labels:
- [VERIFIED-PAGE] = stated on a primary page that I fetched.
- [VERIFIED-API] = read from a live, read-only response of an official data interface (a few light requests, one at a time). Caution: this session has no shell, so every live response was read through a summarising page fetcher; counts and lists could contain transcription slips. Treat as strong evidence, not as an audit.
- [VERIFIED-LIVE 17 Oct] = verified by live request: a read-only HTTP GET with curl on 2026-10-17 (User-Agent "macro-monitor-research (non-commercial)", one request at a time, at least 1.5 s apart), parsed by a script; the raw responses were kept only in a temporary folder outside the repository. This label supersedes the "no shell" caveat above for the cells it marks (F13).
- [SEARCH] = from a web-search result snippet (named in text); needs confirmation on the primary page.
- [THIRD-PARTY] = from a non-official source (package documentation, news, mirrors).
- [UNVERIFIED] = analyst knowledge or not found; do not rely on it.

## User decisions (recorded 2026-10-17; these are user decisions, not researcher findings)

| # | User decision | Effect on this note |
|---|---|---|
| U1 | The project is strictly non-commercial | Terms of the IMF, Eurostat, OECD and World Bank re-assessed in F2 |
| U2 | The user will ask the IMF in writing about scheduled programmatic access | Draft question and a plan for a "no" answer in F12 |
| U3 | Free data only. Drop the purchased-survey (PMI) part of M03 and use the free European Commission and OECD confidence surveys. Drop M26 (sovereign credit-default-swap and bond-index spreads). A06 (sovereign ratings): only as an event log from free public sources if one exists, else drop | F8. Result: no free machine-readable ratings source found, so A06 is dropped unless the user wants a manually kept log |
| U4 | A02 (IMF output gap) stays a core indicator even though coverage of emerging economies is thin; document the actual coverage per country | Coverage table in F6 |
| U5 | Source routing rule: use an aggregator (DBnomics, FRED, etc.) only if it offers native API access to the series; otherwise use the original source. Apply per indicator | F5 (interpretation of the rule stated there, with one question for the user) |
| U6 | M20 (equity indices) dropped for now | F8; the Markets scorecard now has only M16 and, as optional, M25 |

## Question / scope

Which free, citable sources can supply the 28 core indicators (15 monthly, 4 quarterly, 9 annual) and the extended/optional rows where cheap to assess, for 42 countries plus the EU27 and euro-area aggregates, history from 1991, monthly refresh on the 1st, vintages kept going forward (D10), free databases only (D15), and now strictly non-commercial use (U1)? Out of scope: architecture, storage, schemas, code, ranking method.

## Sources assessed

| Source | Access (API/bulk) | Coverage | Frequency | Revisions | Licence / terms (non-commercial use, U1) | Rate limits | Notes |
|---|---|---|---|---|---|---|---|
| Eurostat | REST statistics API https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}; JSON-stat response with an `updated` timestamp; separate path for Comext trade [VERIFIED-PAGE 11 Oct https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/api]. Asynchronous mode for large queries [VERIFIED-PAGE 17 Oct https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/asynchronous-api] | All EU27 plus euro area (EA21 now) and several non-EU: Türkiye in IP, unemployment, HICP; US and Japan in unemployment only; UK listed but empty [VERIFIED-API 17 Oct] | M/Q/A | `updated` timestamp only; no vintage API found | Reuse allowed for commercial and non-commercial purposes with acknowledgement; data from sources other than Eurostat and data for non-EU/EFTA/candidate countries (e.g. US, Japan, China) are non-commercial-only, which is fine for this project [VERIFIED-PAGE 17 Oct https://ec.europa.eu/eurostat/web/main/help/copyright-notice] | Fair-use rules with no published numbers (concurrent extractions; requests and cost per day/7 days/30 days). Under 500,000 cells returned directly; 500,000-5,000,000 cells asynchronous; above 5,000,000 error 413. Recommends one extraction at a time and bulk download where possible [VERIFIED-PAGE 17 Oct asynchronous-api page] | Dataset change: monthly HICP now has a new classification (COICOP 2018) dataset `prc_hicp_minr`, updated 2026-10-16, latest period 2026-09; the old `prc_hicp_manr` stopped at 2025-12 (updated 2026-02-06) [VERIFIED-API 17 Oct]. Search results say the classification and base year (2025=100) changed from January 2026 data [SEARCH]. The earlier "50 categories" cap (third-party) is not on the official pages |
| OECD Data Explorer / SDMX API | SDMX REST https://sdmx.oecd.org/public/rest/; on 17 Oct (later pass) the Key Economic Indicators dataflow (DSD_KEI@DF_KEI, 1991 onward, nine measures) was downloaded in one call (35 MB, HTTP 200) and the prices dataflow (core inflation) in one call; plus two structure calls [VERIFIED-LIVE 17 Oct]. Earlier: two small read-only test queries (CLI-family dataflow, CPI) returned data, one wildcard query returned HTTP 403 [VERIFIED-API 17 Oct]. OECD web pages on API rules, terms and members still return HTTP 403 to my fetcher (retried 17 Oct) | OECD members plus selected partners. In the CLI-family dataflow the visible areas included Brazil, Indonesia, India, South Africa, Romania, Türkiye and all euro-area members tested; China, Argentina, Saudi Arabia not seen, but the visible list was truncated [VERIFIED-API partial]. Panel countries that are OECD members: 30 of 42 (F6) | M/Q/A | Datasets revised in place; `UpdatedAfter` and `contentconstraint` for change detection [SEARCH https://www.oecd.org/en/data/insights/data-explainers/2024/11/Api-best-practices-and-recommendations.html] | CC BY 4.0 is the default for written content from 1 July 2024; data may carry third-party restrictions, so check each dataset [SEARCH https://oecd.org/en/about/oecd-open-by-default-policy.html and press release https://www.oecd.org/en/about/news/press-releases/2024/07/oecd-data-publications-and-analysis-become-freely-accessible.html]. The terms page text itself is unreadable for me (403): [UNVERIFIED] wording on commercial use | CONFLICT unresolved, see F3: 60 data downloads/hour (oecd.org English and French pages, snippets) vs 20 queries/minute and 20 downloads/hour (older mirror). Since March 2026, `lastNObservations`/`firstNObservations` return error 413 on TiVA, CRS and twelve large datasets in direct API calls [SEARCH https://www.oecd.org/en/data/insights/data-explainers/2026/03/Restricted-API-parameter.html] | One test CPI query returned only 17 areas (Australia, Argentina, Brazil, China, India, Indonesia, Canada, Germany, Korea, UK, US and groups) although many more were expected: unexplained, so OECD coverage must be tested properly before relying on it |
| IMF (new data portal and API) | New API host https://api.imf.org/external/sdmx/2.1/ answered keyless read requests: dataflow list, data, structure [VERIFIED-API 17 Oct]. Legacy portal retired effective 5 Nov 2025 [VERIFIED-PAGE https://www.imf.org/external/Data.htm]. The portal API page names no base address and gives datahelp@imf.org for questions [VERIFIED-PAGE https://data.imf.org/en/Resource-Pages/IMF-API]. Dataflows seen: WEO and dated vintages (e.g. WEO_2026_APR_VINTAGE, WEO_2025_OCT_VINTAGE), PCPS (commodity prices), CPI, PI (production indexes), ER, EER, IRFCL (reserves), MFS_IR (interest rates), ITG/IMTS (goods trade), BOP, IIP, QNEA/ANEA (national accounts), LS (labour), FSI, GFS, GDD (global debt database), FM (fiscal monitor), ECFIE (firm inflation expectations from earnings calls) [VERIFIED-API]. The old DataMapper v1 still answers but has no output-gap indicator (148 indicators listed) [VERIFIED-API] | WEO covers about 170-190 economies; output gap only 25 of our 42 (F6) | WEO Apr/Oct (+ Jan/Jul updates); others M/Q/A | Dated vintage dataflows exist for WEO, CPI, PI, BOP, ER etc. [VERIFIED-API] | Statistical data: download, copy, derive and distribute with attribution; "Fair use is authorized for noncommercial purposes"; commercial reuse needs written permission. BUT "The IMF prohibits bulk download of information by automated technology without explicit permission" and access may be terminated; the page does not mention the API [VERIFIED-PAGE 17 Oct https://www.imf.org/en/About/copyright-and-terms]. Non-commercial status does not remove the automated-download clause | 10 requests per 5 seconds per user and 50 per second per application, from an IMF help article [SEARCH snippet of https://datahelp.imf.org/knowledgebase/articles/630877-api; the page itself did not resolve for me] | The central open point (U2). WEO is the only source of the headline output gap (D18) and of forecasts (A03) |
| World Bank | Indicators API v2 https://api.worldbank.org/v2/ keyless; Pink Sheet monthly XLSX [VERIFIED-PAGE 11 Oct]. PIP (poverty and inequality) has its own API [SEARCH https://blogs.worldbank.org/en/opendata/how-use-pips-api] | Life expectancy 42 of 42; Gini 40 of 42 (F10) [VERIFIED-API 17 Oct] | Mostly annual; Pink Sheet monthly (next 3 Nov 2026) | In place; WGI 2.0 recalculated back to 1996 in 2025 | Two pages disagree: the dataset terms summary says CC BY 4.0, commercial or non-commercial use, third-party indicators may need the owner's consent [VERIFIED-PAGE 17 Oct https://data.worldbank.org/summary-terms-of-use]; the general site terms say non-commercial use only and "the API terms likewise bar using the APIs for commercial purposes" [VERIFIED-PAGE 17 Oct, fetched at https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets, summarised as site-wide terms]. Under U1 both readings allow our use | None published | The non-commercial decision removes the earlier ambiguity for the World Bank. Third-party-sourced indicators still need a per-indicator metadata check |
| BIS | SDMX API https://stats.bis.org/api/v2/ (queries worked, one example returned HTTP 404 because of a wrong key) and bulk downloads, 27 datasets (F9) [VERIFIED-PAGE https://data.bis.org/bulkdownload] | Per-dataset country lists in F6 and F9 [VERIFIED-API 17 Oct] | D/M/Q | In place; release calendar | "Use of the statistics is unrestricted" with citation; no investment advice [VERIFIED-PAGE 11 Oct https://data.bis.org/help/legal] | None stated | Cleanest terms. Bulk files per topic are the natural fit |
| ECB Data Portal | SDMX 2.1 REST at data-api.ecb.europa.eu/service/; it replaced the old warehouse host (redirects ended 1 Oct 2025 per ECB homepage snippet) [SEARCH https://data.ecb.europa.eu/help/api/overview]. All ECB data pages and the API returned HTTP 503 earlier on 17 Oct; on the later retry (single request each) the help page and the API answered HTTP 200 and returned data (euro-area main refinancing rate; Italy long-term bank-rate test series; a monthly long-term government bond yield query for 24 euro-area areas) [VERIFIED-LIVE 17 Oct https://data-api.ecb.europa.eu/service/data/IRS/M..L.L40.CI.0000.EUR.N.Z] | Euro area, euro-area members, reference rates, money and credit | D/M/Q | Unknown | Free reuse, including commercial, if the source is quoted ("Source: ECB statistics") and the statistics and metadata are not modified; third-party data excluded; users cannot expect continuity of every series [VERIFIED-PAGE 17 Oct https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html] | Not stated on the help overview or status-codes pages [VERIFIED-LIVE 17 Oct https://data.ecb.europa.eu/help/api/overview, /status-codes] | Reachable on the retry, so the earlier 503s were temporary. Monthly long-term yields (series IRS, L40) exist for 21 euro-area members plus aggregates; start dates in F13. BIS and Eurostat cover most of what we need from the ECB (FX, policy rate, euro-area yields partly) |
| FRED / ALFRED (St. Louis Fed) | REST with free key; vintage parameters [VERIFIED-PAGE 11 Oct] | US plus mirrors of other providers | D/M/Q/A | Real-time vintages | Offered for non-commercial, educational and personal use; third-party series (notes containing "Copyright") need the owner's permission for anything beyond personal use [SEARCH 17 Oct https://fred.stlouisfed.org/docs/api/terms_of_use.html and https://fred.stlouisfed.org/legal] | 120 requests/minute [VERIFIED-PAGE 11 Oct] | Aggregator for non-US series (rule U5). Open question: will outputs be public or private (affects "personal use" wording) |
| UN Comtrade | Free registered tier: 500 calls/day, up to 100,000 records per call, 1 call per second, no bulk files or bulk API [VERIFIED-PAGE 17 Oct https://uncomtrade.org/docs/subscriptions/]; key from the My API portal [VERIFIED-PAGE https://comtradedeveloper.un.org/] | Reporters worldwide [UNVERIFIED monthly depth] | M/A | Reporter revisions | Terms page did not load [UNVERIFIED] | As left | Resolves the earlier third-party number: it is right for calls per day and records per call |
| ILOSTAT | Bulk download (gzip CSV plus code dictionaries) and an SDMX API with a 300,000-record request cap [THIRD-PARTY: Rilostat docs https://search.r-project.org/CRAN/refmans/Rilostat/html/get_ilostat.html]; ILO bulk guidelines (updated 16 Feb 2024) describe automating downloads [SEARCH https://webapps.ilo.org/ilostat-files/Documents/ILOSTAT_BulkDownload_Guidelines.pdf]. All ilostat.ilo.org pages returned HTTP 403 again; retried once more in the later pass (ilostat.ilo.org/about/data-use/): HTTP 403 with a "Just a moment" bot-challenge page [VERIFIED-LIVE 17 Oct]. I did not try to get around the challenge | Global | M/Q/A | [UNVERIFIED] | ILO says the data are "free to use" and gives a citation format [SEARCH https://ilostat.ilo.org/fr/about/dissemination-and-analysis]; the CC BY 4.0 statement comes only from an unofficial client [THIRD-PARTY] | 300,000 records/request [THIRD-PARTY] | Licence text still unconfirmed |
| FAO (FAOSTAT, FFPI, cereal brief, ASIS) | FAOSTAT bulk files (keyless zipped CSV per domain) are the practical route; the query API is reported as login-gated [THIRD-PARTY: https://rdrr.io/cran/FAOSTAT/man/download_faostat_bulk.html and an MCP-server README]. FFPI Excel/CSV, monthly from 1990 [VERIFIED-PAGE 11 Oct]. Cereal brief: monthly Excel "csdb-data-2026-10.xlsx" [VERIFIED-PAGE 17 Oct https://www.fao.org/worldfoodsituation/csdb/en/] | Global | M/A | FFPI/SOFI revised | CC BY 4.0 with FAO additional terms [VERIFIED-PAGE 11 Oct https://www.fao.org/contact-us/terms/db-terms-of-use/en/] | Not stated | See F11 |
| DBnomics (aggregator) | API https://api.db.nomics.world/v22/ keyless; 94 providers listed [VERIFIED-API 17 Oct] | Freshness varies by provider: AMECO re-indexed May-June 2026; NBS China datasets indexed Jan-Mar 2026; the MOSPI (India) and SAMA (Saudi Arabia) mirrors last indexed 2022; the "EC" mirror 2022-2023 [VERIFIED-API 17 Oct] | Daily fetch | Archives provider changes; serving of vintages by API uncertain [THIRD-PARTY forum, undated] | Legal page returned 404; underlying providers' terms apply [UNVERIFIED] | Not stated | Only usable where the mirror is current (F5) |
| European Commission surveys and AMECO | Surveys: ZIP downloads; new data browser with API "in testing" [VERIFIED-PAGE 11 Oct]. AMECO: zip files, archive of earlier releases. DBnomics serves AMECO output gap AVGDGP for 37 series [VERIFIED-API 17 Oct] | Surveys: EU and applicant countries [VERIFIED-PAGE 17 Oct https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en]; AMECO output gap: all EU27, UK, US, plus aggregates (F6) | M / twice a year | AMECO archive = vintages | Free of charge; no licence text on survey page | n/a | |
| Others unchanged from 11 Oct | UN World Population Prospects (CC BY 3.0 IGO; the page shown 17 Oct gave no edition information), Penn World Table 11.0 (CC BY 4.0), policyuncertainty.com (terms [UNVERIFIED]) | | | | | | |

## Findings

### F1. Confirmations (carried over from 11 Oct, still valid)
1. Bulgaria joined the euro area on 1 January 2026 (21st member). Eurostat now publishes an EA21 aggregate, which confirms it in practice [VERIFIED-API 17 Oct]; ECB press release [SEARCH https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260101~c830245e42.en.html].
2. The African Union is a permanent G20 member since the New Delhi summit, 9 Sep 2023 [THIRD-PARTY https://weforum.org/stories/2023/09/african-union-g20-world-leaders].
3. The October 2026 World Economic Outlook was due 13 Oct 2026 [VERIFIED-PAGE 11 Oct https://www.imf.org/en/publications/weo/issues/2026/10/13/world-economic-outlook-october-2026]. On 17 Oct the IMF dataflow list showed WEO_2026_APR_VINTAGE but no October 2026 vintage flow yet, so the plain `WEO` dataflow is probably the October 2026 edition [VERIFIED-API; inference].
4. IMF hosts: legacy portal retired 5 Nov 2025 [VERIFIED-PAGE https://www.imf.org/external/Data.htm]; the dataservices.imf.org shutdown is no longer only third-party.

### F2. Terms re-assessed under "strictly non-commercial" (U1)
| Source | Non-commercial position | What still binds | Evidence |
|---|---|---|---|
| IMF | Statistical data may be downloaded, copied, used and distributed with attribution; fair use authorised for non-commercial purposes | Automated bulk download needs explicit permission whether or not the use is commercial; no alteration of the nature of data; no training of large language models without permission | https://www.imf.org/en/About/copyright-and-terms (17 Oct) |
| Eurostat | Even less restricted: non-EU and other-source data are non-commercial-only, and we are non-commercial | Acknowledge the source; state modifications; do not redistribute third-party-copyright material; Swiss/Liechtenstein trade and Austrian 8-digit trade data cannot be sold (irrelevant for non-commercial) | https://ec.europa.eu/eurostat/web/main/help/copyright-notice (17 Oct) |
| OECD | No new obstacle expected (the open licence also permits commercial use) | Per-dataset third-party ownership; automated access subject to the rate rule (F3). The terms text itself is [UNVERIFIED] because the page returns 403 | search snippets, see Sources table |
| World Bank | Both term pages permit non-commercial use | Attribution; per-indicator third-party consent; the API terms bar commercial use only | https://data.worldbank.org/summary-terms-of-use (17 Oct); site terms fetched 17 Oct |
| ECB, BIS, FAO | Unrestricted or open with citation | ECB: do not modify the statistics; FAO: no implied endorsement | pages in Sources table |
| FRED | Intended for non-commercial use | Copyright-flagged third-party series need owner permission for anything beyond personal use | https://fred.stlouisfed.org/docs/api/terms_of_use.html (snippet) |
Net effect of U1: the earlier licensing doubts for Eurostat and the World Bank are settled in the user's favour; the IMF automated-access question is NOT settled by U1.

### F3. Rate limits and access practicalities
| Source | Limit | Status |
|---|---|---|
| OECD | 60 data downloads per hour (oecd.org English and French pages) vs 20 queries per minute and 20 data downloads per hour (read.oecd-ilibrary.org mirror, said to be introduced Nov 2024) | CONFLICT. Both come from search-result text; I could not open any OECD page (403 on three retries 17 Oct). The oecd.org copy is the official domain and its pages are dated Nov 2024, so 60/hour is more likely current, but the mirror could be the later wording. Neither can be resolved from my side. Practical rule until confirmed by OECD in writing: plan for the stricter figure (20 downloads/hour). Retry 17 Oct (later pass): oecd.org/en/about/terms-conditions.html again HTTP 403, and the body is a Cloudflare "Just a moment" challenge, i.e. an anti-bot wall, not a missing page [VERIFIED-LIVE]; the conflict stays open. In this pass I used 2 data downloads (Key Economic Indicators, prices) plus 2 structure calls and 3 failed attempts (a wrong key returned HTTP 403 with the message "Not enough key values in query" and a wrong wildcard HTTP 404 "NoResultsFound"); at most 5 OECD data requests in total, below even the stricter 20/hour figure. Note: an OECD HTTP 403 on the data API can mean a malformed key, not a block [VERIFIED-LIVE] The same limit applies to CSV downloads from the web interface; VPN or anonymised traffic is not allowed [SEARCH] |
| IMF | 10 requests per 5 seconds per user, 50 per second per application | SEARCH snippet; use of the bulk clause still needs permission |
| Eurostat | Fair-use thresholds without numbers; 500,000 / 5,000,000 cell thresholds | VERIFIED-PAGE |
| UN Comtrade | 500 calls/day, 100,000 records/call, 1 call/second, no bulk on free tier | VERIFIED-PAGE |
| FRED | 120 requests/minute | VERIFIED-PAGE |
| ILOSTAT | 300,000 records per request | THIRD-PARTY |
| Banco Central do Brasil (series API) | Query window at most 10 years; since 26 Mar 2025 returned volume is limited and filters are required | SEARCH |
| Statistics Indonesia (BPS) | free API key; 60 requests/minute per key reported by a community project | THIRD-PARTY |
| World Bank, BIS | none stated | page silent |
| ECB | unknown | pages return 503 |
Implication: the Eurostat, BIS, FAO, WEO-file and Pink Sheet routes are file- or bulk-friendly; OECD and Comtrade are the throttled ones.

### F4. Vintages and revisions (informational, D10)
- IMF: dated vintage dataflows for WEO (and for CPI, PI, BOP, ER, EER, IIP, QNEA, ANEA, MFS and others) exist on the new API [VERIFIED-API 17 Oct]. The WEO page offers a vintage comparison tool and a Historical Forecasts Database [VERIFIED-PAGE 11 Oct https://data.imf.org/en/datasets/IMF.RES:WEO].
- FRED/ALFRED: full real-time vintages [VERIFIED-PAGE 11 Oct].
- AMECO: archive of earlier releases [VERIFIED-PAGE 11 Oct].
- Eurostat: only the `updated` timestamp; ECB euro-area real-time database status unclear [SEARCH].
- Re-estimation events that break comparability: WGI 2.0 (2025), FAO SOFI each report, BIS reclassification of five economies as advanced (March 2026), Penn World Table 11.0 (Oct 2025), Eurostat HICP classification and base-year change (January 2026 data), IMF legacy-to-new portal migration (Nov 2025; series codes of the retired IFS database changed [SEARCH]).

### F5. Source routing rule (U5) and per-indicator mapping

Interpretation I applied (please confirm, open question 1): international compilers that publish their own harmonised series with a documented API (Eurostat, ECB, BIS, IMF, OECD, World Bank, FAO, Comtrade, ILOSTAT) count as original sources. Aggregators are DBnomics, FRED (for non-US series) and similar re-publishers. Rule applied: take the series from the original source; use an aggregator only where the original offers files but no programmatic access AND the aggregator's own API serves the series AND the mirror is current. Under that reading only AMECO qualifies today (output gap comparison A02c). The MOSPI and SAMA mirrors on DBnomics fail the "current" test (last indexed 2022); the NBS China mirror is current for annual tables but I could not confirm monthly tables [VERIFIED-API 17 Oct].

| ID | Indicator | Chosen original source (route) | Aggregator needed? | Gaps and notes |
|---|---|---|---|---|
| M01 | Industrial production | EU27 and Türkiye: Eurostat `sts_inpr_m` (latest Aug 2026, all 27 EU members present) [VERIFIED-API]. Others: OECD for members/partners; national: Brazil IBGE, Mexico INEGI (free token), Argentina INDEC through the national time-series API, Korea, Japan, UK, Canada, Australia, US national bodies; India MoSPI portal API (new, beta [SEARCH]) | no | China: statistics bureau has no documented API I could find; Saudi GASTAT publishes a monthly index (Feb 2026 release seen) but I found no API [SEARCH]; South Africa Stats SA API not found. These three need OECD or a manual file route; coverage to be tested |
| M02 | Retail volume | Eurostat `sts_trtu_m` (indic_bt=VOL_SLS, nace_r2=G47, s_adj=CA, unit=I21): all 27 EU members, start 1994-2000 (except Ireland 2021 and Sweden 2023 in this series), Türkiye 2010 [VERIFIED-LIVE 17 Oct]; OECD KEI `TOVM` from 1991 for most OECD members [VERIFIED-LIVE] | no | Not found: Argentina, Australia, China, India, Indonesia, Saudi Arabia; Brazil from 2000; Bulgaria, Cyprus, Malta, Romania OECD absent (Eurostat only, from 2000). Details F13 |
| M03 | Business confidence (survey part only, U3) | EC survey ZIPs (EU27, applicants); OECD business confidence composite for OECD members and partners [VERIFIED-API: dataflow carries composite business and consumer confidence, areas seen include BRA, IDN, IND, ZAF, ROU] | no | Not seen: Argentina, China, Saudi Arabia (list truncated, test needed) |
| M04 | Consumer confidence | Eurostat `ei_bsco_m` (EC survey, indic BS-CSMCI, balance) for EU27 + Türkiye, 1991 start for 12 EU members; OECD KEI `CCICP` for Australia, Brazil, China, Indonesia, Japan, Mexico, Korea, Türkiye, UK, US [VERIFIED-LIVE 17 Oct] | no | Not found: Argentina, Canada, India, Saudi Arabia, South Africa. M03 survey part: OECD `BCICP` found for Brazil, China, Mexico, Korea, Türkiye, UK, US; not found for Argentina, Australia, Canada, India, Indonesia, Japan, Saudi Arabia, South Africa [VERIFIED-LIVE] |
| M06/M07/G01 | CPI, core, food | EU27 and Türkiye: Eurostat `prc_hicp_minr` (note new dataset code) [VERIFIED-API]; OECD (Argentina, Brazil, China, India, Indonesia seen in a test [VERIFIED-API]); national. M07 core (coicop18=TOT_X_NRG_FOOD, annual rate) live: all 27 EU members + Türkiye, start 1997-2001 (new classification), latest 2026-09 [VERIFIED-LIVE 17 Oct]. OECD prices dataflow, core (`_TXNRG_01_02`, 1991 on): only EU HICP countries (ending 2025-12, i.e. the old classification) and the UK (1991 to 2020-11) [VERIFIED-LIVE] | no | M07 core: NO source found in this pass for the 14 non-EU countries other than Türkiye (Argentina, Australia, Brazil, Canada, China, India, Indonesia, Japan, Mexico, Saudi Arabia, South Africa, Korea, UK, US) except UK to 2020. Not tested: national statistics offices, other OECD dataflows. The KEI dataflow gives headline CPI only. Headline CPI `CP` in KEI: Argentina from 2017, Australia from 2024-04 (quarterly CPI otherwise), Saudi Arabia to 2025-07, Japan to 2021-06, Mexico to 2024-07, South Africa to 2025-01 [VERIFIED-LIVE]; so these headline series are stale or short in the OECD dataflow |
| M09 | Unemployment | Eurostat `une_rt_m` (EU27 + Türkiye, US, Japan; latest Aug/Sep 2026) [VERIFIED-API]; OECD; ILOSTAT | no | UK no data in Eurostat; emerging economies via ILOSTAT/OECD, monthly often only quarterly |
| M12 | Merchandise trade | EU27: Eurostat `ext_st_27_2020msbec` (member states, partner WORLD, BEC total, value in euro): all 27 members, start 2002-01, latest 2026-08 [VERIFIED-LIVE 17 Oct]. OECD KEI `EX`/`IM` monthly: 1991 start for all 15 non-EU countries except China (1992) and Saudi Arabia (2016), and for most older EU members [VERIFIED-LIVE]. IMF ITG/IMTS and Comtrade: not tested | no | Eurostat starts 2002 only, so the pre-2002 history of EU members comes from OECD (not Bulgaria, Cyprus, Malta, Romania). Saudi Arabia 2016 start. Values are in national or euro terms (check unit per source); USD conversion is a design step |
| M14 | Reserves | World Bank WDI `FI.RES.TOTL.CD` (total reserves incl. gold, current USD, annual): all 42 countries have values, start 1991 except Croatia 1992, Estonia 1992, Lithuania 1992, Czechia 1993, Latvia 1993, Slovakia 1993; latest 2025 [VERIFIED-LIVE 17 Oct https://api.worldbank.org/v2/]. IMF IRFCL (monthly): the single test call timed out after 90 s with 1.2 MB received (partial response: 23 reporters seen, among them Argentina, Australia, Brazil, Canada, China, Germany); monthly coverage NOT determined [VERIFIED-LIVE partial] | no | Monthly reserves per country therefore untested; annual is covered for all. The IRFCL response is large (several MB for one month), so do not request it unfiltered |
| M15 | Real effective exchange rate | BIS broad index: all 42 countries (F9) [VERIFIED-API] | no | broad monthly starts 1994, so 1991-93 missing for all |
| M16 | USD exchange rate | BIS bilateral dataset (about 190 economies monthly) [VERIFIED-API/VERIFIED-PAGE] ; ECB reference rates secondary | no | |
| M17 | Policy rate | BIS central-bank policy rates (F9) | no | Bulgaria not in BIS; euro members inherit ECB rate |
| M18 | 10-year yield | Eurostat `irt_lt_mcby_m` (EMU convergence criterion yield) for 27 EU members, UK to 2025-04 [VERIFIED-LIVE 17 Oct]; ECB `IRS` L40 for euro members, 1991 start for Belgium, Germany, France, Netherlands (others 1991-2005; Estonia 2020) [VERIFIED-LIVE]; OECD KEI `IRLT` for non-EU: Australia, Canada, Japan, South Africa, UK, US from 1991; Brazil 1994; Mexico 2001; Korea 2000; India 2011; China 2014; Indonesia 2012 to 2024-12 (stale) [VERIFIED-LIVE] | no | NOT found: Argentina, Saudi Arabia, Türkiye. Many EU members start only 2000-2005 (convergence-criterion series) |
| M24 | Commodities | World Bank Pink Sheet (monthly, next 3 Nov), IMF PCPS | no | |
| Q01 | Real GDP | Eurostat `namq_10_gdp` (unit CLV_PCH_PRE, s_adj SCA, B1GQ): 27 EU members + Türkiye, start 1995-Q2 for most (Finland, France 1991-Q1; Germany 1991-Q2; Sweden 1993-Q2; Malta 2000-Q2); OECD KEI `B1GQ_Q` for non-EU [VERIFIED-LIVE 17 Oct] | no | Non-EU start: 1991-Q1 for Australia, Canada, Indonesia, Mexico, South Africa, Korea, UK, US; China 1993; Japan 1994; Brazil 1996; India 2004. NOT found: Argentina, Saudi Arabia. Eurostat series for the UK ends 2020-Q3 |
| Q05 | Current account | OECD KEI `CA_GDP` (% of GDP, quarterly): all 15 non-EU countries, start 1991-Q1 for Australia, Canada, South Africa, Korea, UK, US, Germany; Argentina, Saudi Arabia, Mexico, Indonesia, India 2004-2006 [VERIFIED-LIVE 17 Oct]. Eurostat `bop_c6_q` (euro millions, partner WRL_REST): 26 EU members + Türkiye, start 1991-2005 [VERIFIED-LIVE]. IMF BOP: not tested | no | EU members: % of GDP must be computed (OECD has % GDP for most). Bulgaria, Cyprus, Malta, Romania not in OECD KEI |
| Q06 | Credit-to-GDP and gap | BIS total credit and credit-to-GDP gaps: 32 of 42 (F6) | no | Ten EU members missing: Bulgaria, Croatia, Cyprus, Estonia, Latvia, Lithuania, Malta, Romania, Slovakia, Slovenia |
| Q08 | Government debt (quarterly) | Eurostat `gov_10q_ggdebt` (PC_GDP, S13, GD): 27 EU members, start 1995-Q4 (Belgium, Bulgaria, Croatia, Hungary, Slovenia, Spain), 1996-1998 (Luxembourg, Sweden) and 2000-Q1 for the others; Türkiye absent [VERIFIED-LIVE 17 Oct]. Non-EU: IMF WEO annual `GGXWDG_NGDP`; World Bank central-government debt `GC.DOD.TOTL.GD.ZS` is patchy and not usable as a general-government series [VERIFIED-LIVE] | no | WEO 1991 value present for only 16 of 42 (single-year test, F13). No quarterly source for non-EU countries found in this pass |
| A01 | GDP per head, PPP | WEO, World Bank, Penn World Table | no | |
| A02 | IMF output gap (core, U4) | IMF WEO `NGAP_NPGDP` (F6) | no | 25 of 42 |
| A02b | OECD output gap | OECD Economic Outlook [UNVERIFIED coverage] | no | |
| A02c | EC output gap | AMECO AVGDGP via DBnomics (37 series, EU27 + UK + US, indexed May 2026) [VERIFIED-API] | YES (AMECO has only zip files; the DBnomics API serves it natively) | Stored separately (D18) |
| A03-A05 | WEO forecasts, fiscal balance, debt | WEO on the IMF API; Eurostat for EU. Live test of three WEO indicators for 1991 (one call each, all economies): debt `GGXWDG_NGDP`, 16 of 42 panel countries have a 1991 value; net lending `GGXCNL_NGDP` 21 of 42; current account `BCA_NGDPD` 32 of 42 [VERIFIED-LIVE 17 Oct]. Eurostat quarterly net lending `gov_10q_ggnfa` (PC_GDP, S13, B9): start 1995-Q1 to 2002-Q1 for all 27 EU members | no | depends on U2. Most EU members show no 1991 value in WEO; USA, Korea and Argentina show none for debt or net lending either, which is surprising for the USA and Korea and was not investigated (single-year query only) |
| A10 | Population | UN World Population Prospects; World Bank | no | edition [UNVERIFIED] |
| A11, A14, A22, A16, A17, Q14, A06 | see F10 | | | |

### F6. Per-country coverage table
Scope: what I could verify country by country. Columns: OECD = member of the OECD (membership, not data); Eurostat = in the Eurostat monthly datasets for industrial production / unemployment / inflation (I/U/H); BIS credit = has total credit and credit-to-GDP gap (Q06); BIS rate = has a policy-rate series (M17; "inh" = inherits the ECB rate, no own series); IMF gap = IMF output gap in the current WEO dataflow (A02); Gini = World Bank Gini with a value in 2018-2025; B-READY = World Bank business readiness published (A17; one-off per economy, not a time series). Broad real effective exchange rate (M15) exists for ALL 42 [VERIFIED-API 17 Oct]; WEO growth/inflation/fiscal/debt (A03-A05) and life expectancy (A11) exist for all 42 (WEO: 38 of 42 seen, the other four were cut off in the response; life expectancy 42 of 42) [VERIFIED-API]. WGI (A16) and population (A10) expected for all [UNVERIFIED not queried].

| Country | OECD | Eurostat I/U/H | BIS credit | BIS rate | IMF gap | Gini | B-READY |
|---|---|---|---|---|---|---|---|
| Argentina | no | no | yes | yes | no | yes | 2026 planned |
| Australia | yes | no | yes | yes | yes | yes | 2026 planned |
| Brazil | no | no | yes | yes | no | yes | 2026 planned |
| Canada | yes | no | yes | yes | yes | yes | 2025 |
| China | no | no | yes | yes | no | yes | 2026 planned |
| India | no | no | yes | yes | no | yes | 2026 planned |
| Indonesia | no | no | yes | yes | no | yes | 2024 |
| Japan | yes | U only | yes | yes | yes | yes | 2026 planned |
| Mexico | yes | no | yes | yes | no | yes | 2024 |
| Saudi Arabia | no | no | yes | yes | no | NO | 2026 planned |
| South Africa | no | no | yes | yes | no | yes | 2027 planned |
| South Korea | yes | no | yes | yes | yes | yes | 2025 |
| Türkiye | yes | I/U/H | yes | yes | no | yes | 2025 |
| United Kingdom | yes | none (listed, empty) | yes | yes | yes | yes | 2025 |
| United States | yes | U only | yes | yes | yes | yes | 2025 |
| Austria | yes | I/U/H | yes | legacy | yes | yes | 2026 planned |
| Belgium | yes | I/U/H | yes | legacy | yes | yes | 2025 |
| Bulgaria | no | I/U/H | NO | NO (inh since 2026) | no | yes | 2024 |
| Croatia | no | I/U/H | NO | yes (own to 2022, then inh) | no | yes | 2024 |
| Cyprus | no | I/U/H | NO | inh | yes | yes | 2025 |
| Czechia | yes | I/U/H | yes | yes | no | yes | 2025 |
| Denmark | yes | I/U/H | yes | yes | yes | yes | 2026 planned |
| Estonia | yes | I/U/H | NO | inh | yes | yes | 2024 |
| Finland | yes | I/U/H | yes | inh | yes | yes | 2026 planned |
| France | yes | I/U/H | yes | legacy | yes | yes | 2026 planned |
| Germany | yes | I/U/H | yes | legacy | yes | yes | 2026 planned |
| Greece | yes | I/U/H | yes | legacy | yes | yes | 2024 |
| Hungary | yes | I/U/H | yes | yes | no | NO | 2024 |
| Ireland | yes | I/U/H | yes | inh | yes | yes | 2025 |
| Italy | yes | I/U/H | yes | legacy | yes | yes | 2025 |
| Latvia | yes | I/U/H | NO | inh | no | yes | 2025 |
| Lithuania | yes | I/U/H | NO | inh | no | yes | 2026 planned |
| Luxembourg | yes | I/U/H | yes | inh | yes | yes | 2026 planned |
| Malta | no | I/U/H | NO | inh | yes | yes | 2025 |
| Netherlands | yes | I/U/H | yes | legacy | yes | yes | 2026 planned |
| Poland | yes | I/U/H | yes | yes | no | yes | 2025 |
| Portugal | yes | I/U/H | yes | legacy | yes | yes | 2024 |
| Romania | no | I/U/H | NO | yes | no | yes | 2024 |
| Slovakia | yes | I/U/H | NO | inh | yes | yes | 2024 |
| Slovenia | yes | I/U/H | NO | inh | yes | yes | 2025 |
| Spain | yes | I/U/H | yes | legacy | yes | yes | 2025 |
| Sweden | yes | I/U/H | yes | yes | yes | yes | 2025 |
| Aggregates | | EU27 and EA21: I/U/H | euro area (code XM) only | euro area (XM) | groups with unlabeled codes only; EU27 and euro area in AMECO (A02c) | n/a | n/a |

Notes on the table [VERIFIED-API 17 Oct unless stated]:
- Totals: OECD members 30 of 42 (membership list from my knowledge of the OECD roster; the OECD members page returned 403) [UNVERIFIED]. BIS credit 32 of 42; BIS own policy-rate series 31 of 42 (euro members "legacy" have national history before the euro plus the euro-area series; "inh" members only have the euro-area series, "yes" for Croatia is from the series list); IMF output gap 25 of 42; Gini 40 of 42; B-READY already published for 26 of 42 (one snapshot per economy).
- IMF output gap (A02, core by U4): missing for nine G20 emerging economies (Argentina, Brazil, China, India, Indonesia, Mexico, Saudi Arabia, South Africa, Türkiye) and for eight EU members (Bulgaria, Croatia, Czechia, Hungary, Latvia, Lithuania, Poland, Romania). First observation year: 1995 has 26 country codes in the same dataset (so at least 1995 for those; 1991 start untested). Projection years run to at least 2031 for only eight economies (Canada, Germany, France, UK, Italy, US and two groups). Combined effect: the headline output-gap indicator can rank at most 25 countries, 60 percent of the panel. Because D18 forbids mixing sources, the EC series (AMECO: all 27 EU members, UK, US; 29 of 42) cannot fill the gaps in the ranking; the EC series would add Bulgaria, Croatia, Czechia, Hungary, Latvia, Lithuania, Poland, Romania only as a comparison series.
- Eurostat monthly: latest values were Aug-Sep 2026 on 2026-10-15/16 updates. Bulgaria, Croatia present.
- BIS REER broad: 64 economies, monthly from 1994; narrow: 27 economies, monthly from 1964 [VERIFIED-PAGE https://data.bis.org/topics/EER].
- UPDATE 17 Oct (later pass): M02, M04, M07, M12, M14, M18, Q01, Q05, Q08 and A04 were tested country by country with a shell; results and start dates are in F13. Still untested: A05 in detail (covered with Q08/A04 in F13 only for the 1991 value), IMF monthly reserves, national sources, and the other items listed in F13 point 6.

Expected pattern for the 15 non-EU countries (superseded by the live results in F13): Japan, Korea, UK, US, Canada, Australia are OECD members with national interfaces; Brazil, Mexico, Argentina, Indonesia, Türkiye have central-bank or statistics-office interfaces (F7); China, Saudi Arabia, South Africa and India are the hardest.

### F13. Remaining coverage cells and 1991 start check (live requests, 17 Oct 2026)

All figures in this section are [VERIFIED-LIVE 17 Oct]: read-only GET requests with curl, parsed by script, label "verified by live request". Scope: only the indicators still open (M02, M03 survey part, M04, M07, M12, M14, M18, Q01, Q05, Q08, A04). Indicators dropped by user decisions (PMI part of M03, M26, M20, A06, M25, A17, G13) were not tested.

How to read the table. Each cell = best (earliest) start among the sources I tested, as a letter and a year: E = Eurostat, O = OECD Key Economic Indicators dataflow, W = World Bank WDI (annual). "-" = no series found for that country in the tested sources (not proof that no source exists). The 1991 requirement (D4) is met when the year is 1991; any later year means a shorter history (it does not mean the data are stale: all series listed run to a recent date unless noted below). For quarterly series the year is the first quarter's year. Requests were filtered to 1991 onward, so earlier history was not examined. Gov debt and Fiscal balance for non-EU countries use only the IMF WEO annual single-year-1991 test. Where two sources exist, the earlier start is shown; the latest date and the other source are in the F5 rows.

| Country | Retail volume | Consumer conf. | Core CPI | Goods trade | Reserves | 10y yield | Quarterly GDP | Current acct | Gov debt | Fiscal balance |
|---|---|---|---|---|---|---|---|---|---|---|
| Argentina | - | - | - | O1991 | W1991 | - | - | O2006 | WEO annual, 1991 no | WEO annual, 1991 no |
| Australia | - | O1991 | - | O1991 | W1991 | O1991 | O1991 | O1991 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| Brazil | O2000 | O1994 | - | O1991 | W1991 | O1994 | O1996 | O1996 | WEO annual, 1991 no | WEO annual, 1991 no |
| Canada | O1991 | - | - | O1991 | W1991 | O1991 | O1991 | O1991 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| China | - | O1991 | - | O1992 | W1991 | O2014 | O1993 | O1998 | WEO annual, 1991 no | WEO annual, 1991 yes |
| India | - | - | - | O1991 | W1991 | O2011 | O2004 | O2004 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| Indonesia | - | O2001 | - | O1991 | W1991 | O2012 | O1991 | O2004 | WEO annual, 1991 no | WEO annual, 1991 no |
| Japan | O1991 | O1991 | - | O1991 | W1991 | O1991 | O1994 | O1996 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| Mexico | O1991 | O2001 | - | O1991 | W1991 | O2001 | O1991 | O2006 | WEO annual, 1991 no | WEO annual, 1991 yes |
| Saudi Arabia | - | - | - | O2016 | W1991 | - | - | O2006 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| South Africa | O1991 | - | - | O1991 | W1991 | O1991 | O1991 | O1991 | WEO annual, 1991 no | WEO annual, 1991 no |
| South Korea | O1995 | O1998 | - | O1991 | W1991 | O2000 | O1991 | O1991 | WEO annual, 1991 no | WEO annual, 1991 no |
| Türkiye | E2010 | O2004 | E1997 | O1991 | W1991 | - | E1995 | O1995 | WEO annual, 1991 no | WEO annual, 1991 no |
| United Kingdom | O1991 | O1991 | - | O1991 | W1991 | O1991 | O1991 | O1991 | WEO annual, 1991 yes | WEO annual, 1991 yes |
| United States | O1991 | O1991 | - | O1991 | W1991 | O1991 | O1991 | O1991 | WEO annual, 1991 no | WEO annual, 1991 no |
| Austria | O1991 | O1991 | E2000 | O1991 | W1991 | E1991 | O1991 | O1995 | E2000 | E2001 |
| Belgium | O1991 | E1991 | E1999 | O1991 | W1991 | E1991 | E1995 | O2003 | E1995 | E1995 |
| Bulgaria | E2000 | E2001 | E1997 | E2002 | W1991 | E2003 | E1996 | E1998 | E1995 | E1999 |
| Croatia | E2000 | E2005 | E1999 | E2002 | W1992 | E2005 | E1995 | E2000 | E1995 | E1999 |
| Cyprus | E2000 | E2001 | E1997 | E2002 | W1991 | E2001 | E1996 | E2004 | E2000 | E1995 |
| Czechia | O1996 | E1995 | E2000 | O1991 | W1993 | E2000 | E1995 | E1993 | E2000 | E1999 |
| Denmark | O1991 | E1991 | E2000 | O1991 | W1991 | E1991 | E1995 | O2005 | E2000 | E1999 |
| Estonia | O1998 | E1992 | E2001 | O1993 | W1992 | E2020 | E1995 | E1993 | E2000 | E2002 |
| Finland | O1991 | O1991 | E2000 | O1991 | W1991 | E1991 | E1991 | O1995 | E2000 | E1999 |
| France | O1991 | E1991 | E1997 | O1991 | W1991 | E1991 | E1991 | O1999 | E2000 | E1995 |
| Germany | O1991 | E1991 | E1997 | O1991 | W1991 | E1991 | O1991 | O1991 | E2000 | E2002 |
| Greece | O1991 | E1991 | E1997 | O1991 | W1991 | E1992 | O1991 | O2002 | E2000 | E1999 |
| Hungary | O1992 | E1993 | E2001 | O1991 | W1991 | O1999 | E1995 | O1995 | E1995 | E1999 |
| Ireland | O2000 | E1991 | E2000 | O1991 | W1991 | E1991 | E1995 | O2002 | E2000 | E2002 |
| Italy | O1991 | E1991 | E2000 | O1991 | W1991 | E1991 | O1991 | O1995 | E2000 | E1999 |
| Latvia | E2000 | E1993 | E1998 | O1999 | W1993 | E2001 | E1995 | O2000 | E2000 | E1999 |
| Lithuania | E1998 | E2001 | E1997 | O1999 | W1992 | E2001 | E1995 | E1995 | E2000 | E1999 |
| Luxembourg | O1995 | E2002 | E2000 | O1991 | W1991 | E1991 | E1995 | O1995 | E1998 | E2002 |
| Malta | E2000 | E2002 | E1997 | E2002 | W1991 | E2001 | E2000 | E2004 | E2000 | E1999 |
| Netherlands | O1994 | E1991 | E2000 | O1991 | W1991 | E1991 | O1991 | O2003 | E2000 | E1999 |
| Poland | O1991 | E2001 | E1997 | O1991 | W1991 | E2001 | E1995 | O2004 | E2000 | E1999 |
| Portugal | O1991 | E1991 | E2000 | O1991 | W1991 | E1991 | E1995 | O1996 | E2000 | E1999 |
| Romania | E2000 | E2001 | E2001 | E2002 | W1991 | E2005 | E1995 | E1999 | E2000 | E1995 |
| Slovakia | O1995 | E1999 | E1997 | O1992 | W1993 | O2000 | E1995 | O2004 | E2000 | E1999 |
| Slovenia | O1998 | E1996 | E2001 | O1999 | W1991 | E2002 | E1996 | E1994 | E1995 | E1999 |
| Spain | O1995 | E1991 | E2001 | O1991 | W1991 | E1991 | E1995 | E1993 | E1995 | E1995 |
| Sweden | O1991 | E1995 | E2000 | O1991 | W1991 | E1991 | O1991 | E1992 | E1996 | E1995 |

Cells in the table are one number per source; they do not check that definitions agree (HICP vs national CPI, seasonal adjustment, euro vs national currency). Sources and exact series are in the F5 rows above.

Findings in plain language:
1. A source was found for all 42 countries for: annual total reserves (World Bank, start 1991-1993); goods trade (Eurostat from 2002 plus OECD from 1991, but Saudi Arabia only from 2016 and China from 1992); current account (OECD % of GDP for non-EU, Eurostat euro values for EU, start 1991-2006).
2. EU members are well covered in Eurostat but most Eurostat series start between 1995 and 2002, not 1991: retail 1994-2000 (Ireland 2021 and Sweden 2023 in the volume series I queried), core inflation 1997-2001, quarterly government debt 1995-2000, net lending 1995-2002, trade 2002, yields 2000-2005 for the newer members. The OECD dataflow fills part of the gap back to 1991 for the older members, but not for Bulgaria, Cyprus, Malta and Romania, which are not in it.
3. Gaps among the 15 non-EU countries: retail volume (Argentina, Australia, China, India, Indonesia, Saudi Arabia missing), consumer confidence (Argentina, Canada, India, Saudi Arabia, South Africa missing), core inflation (none found except Türkiye and the UK to 2020), 10-year yield (Argentina, Saudi Arabia, Türkiye missing; China 2014, India 2011, Indonesia 2012 to 2024-12), quarterly GDP (Argentina and Saudi Arabia missing; India from 2004), quarterly government debt (none).
4. Government debt and fiscal balance outside the EU rest on IMF WEO annual data, which ties to open question U2 (automated IMF access).
5. Stale series in the OECD dataflow: OECD core inflation for EU members ends 2025-12 (old HICP classification), headline CPI ends 2021-06 (Japan), 2024-07 (Mexico), 2025-01 (South Africa), 2025-07 (Saudi Arabia); Indonesia yield ends 2024-12. Eurostat is the current source for EU inflation.
6. Not tested: IMF monthly reserves (call timed out, see M14), IMF BOP and goods-trade dataflows, Comtrade, ILOSTAT, national sources, OECD output gap, the older Eurostat `prc_hicp_manr` (long history, ends 2025-12) as a way to extend core inflation back, and whether Eurostat values are seasonally adjusted for each country.
7. Request log for this pass (all HTTP GET): World Bank 4 (one per indicator, 42 countries, 1991-2026); Eurostat 10 full data calls plus about 14 small probes; ECB 3 (2 single-observation tests, 1 yield query); OECD 2 structure + 2 data (+ 3 failed attempts); IMF API 3 data calls (two WEO, one IRFCL, the last timed out); 3 page retries (OECD terms, ILOSTAT, ECB help) plus 1 ECB status page. At least 1.5 s between requests.

### F7. National or other free sources for emerging-economy gaps
| Country | Candidate original sources | Access finding |
|---|---|---|
| Brazil | Central bank time-series system (SGS); statistics institute IBGE (SIDRA); central-bank expectations survey (Focus) | SGS answers JSON without a key, 10-year windows, volume limits since 26 Mar 2025 [SEARCH]; Focus survey via the bank's Olinda interface [SEARCH]. IBGE interface [UNVERIFIED] |
| Mexico | INEGI indicators bank | API v2.0, free registration for a token, JSON/XML, open data statement [SEARCH https://inegi.org.mx/servicios/api_indicadores.html] |
| Türkiye | Eurostat (covered for industrial production, unemployment, HICP); central bank EVDS | EVDS needs a registered key; a new version (EVDS 3) went into beta in January 2026; cost statement not found [SEARCH] |
| Argentina | INDEC through the national time-series API apis.datos.gob.ar/series/api | Public API, no authentication reported; example IDs from third parties [SEARCH] |
| South Africa | Reserve Bank; Stats SA | No official programmatic interface found; a community package (Stellenbosch) mirrors both weekly [SEARCH]; fallback OECD |
| Saudi Arabia | GASTAT (monthly industrial production index); SAMA monthly bulletin | Publications are PDF/web pages; no API found; DBnomics SAMA mirror stale (2022) [VERIFIED-API]. BIS covers its policy rate, credit and exchange rates |
| India | MoSPI eSankhyiki portal (CPI, industrial production index, national accounts); Reserve Bank | Portal advertises APIs, rebased CPI (Feb 2026) and industrial index (planned May 2026) per a secondary summary; no key/registration statement found [SEARCH]; DBnomics MOSPI mirror stale (2022) [VERIFIED-API] |
| Indonesia | Statistics Indonesia WebAPI; Bank Indonesia | Free key by registration, JSON [SEARCH https://webapi.bps.go.id/]; Bank Indonesia not found |
| China | National Bureau of Statistics | No documented API found; DBnomics NBS provider has 3,150 datasets with annual tables indexed Jan-Mar 2026; monthly tables not confirmed [VERIFIED-API]. OECD publishes China CPI [VERIFIED-API] |
Terms and robots.txt of these national sites were not checked (open question 9).

### F8. Applying the user's free-only decisions to the flagged rows
| Row | Outcome |
|---|---|
| M03 | Core, survey part only: EC (EU27) + OECD (members and partners). Gaps listed in F5. The PMI part is dropped (S&P underlying data not free) |
| M20 equities | Dropped for now (U6) |
| M26 | Dropped (U3); M18 yield is the substitute |
| M25 | Still optional: EPU monthly download covers the US and about 20 countries; terms not retrieved [UNVERIFIED]; VIX series carry a CBOE copyright note on FRED. Not decided by the user: keep as optional or drop |
| A06 | No free machine-readable ratings source found. Rating agencies publish individual rating actions in press releases (access terms not verified; one secondary source says Fitch sovereign research needs a subscription [THIRD-PARTY https://globaledge.msu.edu/global-resources/resource/417]); some debt offices list agency ratings (e.g. Saudi debt management office [SEARCH https://ndmc.gov.sa/news-and-press-releases]); third-party history pages (theglobaleconomy.com) are not official. Recommendation: drop; an event log would be hand-maintained and uneven across 42 countries |
| Q14 | Stays optional: ECB Consumer Expectations Survey (monthly, euro area and 11 countries, aggregate results on the ECB data portal [SEARCH via Banque de France mirror]); Brazil Focus survey (central bank interface); EC surveys (EU) [UNVERIFIED price-expectation questions]; IMF firm-level inflation expectations dataflow ECFIE (coverage not tested). No free source for most of the 42 |
| A17 | B-READY published for 26 of 42 so far, 2024 (50 economies) and 2025 (52 economies) editions; Argentina, Australia, Brazil, China, India, Japan, Saudi Arabia and seven EU members are scheduled for 2026, South Africa 2027 [VERIFIED-PAGE https://www.worldbank.org/en/businessready/about-us/covered-economies]. It has no long time series, so alerts (20-year window) are impossible. The 2025 report is CC BY 3.0 IGO [SEARCH]. WEF indices not free. Recommendation: keep optional as an annual snapshot or drop |

### F9. BIS dataset list and coverage (17 Oct)
The bulk-download page lists 27 datasets, each as CSV, flat CSV and two SDMX formats [VERIFIED-PAGE https://data.bis.org/bulkdownload]. Dates shown there: Locational banking statistics, Consolidated banking statistics, Debt securities statistics, International debt securities, Credit to the non-financial sector, Credit-to-GDP gaps, Debt service ratios, Global liquidity indicators, Exchange traded derivatives (all 14 Sep 2026); OTC derivatives (15 May 2026); Triennial survey (15 Jun 2026); Selected residential property prices, Detailed residential property prices, Commercial property prices, Consumer prices index (24 Sep 2026); Bilateral exchange rates, Effective exchange rates, Central bank policy rates (15 Oct 2026); Central bank total assets (27 Aug 2026); seven payments datasets (27 Apr 2026).
Relevant to our rows:
- M17 policy rates: more than 40 central banks, daily and monthly, "most daily series start after 1980" [VERIFIED-PAGE https://data.bis.org/topics/CBPOL]. API series list: 49 areas including all non-euro panel countries except Bulgaria [VERIFIED-API].
- M15 real/nominal effective exchange rates: broad 64 economies from 1994, all 42 of ours [VERIFIED-PAGE + VERIFIED-API].
- M16 bilateral rates: about 190 economies monthly/quarterly/annual (from about 1957), about 80 daily [VERIFIED-PAGE https://data.bis.org/topics/XRU]; 191 areas in the API [VERIFIED-API].
- Q06 total credit: 44 economies from 1961 for gaps; total credit 48 areas; private non-financial sector average history over 45 years [VERIFIED-PAGE https://data.bis.org/topics/TOTAL_CREDIT; VERIFIED-API]. 32 of 42 in the panel.
- Q07 property prices: 61 areas in the selected dataset; the series list includes all EU27 and 13 of the 15 non-EU countries, not Argentina or Saudi Arabia [VERIFIED-API; keys only, observation counts untested].
- Q13 household debt and debt service ratios: inside the credit and debt-service datasets [UNVERIFIED country lists].

### F10. A11, A14, A22 and related annual rows
| Row | Source | Finding |
|---|---|---|
| A11 life expectancy | World Bank WDI series SP.DYN.LE00.IN (compiled from UN World Population Prospects, national statistics offices and Eurostat) | 42 of 42 countries have a 2024 value; database updated 2026-10-08 [VERIFIED-API 17 Oct]. WHO's older observatory interface was retired and a replacement interface is expected; not verified [SEARCH https://www.who.int/data/gho/legacy] |
| A14 inequality | World Bank poverty and inequality platform Gini through WDI (SI.POV.GINI) | 40 of 42 have a value in 2018-2025; Hungary and Saudi Arabia have none in that period [VERIFIED-API]. Latest years range 2020-2025. Income and consumption surveys mix. EU income survey (Eurostat) covers Hungary and the other EU members [UNVERIFIED not queried] |
| A22 participation and poverty | World Bank WDI series SL.TLF.CACT.ZS (labour force participation) | Value reported for all 42 [VERIFIED-API, summary only; whether values are modelled estimates is UNVERIFIED]. Poverty headcount at 3 dollars a day: test returned a value only for Indonesia in 2025, which only proves that 2025 is mostly empty; coverage by survey year not determined |
| A16 WGI | World Bank | expected all 42 [UNVERIFIED not queried] |
| A10 | UN World Population Prospects | edition not confirmed |

### F11. Agriculture and food rows (G03, G06, G07, G13, G14)
| Row | Free source found | Finding |
|---|---|---|
| G03 stocks-to-use | FAO Cereal Supply and Demand Brief (world, monthly, 10 releases per year: 6 Feb, 6 Mar, 3 Apr, 8 May, 5 Jun, 3 Jul, 4 Sep, 2 Oct, 6 Nov, 4 Dec 2026), Excel download csdb-data-2026-10.xlsx; current brief shows world cereal stocks-to-use 31.7% for 2026/27 [VERIFIED-PAGE https://www.fao.org/worldfoodsituation/csdb/en/]. AMIS Market Monitor covers wheat, maize, rice, soybeans (country summaries downloadable through its interactive site; documented API and terms not found) [SEARCH] | World aggregate only; the page keeps no archive, so each monthly file would have to be kept by us to have vintages. No licence on the page itself (FAO general terms CC BY 4.0). Per-country ratios: AMIS only |
| G06 weather and drought | FAO Agricultural Stress Index System: stress index, drought intensity, vegetation health, dekadal (every ten days), global 1 km grids from 1984, CC BY 4.0 plus FAO terms; access by map service, ArcGIS, downloads from Google Cloud Storage, Google Earth Engine on request to FAO [VERIFIED-PAGE https://eo.apps.fao.org/access.jsp]. A digital-goods registry lists a different licence (CC BY-NC-SA 3.0), which would still allow non-commercial use [SEARCH]. Copernicus ERA5 weather data need a free account and per-dataset licence acceptance [SEARCH] | Raster data, not country tables; country-level indicators exist in an ASIS tool but a downloadable country list was not found. Keep optional |
| G07 agricultural productivity | USDA ERS international agricultural productivity (index 2015=100, 1961-2023, updated 27 Jan 2026) [VERIFIED-PAGE 11 Oct] | No non-USDA alternative found; D13 allows USDA as a source |
| G13 grain supply gap | USDA ERS Global Food Assessment (regional/subregional, low- and middle-income focus) | Not a 42-country series; no free alternative. Recommend dropping or keeping purely informational |
| G14 10-year projections | OECD-FAO Agricultural Outlook database at agri-outlook.org (historical data plus 10-year projections, edition 2025-2034 published 15 Jul 2025) [SEARCH]. USDA baseline file last updated 28 Mar 2025 and reflects October 2024 [VERIFIED-PAGE 11 Oct] | OECD-FAO is current and preferred; country list and download format not verified |
| G04, G08-G10, G12, G15 | Comtrade (G04), FAOSTAT bulk files, FAO SOFI | as in F3 and Sources table |

### F12. Written question to the IMF (U2): draft and plan

Draft text for the user to send (the user chooses recipients and edits; suggested addresses from the IMF pages: datahelp@imf.org for API questions [VERIFIED-PAGE] and copyright@imf.org for permissions [VERIFIED-PAGE]):

> Subject: Question on automated access to IMF statistical data for a non-commercial research project
>
> Dear IMF Data Services team,
>
> I run a personal, strictly non-commercial project that tracks public macroeconomic indicators for the G20 economies and the EU member states. [Results are kept private / published only as non-commercial analysis - please choose.]
>
> The IMF Copyright and Terms page states that the IMF "prohibits bulk download of information by automated technology without explicit permission". I would like to ask whether the following use is permitted:
> 1. Scheduled, read-only requests, once a month, to the IMF data portal SDMX interface (api.imf.org) for a small number of dataflows (World Economic Outlook, including the output gap, growth, inflation, fiscal and debt series; possibly Primary Commodity Prices, International Reserves, Balance of Payments and Consumer Prices), covering about 45 economies, at roughly [N] requests per month, below the published limit of 10 requests per 5 seconds, with an identifying user agent and cached results.
> 2. Keeping each downloaded release as a dated copy so that revisions can be compared, with the attribution "Source: International Monetary Fund, [dataset name], [link]" and without altering the data.
> 3. Alternatively, whether a manual download of the published World Economic Outlook files twice a year, followed by local processing, is fine.
> Could you tell me whether permission is needed, under what conditions, and how it should be documented?
>
> Thank you, [name]

If the answer is no, or no reply within a period the user sets (suggest about 30 days, a researcher suggestion): 
1. Do not start any automated pull from the IMF.
2. Option A: user-initiated manual download of the published WEO files in April and October (a human action, to be confirmed in the IMF reply or not asked at all); ingest afterwards. This keeps A01, A03-A05 and the output gap but not the monthly dataflows.
3. Option B: replace IMF-only rows with other sources: forecasts and fiscal debt from Eurostat/OECD/World Bank (partial); current account from Eurostat/OECD; reserves from national central banks or the World Bank (annual); commodity prices from the World Bank Pink Sheet (already planned). The headline output gap (A02) has NO non-IMF equivalent for the 18 non-EU countries except OECD (coverage untested) and the EC series (EU27, UK, US), so D18 would have to be revisited by the user.
4. Do not route IMF series through a mirror to get around the clause: the IMF terms still apply to the data, and the mirrors for India and Saudi Arabia are stale anyway.

## Risks / unknowns

1. IMF automated access (U2) is the largest single dependency: A02, A03, parts of A04/A05, Q05 and M14.
2. OECD rate cap unresolved; OECD pages (rules, terms, member list) unreadable from my environment; a test CPI query returned only 17 areas for unknown reasons.
3. ECB data portal: unreachable (503) earlier on 17 Oct, reachable on a later retry (F13); no published rate limit found on the help pages. Intermittent availability is itself a risk for scheduled runs.
4. Output gap (A02) ranks 25 of 42 countries only; the ranking view will leave 17 empty.
5. The remaining coverage cells were filled in a later pass with a shell (F13). Open items: core inflation for 14 non-EU countries, IMF monthly reserves, and the many EU series that start after 1991. Earlier results in this note that were read through a summarising tool were not re-run, except those restated in F13.
6. Eurostat changed its inflation dataset (new classification) in 2026; other datasets may have moved too, so dataset codes in the 11 Oct note need rechecking before design.
7. National sources for China, Saudi Arabia, South Africa, India: no confirmed programmatic route; terms and robots rules of all national sites unchecked.
8. Mirror freshness (DBnomics) varies widely by provider.
9. WEO vintage: the October 2026 edition is already published, so the first stored vintage will be October 2026 (carried over).
10. Many re-estimation events break comparability (F4).

## Open questions for design

For the user:
1. Source routing (U5): is my reading right, that international compilers (Eurostat, ECB, BIS, IMF, OECD, World Bank, FAO) count as original sources and only DBnomics/FRED-type re-publishers count as aggregators? Under that reading only AMECO is fetched through an aggregator.
2. Will outputs be private or shared publicly? (affects FRED's "personal use" wording and the IMF question text.)
3. Do you want to update the approved indicator selection for U3/U6 (M03 survey-only, M20 and M26 dropped, A06 dropped) and for two proposals: drop A17 (no time series) and G13?
4. M25 (policy uncertainty and VIX): keep optional or drop?
5. How long to wait for the IMF reply before treating silence as "no"?
6. If the IMF says no: is a twice-yearly manual download of the WEO files acceptable, or should the output gap move to another source (D18 revisited)?
7. Is a hand-kept event log for sovereign ratings wanted at all, given that no free machine-readable source exists?
8. (Done in a later pass on 2026-10-17, see F13.) Do you want a further pass for the remaining gaps: core inflation outside the EU (national statistics offices, other OECD dataflows), IMF monthly reserves and BOP (only after the U2 answer), and the 1991 start of EU series through older Eurostat datasets?
9. Should national statistics sites (terms, robots.txt) be checked in the next pass?

For the design phase (questions only):
10. How to respect the OECD cap (60 vs 20 downloads/hour) with 42 countries: bulk files versus targeted queries and change detection (`UpdatedAfter`, `contentconstraint`).
11. Which source is authoritative when Eurostat, OECD and IMF publish the same series (CPI, GDP, unemployment), and how the source and release are recorded per observation.
12. How to store source re-estimation events (WGI 2.0, SOFI, BIS reclassification, HICP classification change) versus ordinary revisions.
13. How to flag "inherited" euro-area rows (policy rate, exchange rate) given Bulgaria's entry on 2026-01-01 and the 11 members without their own BIS policy-rate series.
14. How to treat the first run after the October 2026 WEO, and the dated WEO vintages already stored on the IMF API.
15. How a country with an indicator coverage of 25 of 42 (output gap) or 32 of 42 (credit gap) is shown in the coverage count n/N (D16).

## Sources cited
Accessed 2026-10-11 unless marked (17 Oct) = accessed 2026-10-17.
- Eurostat: API start page https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/api ; asynchronous API https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/asynchronous-api (17 Oct); copyright notice https://ec.europa.eu/eurostat/web/main/help/copyright-notice (17 Oct); live datasets sts_inpr_m, une_rt_m, prc_hicp_minr, prc_hicp_manr under https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ (17 Oct)
- IMF: terms https://www.imf.org/en/About/copyright-and-terms (17 Oct); data pages https://www.imf.org/external/Data.htm (17 Oct); API page https://data.imf.org/en/Resource-Pages/IMF-API (17 Oct); live API https://api.imf.org/external/sdmx/2.1/ (dataflow list, WEO NGAP_NPGDP and NGDP_RPCH, PI, CPI/IRFCL structures) (17 Oct); DataMapper https://www.imf.org/external/datamapper/api/v1/indicators (17 Oct); WEO page https://data.imf.org/en/datasets/IMF.RES:WEO ; rate limit snippet https://datahelp.imf.org/knowledgebase/articles/630877-api (search result, page unresolved)
- OECD (search snippets; pages 403): https://www.oecd.org/en/data/insights/data-explainers/2024/11/Api-best-practices-and-recommendations.html ; https://read.oecd-ilibrary.org/en/data/insights/data-explainers/2024/11/Api-best-practices-and-recommendations.html ; https://www.oecd.org/en/data/insights/data-explainers/2026/03/Restricted-API-parameter.html ; https://oecd.org/en/about/oecd-open-by-default-policy.html ; live API https://sdmx.oecd.org/public/rest/ (17 Oct)
- World Bank: https://data.worldbank.org/summary-terms-of-use (17 Oct); https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets (17 Oct); API https://api.worldbank.org/v2/ (SP.DYN.LE00.IN, SI.POV.GINI, SL.TLF.CACT.ZS, 17 Oct); B-READY https://www.worldbank.org/en/businessready/about-us/covered-economies (17 Oct); PIP blog https://blogs.worldbank.org/en/opendata/how-use-pips-api ; Pink Sheet https://www.worldbank.org/en/research/commodity-markets ; WGI https://reproducibility.worldbank.org/catalog/413
- BIS: https://data.bis.org/bulkdownload (17 Oct); https://data.bis.org/topics/EER , /CBPOL , /TOTAL_CREDIT , /XRU , /CREDIT_GAPS (17 Oct); API https://stats.bis.org/api/v2/ (17 Oct); terms https://data.bis.org/help/legal
- ECB: reuse policy https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html (17 Oct); disclaimer https://www.ecb.europa.eu/services/disclaimer/html/index.en.html (17 Oct); API help https://data.ecb.europa.eu/help/api/overview (503)
- FRED: https://fred.stlouisfed.org/docs/api/terms_of_use.html (snippet, 17 Oct); https://fred.stlouisfed.org/docs/api/fred/errors.html
- UN Comtrade: https://uncomtrade.org/docs/subscriptions/ (17 Oct); https://comtradedeveloper.un.org/
- ILOSTAT: https://webapps.ilo.org/ilostat-files/Documents/ILOSTAT_BulkDownload_Guidelines.pdf (snippet) ; https://ilostat.ilo.org/fr/about/dissemination-and-analysis (snippet)
- FAO: https://www.fao.org/worldfoodsituation/csdb/en/ (17 Oct); https://eo.apps.fao.org/access.jsp (17 Oct); https://www.fao.org/contact-us/terms/db-terms-of-use/en/ ; FFPI https://www.fao.org/worldfoodsituation/foodpricesindex/en/
- DBnomics: https://api.db.nomics.world/v22/providers , /datasets/NBS , /MOSPI , /SAMA , /EC , /AMECO , /series/AMECO/AVGDGP (17 Oct)
- EC surveys and AMECO: https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en (17 Oct); https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database_en
- National sources (search results, 17 Oct): https://inegi.org.mx/servicios/api_indicadores.html ; https://github.com/datosgobar/series-tiempo-ar-api ; https://webapi.bps.go.id/ ; https://dadosabertos.bcb.gov.br/ ; TCMB EVDS 3 news https://www.alomaliye.com/2026/01/26/tcmb-elektronik-veri-dagitim-sisteminin-yenilenmesine-iliskin-basin-duyurusu/ ; MoSPI portal summaries; GASTAT https://stats.gov.sa/en/w/news/179
- Other: UN WPP https://population.un.org/wpp/ ; Penn World Table https://www.rug.nl/ggdc/productivity/pwt/ ; WHO legacy GHO https://www.who.int/data/gho/legacy ; Fitch access (secondary) https://globaledge.msu.edu/global-resources/resource/417 ; Saudi debt office https://ndmc.gov.sa/news-and-press-releases ; Bulgaria euro https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260101~c830245e42.en.html
- Later pass 17 Oct (live): World Bank API indicators FI.RES.TOTL.CD, BN.CAB.XOKA.GD.ZS, GC.DOD.TOTL.GD.ZS, GC.NLD.TOTL.GD.ZS (https://api.worldbank.org/v2/, database updated 2026-10-08); Eurostat datasets sts_trtu_m, ei_bsco_m, ei_bsin_m_r2, prc_hicp_minr, namq_10_gdp, gov_10q_ggdebt, gov_10q_ggnfa, bop_c6_q, ext_st_27_2020msbec, irt_lt_mcby_m under https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ ; OECD https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_KEI@DF_KEI/ and https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL/ ; ECB https://data-api.ecb.europa.eu/service/data/IRS/ and https://data.ecb.europa.eu/help/api/overview ; IMF https://api.imf.org/external/sdmx/2.1/data/WEO/ and /IRFCL/ (all accessed 2026-10-17).
- Not retrievable on 17 Oct (updated after the later pass: OECD terms page still 403 with a bot challenge, ILOSTAT still 403; the ECB pages worked on retry): OECD web pages (403), ECB data portal and API (503), ILOSTAT pages (403), Comtrade terms (page did not load), DBnomics legal page (404), datahelp.imf.org (host did not resolve), UN WPP edition information.

## Glossary (abbreviations used)
WEO = IMF World Economic Outlook; HICP = Eurostat harmonised consumer price index; REER = real effective exchange rate; BIS = Bank for International Settlements; ECB = European Central Bank; OECD = Organisation for Economic Co-operation and Development; FAO = Food and Agriculture Organization; FFPI = FAO Food Price Index; SOFI = FAO State of Food Security report; WGI = World Governance Indicators; WDI = World Development Indicators; PIP = World Bank Poverty and Inequality Platform; AMECO = European Commission annual macroeconomic database; ASIS = FAO Agricultural Stress Index System; EPU = Economic Policy Uncertainty index; CLI = OECD composite leading indicator; D-numbers (D1-D19) = decisions in the indicator selection note; I/U/H = industrial production / unemployment / harmonised inflation; "inh" = inherits the euro-area policy rate.
