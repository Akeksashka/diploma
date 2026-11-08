---
status: draft
topic: Data sources for the forecasting amendment rows FT (forecast targets), N (new predictors) and B (benchmarks); coverage matrices for tiers F-A / F-B / F-C; vintages, licences, release timing
date: 2026-10-24
---
# Data sources for the FT / N / B rows (forecasting amendment, G20 ex Russia/AU + EU27)

Inputs (all `status: approved`): `docs/research/indicator-selection-g20-eu-forecasting-amendment.md` (FD1-FD11, rows FT01-FT12, N01-N15, B01-B10, research questions R1-R9), `docs/research/indicator-selection-g20-eu-cross-country.md` (D1-D23) and `docs/research/data-sources-g20-eu-cross-country.md` (the "base note"; not redone here, only extended; its F13 matrix is reused). Access date for every URL: 2026-10-24 unless another date is written.

## Question / scope

Which free sources can supply the official-forecast benchmarks (B), the new predictors (N) and the realised-target vintages (FT) for 42 countries plus EU27 and euro-area aggregates, and which countries can sit in tier F-A, F-B or F-C (FD3)? Answers the amendment's R1 to R9 as far as verifiable. Out of scope: architecture, schemas, code, model choice, alert thresholds. Rows not in FT/N/B are not covered.

Gate check: the three input documents are `status: approved`. I found no contradiction that blocks the work. Three points the user should know (none changes a decision):
1. The base indicator selection says in D10 that real-time backtesting is "not a requirement"; the amendment (FD5, FD6, R4) supersedes this for forecasting. I treated the amendment as governing.
2. D23 says IMF data is not pulled by automation. For this research I made 8 single, light, read-only GET requests to `api.imf.org` (one-off, by me, not scheduled) to read WEO coverage. I did not download any IMF file. If you consider this outside D23, tell me and I will not repeat it.
3. The amendment names "EU27 and euro area" as aggregates; the OECD Economic Outlook has a euro-area aggregate labelled EA17 and no EU27 code (F3). This is a coverage fact, not a conflict.

## Evidence labels and tool limits

- [VERIFIED-PAGE] stated on a primary page fetched today. [VERIFIED-API*] read from a live read-only response of an official interface, but through a summarising page fetcher (this session has no shell, so no script could parse raw responses; raw CSV/PDF/ZIP bodies were saved by the tool but could not be opened). Counts and lists may contain transcription slips; treat as strong evidence, not an audit. Cells marked * in matrices come from this route.
- [SEARCH] from a web-search snippet, not confirmed on the primary page. [THIRD-PARTY] non-official source. [UNVERIFIED] analyst background or not found.
- Request footprint today: about 16 OECD SDMX calls (structure and data, spaced out), 8 IMF API calls, about 12 DBnomics API calls, a few ECB and EC page fetches. ECB Data Portal and API returned HTTP 503 on all three tries today (also seen on 17 Oct in the base note); the ECB facts below therefore come from ECB web pages, DBnomics mirror metadata, and search results. One EC AMECO zip file (a guessed official download URL) was fetched once and left unopened.

## Sources assessed

| Source (rows) | Access | Coverage | Frequency | Revisions / vintages | Licence | Rate limits | Notes |
|---|---|---|---|---|---|---|---|
| IMF WEO (B01, FT02, FT05, FT09, FT10) | Manual entire-dataset Excel `WEOOct2026all.xlsx` and `WEOhistorical.xlsx` on the data portal [VERIFIED-PAGE https://data.imf.org/en/datasets/IMF.RES:WEO]. API `api.imf.org/external/sdmx/2.1` dataflow `WEO` (v9.0.0) plus dated `WEO_YYYY_MMM_VINTAGE` flows [VERIFIED-API*] | 15 non-EU panel countries: all six annual variables yes, unemployment (LUR) yes except Saudi Arabia (F2) | Apr and Oct (+ Jan/Jul updates without full database) | Dated vintage flows; historical-forecast workbook; archived pages back to Apr 1999 [VERIFIED-PAGE FAQ] | IMF terms (base note F2); D23 manual-only | 10 requests/5 s [SEARCH, base note] | Oct 2026 edition published 13 Oct 2026 |
| OECD Economic Outlook (B02, B10) | SDMX `sdmx.oecd.org/public/rest`, dataflow `OECD.ECO.MAD,DSD_EO@DF_EO` v1.5 = EO 119; vintage flows `DSD_EO_114` to `DSD_EO_118` [VERIFIED-API*] | 40 of 42 (no Cyprus, Malta); variable matrix in F3 | Two full editions a year + interim | Numbered edition flows 114-118 + current 119 | Open-by-default CC BY 4.0 for content from 1 Jul 2024; check per dataset [SEARCH, base note] | Conflicting: 60 or 20 downloads/hour (base note F3, still unresolved) | Interim Outlook (23 Sep 2026) carries G20 headline data, not a database flow |
| European Commission forecasts + AMECO (B03, B10, N11) | Report PDF with statistical annex; "Statistical annex database" on `webgate.ec.europa.eu/ecfin/redisstat/...FDMS_FORECAST` (JS data browser, no API found); AMECO zip (txt/csv/xlsx) and DBnomics mirror | EU27, 9 candidates incl. Turkiye, UK, US, Japan, China, India, EFTA, Russia per the edition page (variables per country not stated) [VERIFIED-PAGE] | Spring and Autumn full; winter and summer interim | AMECO zip archive Spring 2011 to Autumn 2025; annex archive Spring 2002 to Autumn 2014 [VERIFIED-PAGE] | AMECO "free of charge"; no licence text on page | none stated | Next full forecast: AMECO page says next update 17 Nov 2026 "with the Autumn 2026 Economic Forecast" [VERIFIED-PAGE] |
| ECB Macroeconomic Projection Database (B04, B10) | ECB Data Portal dataset `MPD`; Excel annex of latest round [VERIFIED-PAGE https://www.ecb.europa.eu/mopo/devel/ecana/html/table.en.html] | Euro area; country annual growth, inflation, unemployment in Jun/Dec Eurosystem rounds | Quarterly (Mar, Jun, Sep, Dec); latest 10 Sep 2026 | Vintages from Dec 2000 shown on the past-projections page | ECB reuse: free with source named, changes stated [VERIFIED-PAGE https://www.ecb.europa.eu/services/disclaimer/html/index.en.html] | Not stated; API 503 today | Vintage identifier appears as PD_ORIGIN codes in the DBnomics mirror [VERIFIED-API*], not decoded |
| ECB Survey of Professional Forecasters (B05, N07) | Data Portal (dataset `SPF`), zipped microdata CSV `SPF_individual_forecasts.zip`, HTML history tables [VERIFIED-PAGE https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/all_data.en.html] | Euro area | Quarterly (Jan/Apr/Jul/Oct); next 30 Oct 2026 (provisional) | Round-by-round; first round 1999 Q1 | ECB reuse terms as above; page itself gives none | not stated | Horizons: current year, next year, year after, 1y, 2y, 5y ahead [VERIFIED-PAGE table_hist_rgdp] |
| Other (detail in F6 to F11) | Fed SEP, Philadelphia Fed SPF and Real-Time Data Set, national central-bank surveys (Brazil, Mexico, Argentina, Turkiye, India), World Bank GEP/CMO, EIA STEO, CPB, Kiel, ECB CISS/CLIFS/BLS, Chicago Fed NFCI, Fed SLOOS | see sections | | | | | |

## Findings (each with citation: URL, access date 2026-10-24 unless stated)

### F1. Short answers to the research questions
- R2 (coverage): WEO covers the 15 non-EU countries for GDP, both inflation measures, current account, fiscal balance, debt and (except Saudi Arabia) unemployment; OECD EO 119 covers 40 of 42 countries with gaps listed in F3; the EC covers EU27 plus UK, US, Japan, China, India, Turkiye by its own statement, with no verified machine-readable data outside EU27 (F4). Tier proposal in F7.
- R4 (vintages): free real-time vintages exist for the euro area (ECB RTD), for US data (ALFRED, Philadelphia Fed), and for 36 of 42 areas in an OECD revisions dataflow (monthly editions Feb 1999 to Oct 2026), which is marked "NonProductionDataflow" (F9). Eurostat offers no vintage API [base note F4]. Therefore "first release vs mature" scoring (FD5) is feasible for a subset only; elsewhere it depends on the system's own captures from launch (D10).
- R5: CISS is ECB-produced (ECB reuse policy applies, inference); Chicago Fed NFCI on FRED is flagged "copyrighted" with a citation requirement and the Chicago Fed page states no terms (F11).
- R6: CPB and Kiel could not be fully verified (F11); EIA STEO and World Bank CMO are usable.
- R7: central-bank target table drafted, with verification level per row (F13).
- R9 / FD6: the one-off archive import is feasible from five archives (F12).

### F2. B01 IMF WEO: variables, coverage, vintages (R2, R8)
- API reads on 2026-10-24 [VERIFIED-API* https://api.imf.org/external/sdmx/2.1/data/WEO/...]: for the 15 non-EU panel countries (ARG AUS BRA CAN CHN IND IDN JPN MEX SAU ZAF KOR TUR GBR USA), indicators `NGDP_RPCH` (real GDP growth), `PCPIPCH` (inflation, average), `PCPIEPCH` (inflation, end of period), `BCA_NGDPD` (current account % GDP), `GGXCNL_NGDP` (net lending), `GGXWDG_NGDP` (gross debt) and `LUR` (unemployment) all returned observations for 2026 and 2027. Only exception: Saudi Arabia has no `LUR` series. Both inflation measures exist, which supports FT05 alignment.
- EU27: `LUR` 2026 and 2027 present for all 27. For `PCPIEPCH`, `BCA_NGDPD`, `GGXCNL_NGDP`, `GGXWDG_NGDP` a 2027 value was confirmed for 22 of 27 members; PRT (three of four), ROU, SVK, SVN, SWE were cut off by the fetcher and are unchecked. `NGDP_RPCH` and `PCPIPCH` for EU27 were not re-queried today; the base note (F6) saw growth/inflation/fiscal for 38 of 42 on 17 Oct. Residual gap: WEO EU27 rows partly [UNVERIFIED].
- Euro-area aggregate exists as `G163` with 2026/2027 values (seen for `BCA_NGDPD` and `PCPIPCH`); no EU aggregate code was seen [VERIFIED-API*].
- Latest-actual metadata differs from 2025 for India (fiscal-year labels FY2025/26, fiscal items FY2024/25), Japan and Korea (fiscal items 2024), South Africa (fiscal items FY2024/25) [VERIFIED-API*]. This confirms issue 23 (fiscal-year economies) of the amendment.
- Vintages: (a) dated dataflows, e.g. `WEO_2025_OCT_VINTAGE` carries annotation "Vintage for 2025-10-14" and origin `IMF.RES:WEO(9.0.0)` [VERIFIED-API* https://api.imf.org/external/sdmx/2.1/dataflow/IMF.RES/WEO_2025_OCT_VINTAGE]; (b) workbook `WEOhistorical.xlsx` described as "a comprehensive archive of the IMF's World Economic Outlook historical forecasts" [VERIFIED-PAGE https://data.imf.org/en/datasets/IMF.RES:WEO]; file exceeded the fetcher limit (10 MB), so variables, countries and first vintage are unverified; (c) the IMF FAQ says historical forecasts from the April 1990 WEO for "select key indicators" are in one Excel file and other indicators are in archived WEO database pages back to the April 1999 WEO [VERIFIED-PAGE https://data.imf.org/en/Datasets/WEO/Frequently-Asked-Questions]; (d) DBnomics mirrors `WEO:` editions 2008-04 to 2025-04 (2011-10 absent), provider indexed 2025-09-04, so the mirror is stale for 2025-10 and 2026 [VERIFIED-API* https://api.db.nomics.world/v22/providers/IMF]; (e) a third-party panel on Mendeley (published 15 Oct 2026) claims 41 WEO vintages 2006-09 to 2026-10, 200 economies, 17 variables incl. unemployment, outturns from later WEO releases, CC BY 4.0 on the author's organisation with IMF terms still applying [THIRD-PARTY https://data.mendeley.com/datasets/259h4x738v]. Route (e) is unreviewed; its use would be an aggregator question under U5/D23.
- January and July WEO updates: revised two-year real GDP growth for selected economies only, no full database [VERIFIED-PAGE FAQ]; consistent with FD7.
- Release: October 2026 report dated 13 Oct 2026 [VERIFIED-PAGE https://data.imf.org/en/datasets/IMF.RES:WEO]. data.imf.org maintenance 24 Oct 01:00 to 26 Oct 08:00 EST announced on the same page, so the portal may be unavailable for the next two days.

### F3. B02 OECD Economic Outlook 119: coverage matrix and vintages (R2)
- Dataflow `DSD_EO@DF_EO` v1.5 is titled "Economic Outlook 119" [VERIFIED-API* https://sdmx.oecd.org/public/rest/dataflow/OECD.ECO.MAD/DSD_EO@DF_EO/latest]. Same agency also holds `DSD_EO_114` to `DSD_EO_118` (each v1.0) and `DSD_EO_LTB` [VERIFIED-API* https://sdmx.oecd.org/public/rest/dataflow/OECD.ECO.MAD?detail=allstubs]. DBnomics labels the 119 flow's last update 3 Jun 2026 [VERIFIED-API*]; edition-to-month mapping (119 = June 2026) is inferred, not stated.
- Area list of the dataflow: 51 countries and 14 aggregates; our panel is present except Cyprus and Malta; EU27 is not a code; euro-area aggregate is `EA17` [VERIFIED-API* availableconstraint]. Russia is also present (irrelevant).
- Measure codes used (annual, projections for 2026 and 2027 tested): `GDPV_ANNPCT`; `CPI_YTYPCT` (national headline) or `CPIH_YTYPCT` (harmonised) for headline inflation; `PCORE_YTYPCT` or `PCOREH_YTYPCT` for core; `UNR`; `CBGDPR` (current account % GDP); `NLGQ` (government net lending % GDP); `GGFLQ` (general government gross financial liabilities % GDP) and `GGFLMQ` (Maastricht debt, EU members and UK). No NAIRU measure returned data (`NAIRU` query empty; whether another code exists is unverified). Whether CPI growth is annual average or end-period is not stated in what I read [UNVERIFIED].
- Matrix (all values for both 2026 and 2027 unless "-"; "H" = harmonised variant):

| Country | GDP | CPI | Core | UNR | CA | Net lending | Gross debt |
|---|---|---|---|---|---|---|---|
| Argentina | y | y | - | - | y | - | - |
| Australia | y | y | y | y | y | y | y |
| Brazil | y | y | - | y | y | - | - |
| Canada | y | y | y | y | y | y | y |
| China | y | y | - | - | y | y | - |
| India | y | y | - | - | y | - | - |
| Indonesia | y | y | - | - | y | - | - |
| Japan | y | y | y | y | y | y | y |
| Mexico | y | y | y | y | y | - | - |
| Saudi Arabia | y | y | - | - | y | - | - |
| South Africa | y | y | y | y | y | y | y |
| South Korea | y | y | y | y | y | y | y |
| Turkiye | y | y | y | y | y | y | - |
| United Kingdom | y | H | H | y | y | y | y (+Maastricht) |
| United States | y | y | y | y | y | y | y |
| Austria, Belgium, Estonia, Finland, France, Germany, Greece, Ireland, Italy, Latvia, Lithuania, Luxembourg, Netherlands, Portugal, Slovakia, Slovenia, Spain (17 euro members) | y | H | H | y | y | y | y (+Maastricht) |
| Croatia | y | H | H | y | y | y | y |
| Bulgaria, Romania | y | y | y | y | y | y | y |
| Czechia, Denmark, Hungary, Poland, Sweden | y | y | y | y | y | y | y |
| Cyprus, Malta | - | - | - | - | - | - | - |
| Euro area (EA17) | y | H | H | y | y | y | y |

  [VERIFIED-API* for every cell; the "gross debt" cell for Bulgaria, Croatia and Romania was seen in the GGFLQ query; Maastricht `GGFLMQ` also present for BGR, ROU, CZE, DNK, HUN, POL, SWE]. Counts: GDP 40, headline CPI 40, core 34, unemployment 35, current account 40, net lending 34, gross financial liabilities 32 of 42 (this last variable is not the Maastricht or WEO gross-debt definition).
- Vintages and archive: numbered flows 114 to 118 exist on the live API (editions published up to the period shown in DBnomics as late 2025) [VERIFIED-API*]. Earlier editions: oecd-ilibrary "datasetarchive" pages exist per year with per-edition databases (e.g. edition 91 data 1960-2013) and now redirect to oecd.org [VERIFIED-PAGE redirect + SEARCH]; access terms and file formats unverified, so pre-114 archive availability is [UNVERIFIED].
- Schedule: Interim Economic Outlook released 23 Sep 2026 and March 2026 interim on 26 Mar 2026 [SEARCH https://www.oecd.org/en/about/news/media-advisories/2026/09/oecd-to-release-interim-economic-outlook-on-wednesday-23-september-2026.html]; next full edition not found [UNVERIFIED, expected about early December].
- Terms: the OECD terms page is still unreadable here (HTTP 403 in the base note); base-note conflict on the rate limit stands. Today's OECD calls stayed well below even 20 per hour in any one hour except the burst of structure/data calls made during one period of about 40 minutes, which I flag as above the stricter figure; I will not repeat bulk calls.

### F4. B03 European Commission forecasts (R2)
- Edition page: Spring 2026 published 21 May 2026; statistical annex database link; per-country pages for EU27; candidate and other non-EU countries are sections of the PDF only; non-EU list: UK, US, Japan, China, EFTA, Russia, India; candidates incl. Turkiye [VERIFIED-PAGE https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/economic-forecasts/spring-2026-economic-forecast_en]. The EU key figures list unemployment and government balance; current account and debt appear in the text.
- "About" page: forecasts "focus on the EU, its member states and the euro area", cover at least two years and about 180 variables; two full forecasts (spring, autumn) and two interim (winter, summer) [VERIFIED-PAGE https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/economic-forecasts/about-economic-forecasts_en].
- Machine-readable route: AMECO. The annex tables are derived from AMECO and AMECO is refreshed only at full forecast releases [SEARCH]. AMECO unemployment (`ZUTN`) via DBnomics (indexed 2026-06-04) has 51 areas: all EU27, EA/EU aggregates, and of the 15 non-EU panel countries only Australia, Canada, Japan, Korea, Turkiye, UK, US [VERIFIED-API* https://api.db.nomics.world/v22/series/AMECO/ZUTN]. Net lending (`UBLGE`) and current account (`UBCA`) lists were truncated by the fetcher (first 100 of 131 and 150): GBR, JPN, AUS, CAN, KOR seen. China and India do not appear in AMECO unemployment, so their EC forecasts exist only inside the PDF [inference]. Whether AMECO forecast years (2026-2027) exist for Australia, Canada and Korea (historical OECD data) was not checked [UNVERIFIED].
- Archive: AMECO archive lists zipped text files from Spring 2011 (5 May 2011) to Autumn 2025; older vintages in the old Ameco Online; statistical-annex editions Spring 2002 to Autumn 2014 [VERIFIED-PAGE https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/ameco-archive_en and https://ec.europa.eu/economy_finance/db_indicators/statistical_annex/index_en.htm]. The listing has an odd date for Autumn 2025 (3 Jun 2025), likely a typo.
- Release: AMECO page: latest release note 3 June 2026, next update 17 Nov 2026 with the Autumn 2026 forecast [VERIFIED-PAGE https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database_en]. Autumn 2025 forecast was published 17 Nov 2025 [SEARCH]. The Commission's own forecast page does not state the autumn 2026 date.
- Terms: "AMECO data is made available free of charge"; no other terms on the page.
- Variable coverage per non-EU country (unemployment, current account, fiscal) cannot be stated; amendment B03 wording stays [UNVERIFIED] for those.

### F5. B04 ECB projections and B05 ECB SPF (R1, R9)
- Projections: published March, June, September, December; latest 10 Sep 2026; Excel annex and "database of past projections" linked [VERIFIED-PAGE https://www.ecb.europa.eu/pub/projections/html/index.en.html]. Database `MPD` on the Data Portal holds euro-area inflation (HICP) and real GDP growth annual and quarterly, annual other variables, country annual growth, inflation and unemployment for Jun/Dec rounds, global assumptions; vintage tables from Dec 2000; vintages identified by month/year and ECB-staff vs Eurosystem-staff, no release ID described [VERIFIED-PAGE https://www.ecb.europa.eu/mopo/devel/ecana/html/table.en.html]. Which euro area countries are in the country tables after Bulgaria's entry is unknown.
- SPF: since 1999 (first round 1999 Q1); four rounds per year in Jan, Apr, Jul, Oct; point forecasts and probability distributions for HICP, core HICP, real GDP growth, unemployment; also compensation per employee, oil, USD/EUR, refinancing rate; anonymised microdata each quarter [VERIFIED-PAGE https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/about_the_survey.en.html]; next release 30 Oct 2026 provisional [VERIFIED-PAGE index page]. ECB reuse terms apply (attribution, state modifications) [VERIFIED-PAGE disclaimer]. The DBnomics mirror lists dataset `SPF` and `MPD` (ECB provider indexed 2026-10-17) [VERIFIED-API*], but the shared rule U5 (use the original) points to the ECB itself; the ECB API was down today (503), so access via API was not re-tested.

### F6. B06 national central-bank forecasts, B07 World Bank, B08 nowcasts (R1)
| Row | Finding | Label |
|---|---|---|
| Fed SEP (B06) | SEP meetings 2026: 17-18 Mar, 16-17 Jun, 15-16 Sep, 8-9 Dec; materials are PDF/HTML; a CSV/historical download is not stated on the calendar page | [VERIFIED-PAGE https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm] |
| BoE (B06) | Past Inflation Reports published Excel chart data and fan-chart workbooks per round; the Bank publishes distribution parameters, not quantiles; current location unverified | [SEARCH] |
| Bank of Canada, Bank of Japan (B06) | Bank of Canada has a staff economic projections page; BoJ launched a free keyless API for its time-series search on 18 Feb 2026 (covers Tankan); projection tables not checked | [SEARCH https://www.bankofcanada.ca/rates/staff-economic-projections/; https://www.boj.or.jp/en/statistics/outline/notice_2026/not260218a.htm] |
| Brazil Focus (B06 substitute, F-C) | Olinda API endpoints for annual, monthly, quarterly expectations, Selic, 12 and 24-month inflation; statistics computed daily, published each week; start year and stored snapshots not stated; ODbL licence | [VERIFIED-PAGE https://dadosabertos.bcb.gov.br/dataset/expectativas-mercado] |
| Argentina REM | Monthly BCRA report of outside analysts' forecasts (inflation, rates, FX, trade, fiscal, unemployment, activity); latest August 2026 report published 4 Sep 2026, 47 participants; series download page and licence not found | [SEARCH https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-ago-2026.pdf] |
| Mexico Banxico survey | Monthly survey of about 45 private groups; API series ids/token not confirmed | [SEARCH] |
| Turkiye CBRT Survey of Market Participants | Time series published in EVDS (registered key; EVDS 3 beta since Jan 2026) | [SEARCH https://tcmb.gov.tr/wps/wcm/connect/en/tcmb+en/main+menu/statistics/tendency+surveys/survey+of+market+participants] |
| India RBI Survey of Professional Forecasters | Since Sept 2007, bimonthly now; 94th round May 2025 had 46 panellists; GDP and CPI on fiscal-year basis | [SEARCH https://website.rbi.org.in/web/rbi/-/publications/survey-of-professional-forecasters-on-macroeconomic-indicators-results-of-the-94th-round] |
| US Philadelphia Fed SPF (B05-type for US) | Since 1968, quarterly (Q3 2026 in Aug 2026), mean/median/dispersion and individual forecasts, probability variables incl. probability of negative GDP growth; terms not stated | [VERIFIED-PAGE https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/survey-of-professional-forecasters] |
| World Bank GEP (B07) | Data Catalog entry: bulk Excel and CSV, API, Databank; temporal coverage 2023-2027, annual, national; version 14, metadata 14 Jan 2026; report CC BY 3.0 IGO; dataset licence not confirmed; January and June editions [UNVERIFIED]; country list not seen | [SEARCH https://datacatalog.worldbank.org/search/dataset/0037888/global-economic-prospects] |
| GDPNow (B08) | FRED series `GDPNOW` begins 2011-07-01; the last forecast before the BEA advance estimate is kept as the historical value; no fixed calendar; ALFRED availability unconfirmed | [SEARCH https://fred.stlouisfed.org/data/GDPNOW] |
| NY Fed Staff Nowcast (B08) | Updated Fridays 11:15; archived when BEA first estimate arrives; historical reconstruction 2002-2015 published; GitHub snapshot; the official page did not render | [SEARCH https://libertystreeteconomics.newyorkfed.org/2019/07/just-released-historical-reconstruction-of-the-new-york-fed-staff-nowcast-2002-15] |

Nowcast products for non-US countries: none identified (amendment exclusion stands).

### F7. Coverage matrix and proposed tier membership (R2, FD3)
Rule used (researcher proposal; thresholds are for the user to confirm). Four data criteria decide model depth: C1 quarterly real GDP in the tested sources starting in 1996 or earlier (base note F13); C2 monthly industrial production in Eurostat or OECD revisions flow; C3 monthly unemployment in Eurostat or the OECD revisions flow; C4 a monthly survey indicator (EC survey or OECD confidence composite). F-A = C1 to C4 all pass; F-B = C1 and C2 pass and at least one of C3, C4; F-C = otherwise. Evaluation-depth columns (not part of the rule): V = present in the OECD revisions flow (pseudo-real-time possible); EO = OECD EO 119 has GDP, CPI and unemployment; WEO = all (see F2); ECf = named in the EC forecast page. Seasonal adjustment of non-EU quarterly GDP is [UNVERIFIED] for every non-EU row (Eurostat `namq_10_gdp` SCA is verified for EU members and Turkiye in the base note). "n" means not found in the sources I tested, not proof of absence; national sources (F13 of base note, F7 there) were not tested.

| Country | C1 Q GDP start | C2 IP m | C3 UNR m | C4 survey | V | EO (GDP/CPI/UNR) | ECf | National forecaster survey | Proposed tier |
|---|---|---|---|---|---|---|---|---|---|
| Argentina | n | n | n | n (INDEC ETN exists [SEARCH]) | n | y/y/n | no | REM | F-C |
| Australia | 1991 | n | y | y | y | y/y/y | no | n | F-B |
| Brazil | 1996 | y | n | y | y | y/y/y | no | Focus | F-B |
| Canada | 1991 | y | y | n | y | y/y/y | no | n | F-B |
| China | 1993 | y | n | y | y | y/y/n | yes (PDF) | n | F-B |
| India | 2004 | n | n | n | n* (area listed, no IP) | y/y/n | yes (PDF) | RBI SPF | F-C |
| Indonesia | 1991 | y | n | y | y | y/y/n | no | n | F-B |
| Japan | 1994 | y | y | y | y | y/y/y | yes | n | F-A |
| Mexico | 1991 | y | y | y | y | y/y/y | no | Banxico | F-A |
| Saudi Arabia | n | n | n | n | n | y/y/n | no | n | F-C |
| South Africa | 1991 | y | n | n | y | y/y/y | no | n | F-B |
| South Korea | 1991 | y | y | y | y | y/y/y | no | n | F-A |
| Turkiye | 1995 | y | y | y | y | y/y/y | yes | CBRT survey | F-A (see note) |
| United Kingdom | 1991 | y | y | y | y | y/y/y | yes | n | F-A |
| United States | 1991 | y | y | y | y | y/y/y | yes | Philly SPF | F-A |
| Austria, Belgium, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Netherlands, Poland, Portugal, Slovakia, Slovenia, Spain, Sweden (22) | 1991-1996 | y | y | y | y | y/y/y | yes | none (ECB SPF euro area only) | F-A |
| Bulgaria, Croatia, Cyprus, Romania | 1995-1996 | y | y | y | n | BGR,HRV,ROU y/y/y; CYP n | yes | none | F-A |
| Malta | 2000 | y | y | y | n | n | yes | none | F-B (C1 fails by start year 2000) |
| Euro area, EU27 | Eurostat | y | y | y | EA20 yes in flow | EA17 y/y/y; EU27 n | yes | ECB SPF, ECB projections | F-A |

  Basis: C1 from the base note F13 (Quarterly GDP column); C2 and V from the OECD revisions flow query for edition 202610 (monthly industrial production `PRVM` listed for BRA CAN CHN COL..., not for AUS, IND; ARG and SAU not in the result) [VERIFIED-API*] and Eurostat `sts_inpr_m` for EU27 and Turkiye (base note M01); C3 from Eurostat `une_rt_m` and the same flow (`UNEMP` present for AUS CAN GBR JPN KOR MEX TUR USA and EU members, absent for BRA CHN IDN IND ZAF) [VERIFIED-API*]; C4 from base note F13 (Consumer conf. column) and F5 rows M03/M04; EO from F3; ECf from F4.
  Notes: (1) Turkiye and Mexico pass the data rule; the amendment's text suggested placing Turkiye and Mexico (and Brazil, South Africa) in the benchmark-led group, and extreme inflation (issue 28) may justify the user overriding the rule for Turkiye. (2) Canada and Australia are amendment F-A candidates but fail by tested sources (no survey for Canada, no monthly IP for Australia in the tested flows); national sources (Statistics Canada, ABS, Bank of Canada surveys) are untested, so the two are provisional F-B. (3) China and Indonesia land in F-B by the rule while the amendment listed them among thin-coverage countries; they lack a monthly unemployment rate and their quarterly GDP SA status is unverified. (4) Tier counts under the rule: F-A 32 countries (22 + 4 + JPN MEX KOR TUR GBR USA) plus 2 aggregates; F-B 7 (AUS BRA CAN CHN IDN ZAF MLT); F-C 3 (ARG IND SAU). Numbers are a consequence of the thresholds; changing C1's start year or dropping C3 would move rows.
  Official-benchmark depth by country is in F2 (WEO: all), F3 (EO: 40 of 42, unemployment 35 of 42) and F4 (EC: EU27 plus UK, US, Japan, Turkiye machine-readable; China, India PDF only).

### F8. Unemployment and fiscal forecast availability summary (R2)
| Variable | WEO | OECD EO 119 | EC |
|---|---|---|---|
| Unemployment | 41 of 42 (not Saudi Arabia); EU27 verified for all 27 | 35 of 42 (not ARG CHN IDN IND SAU, CYP, MLT) | EU27 and EA; others unverified |
| Current account | all 15 non-EU; EU27 22+ verified | 40 | EU stated in text; non-EU unverified |
| Net lending | all 15 non-EU | 34 (not ARG BRA IND IDN SAU MEX, CYP, MLT) | EU key figure |
| Gross debt | all 15 non-EU | 32 on a financial-liabilities basis; Maastricht only EU members + UK | EU in text |
All WEO cells for 2026 and 2027, [VERIFIED-API*], 24 Oct 2026.

### F9. Vintages for realised targets: first release vs mature (R4)
| Source | What it holds | Coverage | Status |
|---|---|---|---|
| OECD `DSD_STES_REVISIONS@DF_STES_REVISIONS` v4.0 | "Monthly snapshots of published short-term economic statistics ... for testing forecasting models in simulated real time"; EDITION dimension (YYYYMM) first 199902, last 202610; dimensions REF_AREA, FREQ, MEASURE, UNIT_MEASURE, ACTIVITY, EDITION [VERIFIED-API*] | 58 area codes; of our 42: all except Bulgaria, Croatia, Cyprus, Malta, Romania, Saudi Arabia (36) plus EA/EU aggregates; 22 measures incl. quarterly GDP volume (`B1GQ_Q`), current-price GDP, deflator, CPI (`CP`), unemployment (`UNEMP`), industrial production (`PRVM`), retail volume (`TOVM`) | Annotated `NonProductionDataflow = true`; edition 202610 monthly CPI present for only a subset (BRA CAN CHN DEU GBR IDN IND KOR USA among panel); `B1GQ_Q` seen for most EU, JPN, KOR, MEX, ZAF, TUR, USA, GBR, CAN, AUS, BRA, IDN (fetcher truncated, ARG and CHN not seen); India shows no volume series. The predecessor Original Release Data and Revisions Database has monthly and quarterly vintages from Jan 1999 [SEARCH]; a Dallas Fed rebuild covers 26 OECD countries 1962-1998 [SEARCH]. Unresolved: whether `NonProductionDataflow` means unstable or unsupported |
| ECB Real-Time Database (dataflow `RTD`) | Euro-area vintages from the Economic Bulletin; updated semi-annually (January, July); API vintages from 2015, files for Jan 2001 to Dec 2014; labelled experimental [SEARCH https://data.ecb.europa.eu/data/datasets/RTD/data-information]. 278 series on the DBnomics mirror (indexed 2026-10-01) [VERIFIED-API*] | Euro area | ECB portal 503 today; EABCN page says its own RTDB is not currently available [SEARCH] |
| ALFRED / FRED | Real-time vintages; Canada search returns 7,815 series, IMF 21,038 series [SEARCH]; NFCI has an ALFRED vintage series [VERIFIED-PAGE https://fred.stlouisfed.org/series/NFCI] | US mainly; others partial and only from FRED's own capture start | Per-series check needed |
| Philadelphia Fed Real-Time Data Set for Macroeconomists | US vintages, updated end of each month; first-, second-, third-release values downloads; start year not confirmed | US | [VERIFIED-PAGE https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/real-time-data-set-for-macroeconomists] |
| Statistics Canada real-time tables | Revision history of 19 series, vintages since Jan 2015, released about one week after source tables | Canada | [SEARCH https://www.statcan.gc.ca/eng/dai/btd/rct] |
| IMF API vintage flows for CPI, PI, QNEA etc. | Dated vintage dataflows (base note F4) | many | Blocked by D23 for automation |
| Eurostat | Only `updated` timestamp | EU27 | No vintage route [base note F4] |
Consequence for FD5: first-release vs mature scoring can be built historically for US, euro area (partly) and the OECD-flow areas; for Bulgaria, Croatia, Cyprus, Malta, Romania, Saudi Arabia and all non-OECD-flow measures, only the system's own captures from launch (D10) will serve. Revision magnitudes were not measured here.

### F10. Release timing and lags (R3, N15)
| Item | Finding | Label |
|---|---|---|
| Euro-area GDP | Preliminary flash about 30 days after quarter end (Q3 2026 flash on 30 Oct 2026), GDP-and-employment flash about 45 days (13 Nov 2026), full release later (Q2 2026 flash 14 Aug, full 7 Sep 2026, GDP revised from 0.4% to 0.6%) | [SEARCH https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-07092026-ap] |
| Euro-area HICP | Flash for September on 2 Oct 2026, full release 16 Oct; October flash scheduled 4 Nov 2026 | [SEARCH https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-16102026-ap] |
| EC surveys (N01) | Next release 29 Oct 2026 (ESI, EEI, EUI, sector indicators); flash consumer confidence 22 Oct 2026; 2026 schedule is a PDF (unreadable to the fetcher) | [VERIFIED-PAGE https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en] |
| ECB SPF / projections / BLS | SPF 30 Oct 2026 (provisional); projections Dec; BLS usually January, April, July, October, latest 21 Jul 2026 | [VERIFIED-PAGE] |
| EC forecast | Autumn 2026 with AMECO update on 17 Nov 2026 | [VERIFIED-PAGE AMECO page] |
| WEO | 13 Oct 2026; next April 2027 [UNVERIFIED date] | [VERIFIED-PAGE] |
| EIA STEO | Next 10 Nov 2026 | [VERIFIED-PAGE https://www.eia.gov/outlooks/steo/] |
| World Bank | Pink Sheet next 3 Nov 2026; CMO April and October | [VERIFIED-PAGE https://www.worldbank.org/en/research/commodity-markets] |
| NFCI | Weekly, Wednesdays 8:30 ET, data to the previous Friday; history can change week to week; next 28 Oct 2026 | [VERIFIED-PAGE https://www.chicagofed.org/research/data/nfci/current-data; FRED] |
| CPB World Trade Monitor | About eight weeks after the reporting month (June 2024 data published 23 Aug 2024; Aug 2026 press report dated 25 Aug for June) | [VERIFIED-PAGE https://www.cpb.nl/en/release-date-next-world-trade-monitor-41, 2024 page; SEARCH] |
| Country GDP lags for non-euro countries, OECD CLI, Eurostat monthly IP/unemployment | Not established in this pass | [UNVERIFIED] |
First-release timestamps (N15): Eurostat exposes `updated` only (base note); the OECD revisions flow gives monthly editions (a publication date per edition month, not per observation); no source tested stamps individual observations.

### F11. N rows: sources, terms, feasibility (R5, R6)
| Row | Source and route | Coverage and frequency | Terms and vintages | Feasible free (FD4) |
|---|---|---|---|---|
| N01 EC BCS detail | Download pages: press releases, time series, subsector data, new data browser `webgate.ec.europa.eu/ecfin/redisstat/databrowser/explore/all/BCS`; Eurostat `ei_bsco_m`, `ei_bsin_m_r2` (base note) | EU27 + applicants, monthly | No licence text on page; no vintages known | yes |
| N02 financial stress | ECB CISS dataset: DBnomics mirror lists 60 series, euro area (16 daily, 2 monthly), US (2 daily), China (1 daily), UK, Germany, France and 8 other euro members, 5 non-euro EU members (monthly sovereign), not Japan [VERIFIED-API*]; portal says euro area and US updated weekly on Monday [SEARCH]. ECB CLIFS: 28 monthly series, EU27 + UK [VERIFIED-API*]. ECB catalogue also lists a "Macro-Finance Financial Condition Index" (`CMT`), not examined [VERIFIED-API*]. Chicago Fed NFCI weekly, copyrighted on FRED, ALFRED vintage series | CISS: ECB reuse policy applies (inference); NFCI: Chicago Fed page states no terms, FRED warns "copyrighted ... review the copyright information in the series notes" [VERIFIED-PAGE] | CISS/CLIFS yes; NFCI needs a terms check [R5] |
| N03 yield-curve slope | Derived from M18/M19, not re-assessed | | | depends on M19 (base note: 3m rate OECD+ only) |
| N04 lending surveys | ECB BLS: quarterly since 2003, all euro area national central banks' results on the Data Portal [VERIFIED-PAGE https://www.ecb.europa.eu/stats/ecb_surveys/bank_lending_survey/html/index.en.html]; Fed SLOOS: since 1997, via FRED or XML zip; the Fed's Data Download Program is being retired (the "Build Your Package" feature removed the week of 9 Nov) [VERIFIED-PAGE https://www.federalreserve.gov/data/sloos.htm] | Euro area by country; US only | Reuse terms not stated for SLOOS | yes (two regions only) |
| N05 import prices, N06 wages | Not assessed individually. ECB catalogue lists `INW` (negotiated wage rates), `EWT` (wage tracker), `LCI` (labour cost indices), Eurostat labour-cost index [VERIFIED-API* dataset list on DBnomics ECB provider] | | | [UNVERIFIED] |
| N07 inflation expectations | ECB Consumer Expectations Survey dataset `CES` exists [VERIFIED-API* list]; SPF (F5); EC BCS price expectations (N01); national surveys in F6 | | | EA, Brazil, Mexico, Argentina, Turkiye, India, US yes; else no |
| N08 trade | CPB World Trade Monitor: lag about eight weeks; the CPB data page returned 404, so download format and terms are unverified. Kiel Trade Indicator: updated about the 5th of each month, 75 countries and regions, AI on ship movements; page flagged "algorithm being improved, irregular updates"; licence not found [SEARCH https://ifw-kiel.de/index.php?id=10] | Global, regions | [UNVERIFIED] terms | CPB probable; Kiel unclear (R6 open) |
| N10 vacancies, claims | ECB catalogue lists `JVS`/`JVC` job vacancies; US claims not assessed | | | [UNVERIFIED] |
| N11 slack gap | AMECO NAWRU not confirmed on the AMECO page (variables list is a separate xlsx); OECD EO 119: query for `NAIRU` returned nothing (no structural unemployment confirmed) [VERIFIED-API*] | | | EU27 AMECO probable, OECD unproven |
| N14 outlooks | EIA STEO: monthly, tables in Excel, archive of past issues as PDF and one Excel data file per release; API requires a free key; the Data.gov metadata marks the licence "Public Domain" (catalog metadata, not EIA's notice) [SEARCH https://catalog.data.gov/dataset/short-term-energy-outlook-u-s-economy-application-programming-interface-api]. World Bank CMO April and October, price forecasts in a separate PDF, monthly and annual price Excel; the licence link URL contains "cc-by" but the type is not stated [VERIFIED-PAGE] | | | yes |
| N09, N12, N13, N15 | derived or metadata (N15 see F10) | | | follow their inputs |

### F12. B10 and FD6: archives for the one-off benchmark import (R9)
| Archive | Content and period | Access and format | Open points |
|---|---|---|---|
| IMF | `WEOhistorical.xlsx` (workbook of historical WEO forecasts); archived database pages since Apr 1999; April 1990 key indicators file; API vintage flows | Manual downloads allowed by D23 and FD6; the workbook is over 10 MB, structure unread | Variables, countries, first vintage unverified; third-party sources say vintage labels in the workbook are only Spring/Fall |
| OECD | Live API editions 114 to 118 (+119 current); earlier editions in an older archive | SDMX CSV/JSON | Edition publication dates are not in the flow metadata; pre-114 access unverified |
| European Commission | AMECO zip archive Spring 2011 to Autumn 2025; annex PDFs Spring 2002 to Autumn 2014 | zip txt/csv/xlsx; PDF | Forecast vs outturn columns inside each AMECO release not examined; cut-off dates per edition not read |
| ECB projections | Vintages from Dec 2000 | Data Portal `MPD` (API down today) | Country coverage per vintage; vintage identifiers |
| ECB SPF | 1999 Q1 onward | CSV zip, HTML tables | none |
| Philadelphia Fed SPF | 1968 onward | Excel downloads | terms not stated |
All of this is benchmark forecast data only, as FD6 requires. Imported rows would carry source edition dates; edition dates are explicit for ECB (month), EC (Spring/Autumn year), IMF (April/October) and implicit for OECD (edition number).

### F13. R1 national surveys as PMI substitutes, and R7 inflation-target metadata

R1 substitutes (candidates; none tested end to end; the base note F13 already holds OECD/EC confidence coverage):
| Country gap (base note) | Free official candidate | Label |
|---|---|---|
| Japan business | BoJ Tankan via the BoJ keyless API (launched 18 Feb 2026) | [SEARCH] |
| Korea | Bank of Korea BSI/CSI via ECOS; free key; rate limit 1,000 calls/day unconfirmed | [SEARCH, THIRD-PARTY] |
| India | RBI Consumer Confidence Survey, Industrial Outlook Survey, Services and Infrastructure Outlook Survey; press releases; DBIE path unconfirmed | [SEARCH] |
| Indonesia | Bank Indonesia Consumer Survey (monthly, Sept 2026 release seen), Prompt Manufacturing Index (quarterly); official download page not found | [SEARCH] |
| Argentina | INDEC Encuesta de Tendencia de Negocios (industry confidence indicator Jul-Sep 2026 reported; spreadsheet for supermarkets/wholesale at `gob.ar/ftp/cuadros/economia/serie_etn_sam.xlsx`); consumer confidence from a university not verified | [SEARCH] |
| Mexico | INEGI business and consumer confidence indicators (OECD already supplies consumer from 2001); API route not confirmed | [SEARCH] |
| China | NBS official manufacturing/non-manufacturing PMI (large and state firms, month-end); free access and terms not verified; Caixin/S&P is the paid one (D20) | [SEARCH] |
| South Africa | RMB/BER Business Confidence Index (quarterly; free media releases; full data access unconfirmed); no free monthly | [SEARCH] |
| Canada, Australia, Saudi Arabia | Nothing verified (Bank of Canada Business Outlook Survey exists [UNVERIFIED]); Saudi PMI is S&P (paid) | [UNVERIFIED] |
| Turkiye | CBRT sectoral/real-sector confidence in EVDS | [UNVERIFIED] |
Substitutes are survey diffusion indices with different definitions; cross-country levels are not comparable (issue 27).

R7 inflation-target metadata (FT12). Verification level per row; none was read from the central bank's own page except where stated; effective-date histories were not collected.
| Economy | Target (as found) | Label |
|---|---|---|
| Euro area (21 members) | 2% HICP, medium-term | [UNVERIFIED] (background) |
| Czechia, Poland, Hungary, Romania | CNB 2% +/-1; NBP 2.5% +/-1 (band 1.5-3.5); MNB 3% +/-1; BNR 2.5% +/-1 (Romania not confirmed, the one result gave an older 3% +/-1) | [SEARCH, 2018-2024 analyst notes] |
| Sweden | CPIF 2%; Riksbank page: the variation band is used since Sept 2017 and is not a target interval; 2026 status not checked | [SEARCH https://www.riksbank.se/en-gb/monetary-policy/the-inflation-target/] |
| Denmark, Bulgaria | Denmark fixed exchange rate to the euro, no inflation target; Bulgaria joined the euro 1 Jan 2026 (base note F1) | [UNVERIFIED] for Denmark |
| United States, UK, Japan, Korea | 2% (PCE, CPI, CPI, CPI) | [UNVERIFIED] (background) |
| Canada | 2% CPI, midpoint of 1-3 band; framework renewal in 2026, Governor Macklem said the target stays | [SEARCH https://www.investmentexecutive.com/news/research-and-markets/bank-of-canada-inflation-target-wont-change-in-2026-mandate-review-macklem/] |
| Australia | 2-3% CPI | [UNVERIFIED] |
| Brazil | 3% with +/-1.5 pp tolerance; continuous target since 2025, assessed on 12-month IPCA, "lost" after six consecutive months outside the band; the CMN 2024 resolution text was not read | [SEARCH] |
| Mexico | 3% +/-1 | [UNVERIFIED] |
| India | 4% +/-2 CPI; framework review due by March 2026, outcome not confirmed (reports expected retention) | [SEARCH] |
| South Africa | 3% with +/-1 pp tolerance, announced 12 Nov 2025 by the Finance Minister and the SARB Governor, replaces the 3-6% range, implemented over two years; headline CPI | [SEARCH https://www.treasury.gov.za/comm_media/press/2025/2025111201 Announcement of the new inflation target for South Africa.pdf] |
| Turkiye | Interim targets raised on 14 May 2026 to 24% (2026), 15% (2027), 9% (2028); medium-term 5%; end-2026 forecast 26% | [SEARCH https://www.centralbanking.com/central-banks/monetary-policy/7975894/turkey-raises-inflation-target-to-24-citing-war-risks] |
| Indonesia | 2.5% +/-1 [UNVERIFIED: search found nothing] | [UNVERIFIED] |
| Argentina | No conventional inflation target; 2026 framework controls the monetary base with an exchange-rate band adjusted monthly by INDEC inflation | [SEARCH https://www.bcra.gob.ar/en/news/objectives-and-plans-2026/] |
| Saudi Arabia, China | Saudi: riyal peg, no inflation target [UNVERIFIED]; China: no central-bank numeric target; the annual government work-report CPI goal is not sourced | [UNVERIFIED] |
Under this table FT12 has a numeric target for roughly 30 economies and none for Argentina, Saudi Arabia, China (and Denmark); five rows rely on background only.

## User responses to the hand-back questions (2026-10-24)

1. Tier rule thresholds and provisional F-B for Canada and Australia: user answered "yes". Whether Türkiye and Mexico are overridden to F-C is not clear from that answer; pending clarification.
2. One-off benchmark archive import: from IMF files only for now (D23). The Mendeley panel and the DBnomics WEO mirror are not used as stand-ins.
3. Scripted verification pass of the OECD, WEO and revisions matrices: no. Matrix figures remain unverified by script.
4. Follow-up on untested items (national survey APIs and terms, Canada and Australia, non-euro GDP release lags, N05, N06, N10, N11): no. They stay open.

This section records answers only; the note is still `status: draft`.

## Risks / unknowns

1. All matrices come through a summarising fetcher; a scripted check (one pass with a shell) of the OECD EO, WEO and revisions flows would remove transcription risk. The raw responses were saved by the tool but could not be opened.
2. ECB Data Portal and API were down (503) today and on 17 Oct: B04, B05, N02, N04 and ECB RTD could not be tested live, and the service has been intermittent twice.
3. OECD terms and rate limit remain unreadable (403/bot challenge); today's calls were many in a short period (F3).
4. IMF: WEO Oct 2026 files are manual (D23); DBnomics stops at 2025-04; third-party Mendeley panel is not reviewed.
5. EC: no API for forecast tables; China and India EC forecasts are PDF only; autumn 2026 date only inferable from AMECO's 17 Nov note.
6. Vintages: OECD revisions flow is non-production; CP monthly coverage in it is sparse; the whole first-release-versus-mature plan beyond US and euro area rests on the system's own capture from launch.
7. Quarterly SA GDP for non-EU countries is unverified, so tier rule C1 is only a start-year test for 15 countries.
8. Targets in F13 (R7) are mostly search-level; changes in 2026 (India review, Canada renewal, Sweden, Romania, Indonesia, Mexico) are unconfirmed.
9. National-office surveys and release lags for non-euro countries were not tested.

## Open questions for design

For the user:
1. Confirm or change the tier rule (F7): C1 start-year threshold (1996), whether C3 (monthly unemployment) should be mandatory for F-A, and whether Turkiye and Mexico go to F-A or to benchmark-led by decision despite passing the rule. Canada and Australia: accept provisional F-B until national sources are tested, or authorise a follow-up pass.
2. FD6 import: may the third-party Mendeley WEO vintage panel (to Oct 2026) or the DBnomics WEO mirror (to Apr 2025) be used as a stand-in for the IMF workbook, or must the import come from IMF files only (D23)? And may the 8 IMF API reads made for this note be treated as acceptable one-off research use?
3. Is a scripted verification pass (shell available) wanted for the OECD EO 119, WEO and revisions flows before design relies on these matrices?
4. Is a follow-up pass wanted for the untested items: national survey APIs and terms (BoJ, BoK, RBI, BI, INDEC, INEGI, NBS), Canada and Australia, country GDP release lags, N05, N06, N10, N11?

For the design phase (questions only):
5. How to store OECD edition numbers and EC/IMF/ECB editions as forecast vintages with dates (OECD edition date is not in flow metadata).
6. How to handle benchmark definitions that differ by source (WEO average vs end-period inflation, OECD CPI vs harmonised, gross debt vs financial liabilities vs Maastricht, fiscal-year India/South Africa).
7. How to represent aggregates when OECD has EA17 and no EU27, while WEO has G163 for the euro area and AMECO has EU27 and EA19-21.
8. How to treat countries with no benchmark in a given variable (for example no OECD or EC forecast for Argentina, Saudi Arabia) in evaluation (n/N display, D16).
9. Whether OECD revisions flow (non-production) is acceptable as a pseudo-real-time basis, or whether pseudo-real-time labels should rest on publication-lag masks only (N15).
10. Handling of ECB Data Portal outages for scheduled monthly runs.

## Sources cited (access date 2026-10-24 unless stated)
- IMF: https://data.imf.org/en/datasets/IMF.RES:WEO ; https://data.imf.org/en/Datasets/WEO/Frequently-Asked-Questions ; https://api.imf.org/external/sdmx/2.1/data/WEO/ (several keyed queries) ; https://api.imf.org/external/sdmx/2.1/dataflow/IMF.RES/WEO and /WEO_2025_OCT_VINTAGE ; https://data.imf.org/-/media/iData/External-Storage/Documents/D2AC2BB4C12C4A8CB2B6DAF1159263EB/en/WEOhistorical.xlsx (exceeded fetch limit)
- OECD: https://sdmx.oecd.org/public/rest/ (dataflow OECD.ECO.MAD; data DSD_EO@DF_EO; availableconstraint; data DSD_STES_REVISIONS@DF_STES_REVISIONS; dataflow and datastructure calls) ; https://www.oecd.org/content/collection/eo-data-en/datasetarchive?year=2011 (redirect only) ; interim outlook advisory https://www.oecd.org/en/about/news/media-advisories/2026/09/oecd-to-release-interim-economic-outlook-on-wednesday-23-september-2026.html (search result) ; https://oecd.org/economic-outlook/ (HTTP 403)
- European Commission: https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/economic-forecasts_en ; .../spring-2026-economic-forecast_en ; .../about-economic-forecasts_en ; https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database_en ; .../ameco-database/ameco-archive_en ; https://ec.europa.eu/economy_finance/db_indicators/statistical_annex/index_en.htm ; https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en ; https://www.astrid-online.it/static/upload/ip34/ip341_en.pdf (PDF unreadable to the tool)
- DBnomics: https://api.db.nomics.world/v22/providers/IMF , /OECD , /AMECO , /ECB ; /v22/series/AMECO/ZUTN , /UBLGE , /UBCA ; /v22/series/ECB/CISS , /CLIFS ; /v22/datasets/ECB/MPD , /RTD
- ECB: https://www.ecb.europa.eu/pub/projections/html/index.en.html ; https://www.ecb.europa.eu/mopo/devel/ecana/html/table.en.html ; SPF pages (index, about_the_survey, all_data, table_hist_rgdp) under https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/ ; https://www.ecb.europa.eu/stats/ecb_surveys/bank_lending_survey/html/index.en.html ; https://www.ecb.europa.eu/services/disclaimer/html/index.en.html ; https://data.ecb.europa.eu/data/datasets/RTD/data-information and /CISS/data-information (503; search snippets only)
- Eurostat euro indicators (search results): https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-07092026-ap , /2-16102026-ap , /2-17092026-ap
- Fed and others: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm ; https://www.federalreserve.gov/data/sloos.htm ; https://www.chicagofed.org/research/data/nfci/current-data ; https://fred.stlouisfed.org/series/NFCI ; https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/survey-of-professional-forecasters ; .../real-time-data-set-for-macroeconomists ; https://fred.stlouisfed.org/data/GDPNOW (search) ; https://libertystreeteconomics.newyorkfed.org/2019/07/just-released-historical-reconstruction-of-the-new-york-fed-staff-nowcast-2002-15 (search) ; https://www.statcan.gc.ca/eng/dai/btd/rct (search)
- National: https://dadosabertos.bcb.gov.br/dataset/expectativas-mercado ; BCRA REM ago 2026 PDF (search) ; Banxico, CBRT, RBI SPF pages (search) ; BoJ API notice https://www.boj.or.jp/en/statistics/outline/notice_2026/not260218a.htm (search) ; Bank of Canada https://www.bankofcanada.ca/rates/staff-economic-projections/ (search)
- World Bank, EIA, CPB, Kiel: https://www.worldbank.org/en/research/commodity-markets ; https://datacatalog.worldbank.org/search/dataset/0037888/global-economic-prospects (search) ; https://www.eia.gov/outlooks/steo/ ; https://catalog.data.gov/dataset/short-term-energy-outlook-u-s-economy-application-programming-interface-api (search) ; https://www.cpb.nl/en/release-date-next-world-trade-monitor-41 ; https://ifw-kiel.de/index.php?id=10 (search)
- Central-bank targets (search results): https://www.riksbank.se/en-gb/monetary-policy/the-inflation-target/ ; https://www.treasury.gov.za/comm_media/press/2025/2025111201 Announcement of the new inflation target for South Africa.pdf ; https://www.centralbanking.com/central-banks/monetary-policy/7975894/turkey-raises-inflation-target-to-24-citing-war-risks ; https://www.bcra.gob.ar/en/news/objectives-and-plans-2026/ ; https://www.investmentexecutive.com/news/research-and-markets/bank-of-canada-inflation-target-wont-change-in-2026-mandate-review-macklem/
- Third party: https://data.mendeley.com/datasets/259h4x738v
- Not retrievable today: ECB Data Portal and API (503), oecd.org pages (403), CPB data page and Kiel institute pages (404), Atlanta Fed GDPNow and NY Fed nowcast pages (no content rendered), EC 2026 BCS calendar PDF (unreadable), IMF WEO Transition Guide PDF (unreadable).
