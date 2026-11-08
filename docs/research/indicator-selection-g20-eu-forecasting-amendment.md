---
status: approved   # approved by the user on 2026-10-18 (stated in session: "amendment is approved"); earlier text: decisions FD1-FD11 recorded 2026-10-17
scope: Amendment to docs/research/indicator-selection-g20-eu-cross-country.md (same 42 countries + EU27 and euro-area aggregates, history from 1991, monthly refresh on day 1). Adds forecasting and nowcasting, official-forecast benchmarks, forecast evaluation, and dashboard/model-layer needs. Use case: monitoring + forecasting + cross-country comparison.
date: 2026-10-17
updated: 2026-10-17 (user decisions U1-U9 recorded as FD1-FD11; none of U1-U11 remains open except the short-series rule)
amends: docs/research/indicator-selection-g20-eu-cross-country.md   # original left untouched
---
# Indicator selection amendment: forecasts, nowcasts, evaluation, and model-layer inputs (G20 + EU)

Access date for URLs: 2026-10-17. Claims not backed by a page fetched in this session are labelled [UNVERIFIED] (analyst background knowledge); the researcher must confirm them. This file is a proposal, except where a row of the decisions table below records a user decision. IDs prefixed FT (forecast target), N (new predictor), B (benchmark), PR (proposal) are new; FD (forecast decision) numbers the decisions recorded here; all other IDs (M, Q, A, G, D) refer to the original document. Decisions D1-D23 of the original stay in force unless a decision below states an exception (FD6 is the only one).

## Relationship to the original document

- Written as a NEW draft file. The original is not edited.
- The earlier discrepancy in the original (front matter said approved, change log said reset to draft) is resolved by the user's decision FD1: the original is re-approved by the user with D20-D23 applied. The CLAUDE.md gate on the predecessor document is therefore satisfied for the original. Note: this file records the user's statement made on 2026-10-17; the original file was not edited by this task, so its front matter should be checked by the user or the caller to match.
- This amendment must still be approved by the user separately (status stays draft) before phase 1b (research) covers the new rows.

## Decisions recorded (user, 2026-10-17)

Numbered FD1-FD11 so they do not clash with D1-D23 of the original. The question number (U) the decision answered is given for traceability.

| No. | From | Decision | Effect on this document |
|---|---|---|---|
| FD1 | U1 | The original (docs/research/indicator-selection-g20-eu-cross-country.md) is re-approved by the user with D20-D23 applied. | Predecessor gate satisfied; discrepancy closed. |
| FD2 | U2 | Core and extended forecast targets are accepted as proposed: FT01-FT06 core; extended targets FT07 (industrial production), FT09 (current account), FT10 (fiscal balance and debt), FT11 (recession probability). FT08 remains optional. FT12 (inflation-above-band probability) moved from optional to extended by the user on 2026-10-17. Horizons as in the target table. | Target catalog and horizon table stand. |
| FD3 | U3 | The three model-depth tiers are accepted: F-A full, F-B reduced, F-C benchmark-led. Final country membership is set by the researcher's coverage matrix. | PR1 accepted; membership lists below remain candidates until the matrix exists. |
| FD4 | U4 | PMIs, equities and VIX stay dropped (D20 unchanged). Only free substitutes are used: EC surveys, OECD CLI, national statistics offices' own surveys. | No reversal of D20; researcher looks for free national-statistics-office surveys as substitutes. |
| FD5 | U5 | Forecasts are scored against both the first release and a mature vintage. Pre-launch backtests are labelled "pseudo-real-time on revised data". The history loaded is revised data from 1991 onward; D10 (preserve vintages, no backfill) applies from launch. | PR2 accepted. The label is mandatory on any pre-launch result. |
| FD6 | U6 | A one-off import of official benchmark forecast archives (IMF Historical Forecasts Database, EC and OECD past forecasts) is allowed. It is an explicit, named exception to D10 and covers benchmark forecasts only, never the system's own data vintages. | B10 is permitted; researcher task R9. Imported rows must be labelled as imported archive data with source edition date. |
| FD7 | U7 | The January and July WEO updates are skipped for now; only the April and October WEO editions are ingested (manual, per D23). The updates stay a possible later add-on. | B01 limited to April and October. |
| FD8 | U8 | Probability alerts are wanted: recession probability (FT11) and inflation-above-band (FT12). Thresholds are set in the design phase. FT12 needs a central-bank target and tolerance metadata table (researcher task R7). Probabilities need a calibration display because recessions are rare. | Alerts and calibration requirements added below; FT11/FT12 evaluation uses Brier score plus a calibration (reliability) display. |
| FD9 | U9 | Monthly cadence (run on day 1) is sufficient. | AS2 confirmed; no faster cadence. |
| FD10 | U8-residual | Accepted: benchmark staleness limits (PR5), the evaluation metric list (PR3) and reporting with and without 2020-2021 (PR4). | Evaluation requirements below marked accepted. |
| FD11 | U11 | Accepted: A02 stays a descriptive scorecard item; N11 (unemployment slack gap) is the model-layer slack input. Economies without N11 coverage run without a slack input. | A02 and N11 rows consistent; no change to the catalog. |

## Goals and analytical questions

### Amended goal (as set by the user, 2026-10-17)
A full macro analysis system covering: (1) predictions: forecasts and nowcasts of key indicators with stated horizons and evaluation against real data; (2) analysis of each economy's current situation; (3) cross-country comparison; (4) a full dashboard plus a model layer over the data.

Mapping to the original tiers: U1 (scorecards) serves goals 2-3; U2 (early warning) now also receives forecast-based risk probabilities; U3 (long-run growth) is unchanged; new tier U4 below. (These tier labels U1-U4 belong to the original document's tiers and are unrelated to the decision-question numbers U1-U11 used in this file's decision and open-question lists.)

New tier U4, forecasting and nowcasting: what do we expect for growth, inflation and unemployment now and over the next 1-4 quarters/years, how does that compare with official forecasts, and how good has each forecast been?

### New analytical questions
13. Nowcast: what is GDP growth in the quarter that is still running or not yet published, and how does each new data release change it?
14. Outlook: where will headline and core inflation, unemployment and GDP growth be at 1, 3, 6, 12 months / 1-4 quarters / current and next calendar year?
15. Risk: what is the probability of a contraction or recession within 4 quarters (yield curve, financial conditions, surveys)? What is the probability that inflation stays above the country's target band?
16. Benchmark: is the system's forecast more accurate than naive models and than IMF, OECD, EC and ECB projections? Where does it disagree with them, and was the disagreement right?
17. Cross-country: which economies are forecast to grow, disinflate or tighten fastest, on a comparable definition?
18. Track record: for each country and target, bias, error size and hit rate by horizon, on real released data.

### Assumptions I made (status after user decisions)
- AS1: Forecast/nowcast outputs cover the same 42 countries + 2 aggregates, but model depth is tiered (see Coverage). Thin-data emerging economies get official-forecast display and simple models only. Confirmed by FD3.
- AS2: The monthly run on the 1st (original design principle) stays the only refresh cadence. "High-frequency" therefore means monthly survey, market and financial-conditions series read at month-end; weekly/daily series are aggregated to monthly (as the original already does for daily data). Confirmed by FD9.
- AS3: D20 (free data only, PMIs, equities, VIX/EPU, CDS, ratings dropped) and D23 (no automated IMF pulls; WEO manual in April and October) stay in force. Benchmarks and predictors below are therefore restricted to free, non-IMF-automated sources. Confirmed by FD4 and FD7.
- AS4: "Evaluation against real data" means comparison with the statistical agency's later published outcomes, using stated vintages (below), not with the system's own history. Confirmed by FD5 (first release and mature vintage).
- AS5: Scoring is by accuracy per horizon; no composite country rank is introduced (D6 stands).

## Coverage (economies / aggregates, history depth, frequencies)

Economies, aggregates and history depth: unchanged from the original (42 countries, EU27 and euro area as unranked aggregates, history from 1991, D4). Euro area is a first-class forecast target because ECB projections and the ECB SPF exist only for it.

### Model-depth tiers (accepted as FD3; the researcher's monthly coverage matrix decides final membership)
- Tier F-A, full nowcast + forecast (monthly hard data and surveys available, quarterly SA GDP): euro area, EU27, and countries with rich Eurostat/OECD coverage, plus the United States, United Kingdom, Japan, Canada, South Korea, Australia. Candidate list; the exact membership is [UNVERIFIED] until the coverage matrix exists.
- Tier F-B, forecast with a reduced predictor set (quarterly GDP but thin monthly data, or non-SA data): smaller EU members and the better-covered emerging economies.
- Tier F-C, benchmark-led (the original's "thin coverage" group: China, India, Indonesia, Argentina, Saudi Arabia, South Africa, Turkiye, Brazil, Mexico [UNVERIFIED which of these fall here]): official annual forecasts are displayed and evaluated; own models only for annual targets with naive/AR benchmarks. Extreme-inflation countries (Argentina, Turkiye) need capped/log-type error measures (comparability issue 1 of the original).
- Fairness rule carried over from D16: show coverage n/N of predictors available; never impute.

### Target horizons and frequencies (summary; detail in the target table)
| Frequency of target | Nowcast (h = 0) | Forecast horizons | Refresh |
|---|---|---|---|
| Monthly (CPI, core CPI, unemployment, IP) | current month before release (CPI flash for euro area, partial) | 1, 3, 6, 12 months | each monthly run |
| Quarterly (real GDP) | current quarter and last unpublished quarter | 1, 2, 4 quarters | each monthly run (about 3 updates per quarter as data arrive) |
| Annual (calendar-year real GDP, average CPI, unemployment, current account, fiscal balance and debt) | current year | current year and next year (fixed-event, matching WEO/OECD/EC) | each monthly run for own forecasts; official benchmarks refresh when published (WEO: April and October only, FD7) |

Reason for horizon limits [UNVERIFIED but standard practice]: beyond about 4 quarters/2 years, accuracy of macro forecasts rarely beats an unconditional mean, so longer horizons are left to official projections shown as context.

### Forecast evaluation requirements (indicator-level; not a design)
- Forecast origin: each forecast stores its as-of date (the run date) and the data vintage used. This is only possible going forward (D10 applies from launch; FD5).
- Realisation vintages to score against (accepted, FD5, formerly PR2): (a) first release; (b) a "mature" estimate, defined as the value published about 4 quarters after the reference period for monthly/quarterly series and the spring edition of the following year for annual series. Both are reported, since revisions of GDP, industrial production, the unemployment rate and output gap are large [UNVERIFIED magnitude].
- Metrics per target, horizon and country (accepted by the user, 2026-10-17, FD10: PR3): bias (mean error), MAE, RMSE, relative RMSE versus each benchmark (naive random walk/last value, AR, and available official forecasts), Diebold-Mariano test of equal accuracy [UNVERIFIED as the standard test; method choice is for the model phase], directional hit rate for turning points, Brier score for the probability targets (FT11, FT12), and interval coverage if ranges are shown.
- Calibration of probability targets (FD8): FT11 and FT12 must be shown with a calibration (reliability) display next to the Brier score, and with the number of event occurrences behind it, because recessions are rare and a Brier score alone can look good for a forecaster that never predicts a recession. Small-sample caveat to be shown where events are few.
- Pre-launch backtests (before the pipeline's first run) use only the loaded history, which is revised data from 1991 onward (FD5), so they overstate accuracy (revised-data bias, as already stated in the original's Vintage policy). To reduce the bias, mask each series by its typical publication lag. Every such result must be labelled "pseudo-real-time on revised data" (FD5). This needs a release lag per series (N15).
- Sample: report with and without 2020-2021, because COVID dominates squared errors (accepted by the user, 2026-10-17, FD10: PR4).
- Official-forecast track records: the IMF WEO page offers a vintage comparison tool and a Historical Forecasts Database (per the project's source note, docs/research/data-sources-g20-eu-cross-country.md, line 88, which marks it as page-verified on 11 Oct 2026). EC and OECD archives of past forecasts are [UNVERIFIED]. FD6 allows a one-off import of these archives as an explicit exception to D10, limited to benchmark forecasts; it does not allow backfilling the system's own data vintages.
- Staleness of forecasts (accepted by the user, 2026-10-17, FD10: PR5): a benchmark forecast vintage is shown with its publication date and marked stale when older than 9 months for annual WEO/OECD/EC forecasts and older than 4 months for quarterly ECB projections/SPF. Forecast and nowcast values carry a "projected" flag and are never mixed into ranks or alert windows of observed data (consistent with the original Vintage policy).

## Indicator catalog

Columns follow the template. "Role" column is added in the keep/change table, not here, to keep the template columns. Priority: core / ext / opt as in the original. Target priorities FT01-FT12 were accepted as proposed (FD2); predictor and benchmark rows remain proposals until the amendment is approved.

### 1. Forecast and nowcast targets (all reuse existing indicator IDs as the realised series)
| ID | Indicator | Question served | Definition | Class (lead/coinc/lag) | Frequency | Transformation | Coverage | Revision/lag notes | Priority (core/ext/opt) | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|
| FT01 | Real GDP growth, quarterly (realised = Q01) | 13, 14 | Real GDP volume, SA, QoQ and YoY | Coinc | Quarterly; nowcast h=0, forecast h=1,2,4 quarters | QoQ SA (not annualised, to avoid cross-country scale confusion), YoY. NSA-only countries: YoY only | Tier F-A/F-B; F-C where quarterly exists | First flash about 30-45 days after quarter end [UNVERIFIED lag per country]; revised for years; score on first release and mature vintage | core | Eurostat, OECD QNA, national |
| FT02 | Real GDP growth, annual calendar year, current and next year (realised = annual aggregate of Q01 or WEO/national annual) | 14, 16 | Annual real GDP growth | Coinc | Annual; h = current year, next year | YoY % (B1). Fiscal-year economies (India and others per original issue 5) flagged | All 42 + aggregates | Annual outcome revised at later national-accounts benchmarks; compare to WEO/OECD/EC on identical definition | core | Eurostat, OECD, WB WDI, WEO (manual) |
| FT03 | Headline CPI/HICP inflation (realised = M06) | 14, 15 | YoY, monthly | Coinc/lag | Monthly; nowcast h=0 (before release; euro-area flash is published near month-end [UNVERIFIED timing]), h=1,3,6,12 | YoY, also 3m annualised for sub-annual diagnostics | All; HICP for EU27 | Rarely revised, so scoring uses a single vintage | core | Eurostat, OECD, national |
| FT04 | Core inflation (realised = M07) | 14 | Ex food and energy; definition varies by country | Lag | Monthly; h=1,3,6,12 | YoY | EU, OECD; EM partial | As FT03; definition not harmonised across countries | core | Eurostat, OECD |
| FT05 | Average annual inflation, current and next year (from M06) | 14, 16 | Annual average CPI change (WEO convention; end-period variant exists [UNVERIFIED]) | Lag | Annual | YoY | All 42 | Benchmarks differ between average and end-of-period inflation; align before scoring | core | WEO (manual), OECD, EC |
| FT06 | Unemployment rate (realised = M09; quarterly or annual fallback where no monthly) | 14 | ILO-definition unemployment rate | Lag | Monthly or quarterly; h=1,3,6,12 months | Level (pp error) | EU, OECD; EM partial | EU monthly values partly LFS-model-based and revised; score vs mature vintage | core | Eurostat, OECD |
| FT07 | Industrial production growth (realised = M01) | 13 | Monthly IP volume | Coinc | Monthly; h=0 to 3 months | YoY, 3m/3m | Tier F-A | Revised; also a predictor of FT01 | ext | Eurostat, OECD |
| FT08 | Merchandise export volume/value growth (realised = M12) | 14 | Goods exports | Coinc/lead | Monthly; h=1 to 3 months | YoY in local currency (B1) | Tier F-A | Value vs volume; FX noise if USD | opt | Eurostat, national, CPB |
| FT09 | Current account % of GDP, current and next year (realised = Q05 or WEO) | 14 | BPM6 | Lag | Annual (quarterly realised) | % GDP | All 42 | Slow-moving; benchmark WEO/EC/OECD; own model only a simple one | ext | WEO (manual), Eurostat, OECD |
| FT10 | General government balance and gross debt % of GDP, current and next year (realised = A04, A05) | 14 | Fiscal | Lag | Annual | % GDP | All 42 | Benchmark-only: official forecasts displayed and scored; no own model proposed | ext | WEO (manual), EC (AMECO), OECD |
| FT11 | Recession/contraction probability: P(real GDP QoQ < 0 in any of next 4 quarters) | 15 | Binary event built from realised Q01 | Lead | Quarterly event, updated monthly | Probability; scored by Brier score and shown with a calibration display (FD8); probability alert wanted (FD8), threshold set in design | Tier F-A, F-B | Event definition sensitive to GDP revisions and NSA series; "technical recession" vs NBER-style dating not equivalent; events are rare, so calibration is statistically weak | ext | derived |
| FT12 | Inflation-above-band probability: P(headline YoY > target + tolerance) at 12 months | 15 | Binary event vs the central bank target | Lead | Monthly | Probability; Brier score plus calibration display; probability alert wanted (FD8), threshold set in design | Countries with a stated numeric target | Needs a target/tolerance metadata table (neither in the original catalog nor sourced yet; researcher task R7); priority moved to extended by the user (FD2, 2026-10-17) because the alert is wanted | ext | Central banks (target metadata) |

Not forecast (and why): policy rates (reaction function, shown with market-free benchmarks only via B05); exchange rates and sovereign yields (close to random walks; naive benchmark would win [UNVERIFIED but widely reported]); commodity prices (global conditioning variables, official outlooks shown as context, B08); output gap (unobservable, A02); structural/social/institutional annual indicators (not cyclical). PPI, retail, credit and house prices: used as predictors, not forecast, in this version (optional later).

### 2. New predictors and leading indicators (added to the original catalog)
All free-data only (D20, D15; FD4). "Targets served" refers to FT rows. Class is lead unless stated.

| ID | Indicator | Question served | Definition | Class (lead/coinc/lag) | Frequency | Transformation | Coverage | Revision/lag notes | Priority (core/ext/opt) | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|
| N01 | EC Business and Consumer Survey detail: production expectations, order books, employment expectations, selling-price expectations (industry, services, retail, construction), consumers' price expectations and unemployment expectations | 13, 14 | Survey balances by sector; extends M03/M04 (same release, no extra fetch) | Lead | Monthly | Level, own-history z (levels not comparable across countries) | EU27 + euro area (+ candidate countries); no non-EU G20 | Released near month-end (fast, ragged-edge advantage); SA factors revised [UNVERIFIED]. Targets: FT01, FT03, FT06 | core | EC BCS (the original's source hint: https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en) |
| N02 | Financial conditions / systemic stress indices: ECB CISS (euro area), Chicago Fed NFCI (United States); other national indices if free | 15 | Composite financial-conditions measures (weekly/daily, month-end read) | Lead | Monthly (from daily/weekly) | Level, own-history z | Euro area; US; others unlikely | Licence/terms and exact constituents [UNVERIFIED]; embed equity and volatility information that the user dropped as stand-alone series (D20), so no conflict. Targets: FT11, FT01 | ext | ECB Data Portal, Chicago Fed |
| N03 | Yield-curve slope: 10-year yield minus 3-month rate | 15 | Derived from M18 and M19 | Lead | Monthly | Level, sign, own-history z | Where M19 3m exists (OECD+); EM thin | No revision; M19 is currently ext, upgrade needed; definitions of 3m rate vary and LIBOR transition breaks exist (original M19 note). Targets: FT11, FT01 | core | derived (ECB, OECD, FRED) |
| N04 | Bank lending conditions: ECB Bank Lending Survey (euro-area countries), Fed SLOOS (US) | 15 | Net tightening of credit standards and loan demand | Lead | Quarterly | Level | Euro area by country; US | Lag small; coverage outside EA/US absent [UNVERIFIED] | ext | ECB, Fed |
| N05 | Import price index and non-energy import prices | 14 | Price of imports (goods) | Lead | Monthly | YoY (B1) | EU, OECD; EM partial | Revised; overlaps M08, M24, M15. Target FT03, FT04 | ext | Eurostat, OECD, national |
| N06 | Wage growth: negotiated wages (euro area), hourly labour costs, average earnings | 14 | Labour compensation growth | Lag/coinc | Quarterly (some monthly) | YoY | EU quarterly (labour cost index), UK/US/JP monthly [UNVERIFIED] | Lagged and revised; overlaps Q16. Core-inflation and services-inflation predictor (FT04) | ext | Eurostat, ECB, national |
| N07 | Inflation expectations: consumers (from N01), professional forecasters (B05), central-bank surveys | 14, 15 | Resolves the original's Q14 (V flag, free alternative needed) | Lead | Monthly/quarterly | Level, gap to target | EA, EU via EC; US, UK, JP central-bank surveys [UNVERIFIED] | Concepts differ (perception vs expectation, horizon); Consensus excluded (paid, D15) | ext | EC BCS, ECB SPF, central banks |
| N08 | Global trade and foreign-demand indicators: CPB World Trade Monitor (volume, world and regions), Kiel Trade Indicator | 13, 14 | Global goods trade volume | Coinc/lead | Monthly | YoY, 3m/3m | Global/regional | Lag about 2 months; revised [UNVERIFIED]; Kiel indicator licence [UNVERIFIED]. Targets: FT01, FT07, FT08 for open economies | ext | CPB, Kiel Institute |
| N09 | Trade-weighted foreign demand (derived): partner GDP/IP weighted by export shares | 13 | Derived from M12 partner shares and partners' FT01/FT07 | Lead | Monthly/quarterly | YoY | Open economies (all EU members) | Depends on bilateral trade data; weights revised yearly | ext | derived (UN Comtrade, Eurostat) |
| N10 | Labour-market high-frequency: job vacancies rate (Eurostat), national claims data (e.g. US initial jobless claims) as country extensions | 14 | Vacancies / registered claims | Lead | Quarterly / weekly (aggregated to month) | Level, YoY | EU vacancies; US claims | Original excluded national-specific series; re-allowed only as optional Tier F-A extensions. Targets: FT06 | opt | Eurostat, national |
| N11 | Slack gap (derived): unemployment rate minus structural estimate (NAWRU or OECD NAIRU) | 14 | Replaces the output gap as the real-time slack input, because A02 covers only 25 of 42 countries (D22) and has a well-known end-point problem [UNVERIFIED]. Accepted by the user (FD11) | Coinc | Annual/semi-annual | pp gap | EU27 (AMECO), OECD members | Model-based estimates revised heavily; keep estimate vintage | ext | EC AMECO, OECD |
| N12 | Real policy rate and real long rate (derived: M17 minus expected or core inflation; M18 minus N07) | 14, 15 | Monetary stance | Lead | Monthly | Level, gap to own history | All with M17/M18 | Choice of expectation proxy affects result | ext | derived |
| N13 | Common global factor(s) (derived): first principal components of M01, M03, M12, M24 across the panel | 13, 14 | Cross-country co-movement for panel models | Coinc/lead | Monthly | Index | Panel | Composition shifts as data arrive; model-layer item, listed so inputs are retained | opt | derived |
| N14 | Short-term oil and gas outlook (EIA STEO) and World Bank Commodity Markets Outlook | 14 | Official projections of energy/commodity prices to condition inflation forecasts | Lead | Monthly (STEO), semi-annual (WB) | Level, YoY | Global | Revised at each edition; keep vintages. Frequency/availability [UNVERIFIED] | opt | EIA, World Bank |
| N15 | Release calendar and first-release timestamp per series (metadata, not an economic indicator) | 13, 18 | Publication date and lag of each observation | n/a | Per release | n/a | All series | Required for pseudo-real-time backtests and ragged-edge handling; the original's Vintage policy already requires release dates going forward | core | source release calendars |

Notes on N-rows: M05 (OECD CLI) remains the OECD's own leading composite; treat it as a predictor and a pseudo-benchmark, not as a forecast of any single target. PMIs are not reintroduced (D20 stands, FD4). Free substitutes for the dropped PMI information are the EC surveys (N01/M03/M04), OECD CLI (M05) and national statistics offices' own surveys; the researcher checks which countries have the latter (R1).

### 3. Official-forecast and external benchmarks
| ID | Indicator | Question served | Definition | Class (lead/coinc/lag) | Frequency | Transformation | Coverage | Revision/lag notes | Priority (core/ext/opt) | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|
| B01 | IMF WEO projections: real GDP growth, inflation, unemployment [UNVERIFIED availability for all countries], current account, fiscal balance and debt, current and next year (existing A03, upgraded) | 16, 17 | Official projections; April and October editions only (FD7; https://www.imf.org/en/Publications/WEO, as cited in the original; the October 2026 edition was due 13 Oct 2026 per the project's source note) | Lead | Semi-annual | Level; revision vs previous edition; error vs realised | All 42 | Store every ingested edition as a vintage, flag "projected". Manual download (D23). January and July updates are not ingested for now (FD7); a possible later add-on | core | IMF WEO (manual) |
| B02 | OECD Economic Outlook projections: GDP, inflation, unemployment, current account, fiscal; quarterly paths [UNVERIFIED] | 16, 17 | OECD Economic Outlook, main editions about twice a year with interim editions [UNVERIFIED; OECD page returned HTTP 403 in this session] | Lead | Semi-annual (+ interim) | As B01 | OECD members and some non-members (Argentina, Brazil, China, India, Indonesia, South Africa, Saudi Arabia, Turkiye) [UNVERIFIED] | As B01 | core | OECD |
| B03 | European Commission forecasts: GDP, inflation, unemployment, balance, debt | 16, 17 | "Two fully-fledged forecasts in autumn and spring", plus winter and summer editions, some labelled interim (https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/economic-forecasts_en, accessed 2026-10-17). Country list and variables not stated on that page; EU27 coverage expected, non-EU coverage [UNVERIFIED] | Lead | Semi-annual (+ interim) | As B01 | EU27, euro area; maybe UK, US, Japan, others [UNVERIFIED] | Interim editions cover fewer variables/countries [UNVERIFIED]. Downloadable via AMECO or the forecast tables [UNVERIFIED] | core | EC DG ECFIN |
| B04 | Eurosystem/ECB staff macroeconomic projections (euro area GDP, HICP, unemployment) | 16 | Quarterly projections; schedule of four rounds per year [UNVERIFIED, not fetched] | Lead | Quarterly | As B01 | Euro area only | Real-time vintages archive [UNVERIFIED]; the only quarterly official benchmark in the set | core (euro area) | ECB |
| B05 | ECB Survey of Professional Forecasters: inflation, real GDP growth, unemployment, probability distributions | 14, 16 | "Published four times a year"; point forecasts and probability distributions; horizons from current year to longer term (https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/index.en.html, accessed 2026-10-17). Download format not stated on that page; the page links an all-historical-data section | Lead | Quarterly | Level, distribution tails | Euro area | Long history of survey rounds; useful as a market-consensus proxy because Consensus Economics is paid (D15) | ext | ECB |
| B06 | National central-bank and official projections: Fed Summary of Economic Projections, BoE Monetary Policy Report, BoJ Outlook Report, BoC MPR and others | 16 | Official central-bank forecasts | Lead | Quarterly/several per year | As B01 | Tier F-A countries | Formats and variables differ; fan-chart vs point forecasts; most useful for countries without B04 [UNVERIFIED] | ext | national central banks |
| B07 | World Bank Global Economic Prospects (GDP growth forecasts) | 16, 17 | Semi-annual WB forecasts [UNVERIFIED] | Lead | Semi-annual | As B01 | Global incl. EMs [UNVERIFIED] | GDP growth focus; useful where OECD/EC do not cover | opt | World Bank |
| B08 | US nowcasts: Atlanta Fed GDPNow, NY Fed Staff Nowcast | 13, 16 | Public model-based nowcasts of US GDP | Coinc | Frequent | Level | United States only | Benchmark for the US nowcast, not a predictor. Availability and vintage archive [UNVERIFIED] | opt | Atlanta Fed, NY Fed |
| B09 | Naive benchmarks (not a data source): last value / random walk, same-quarter-last-year, AR(p), historical mean, unconditional 4-quarter average | 16 | Reference forecasts any model must beat | n/a | Same as target | Relative RMSE | Every target | Computed from stored vintages; no external data | core | computed |
| B10 | Past-forecast archives for historical benchmark error: IMF Historical Forecasts Database and vintage comparison tool (page-verified per the project's source note); EC and OECD forecast archives [UNVERIFIED] | 18 | Real-time historical edition errors of official forecasts | n/a | As published | Error statistics | Per source | One-off import allowed by the user (FD6) as an explicit exception to D10, benchmark forecasts only, never the system's own data vintages. IMF archive is a manual download (D23). Imported rows are labelled as archive imports with edition date | ext | IMF, EC, OECD |

Redundancy flags for this section: B01-B03 overlap strongly in content (all produce annual GDP/inflation forecasts); keep all three because their disagreement is informative and no single source covers all 42 countries; B07 mostly duplicates them. B06 overlaps B04 for the euro area.

### 4. Keep / change / add against the original catalog
| Original ID(s) | Action | New role and reason |
|---|---|---|
| All 28 core rows (M01, M02, M03, M04, M06, M07, M09, M12, M14, M15, M16, M17, M18, M24, G01, Q01, Q05, Q06, Q08, A01, A02, A03, A04, A05, A10, A11, A14, A16) | KEEP as core | Unchanged. Roles added: M01, M02, M03, M04, M12, M24, M18, M17 are nowcast/forecast predictors; Q01, M06, M07, M09 are also forecast targets (FT01-FT06); A03 becomes benchmark B01 |
| M03, M04 | KEEP core, role changed | Primary lead survey inputs for nowcasts. Extended by N01 (same release). PMI part stays dropped (D20, FD4) |
| Q01, M06, M07, M09 | KEEP core, CHANGE retention/precision | Also targets: first release and subsequent revisions must be kept explicitly as vintages (original D10 already requires this, from launch); release lag per observation needed (N15). Q01 NSA-only countries need YoY-only targets |
| M19 short-term interbank rate | CHANGE ext to core | Needed for the yield-curve slope N03 (best-known free recession predictor [UNVERIFIED]); 3m rate coverage is OECD+ only, thin for EMs |
| M18 10y yield | KEEP core | Also feeds N03 and N12; still the free substitute for dropped CDS spreads |
| M05 OECD CLI | KEEP ext | Predictor and cross-check for FT01/FT11; free substitute for dropped PMIs (FD4); redundancy flag with M03/M04 stays |
| M08 PPI | KEEP ext | Predictor for FT03/FT04; overlaps N05 import prices |
| M21 credit growth, Q06 credit gap, Q07 real house prices, Q13 | KEEP, role added | Predictors for FT11 (financial-cycle risk). Q06 one-sided HP gap revises, so never use as an out-of-sample predictor without vintage control |
| M27 electricity | CHANGE opt to ext | Hard-data nowcast proxy; coverage patchy; validate before use |
| Q03 employment/hours, Q16 unit labour costs, Q14 inflation expectations | CHANGE: Q03 ext (keep), Q16 opt to ext, Q14 opt to ext | Q16 and N06 for wage-inflation link; Q14 resolved through N07 with free ECB/EC/central-bank surveys |
| A02 IMF output gap | KEEP core, role limited | Descriptive scorecard item only. Not a real-time predictor: it is a WEO estimate that is revised and covers 25 of 42 countries (D22). N11 supplies a replacement slack gap for model use (accepted, FD11) |
| A02b, A02c | KEEP opt | Comparison series only |
| A03 WEO forecasts | KEEP core, becomes B01 | Add unemployment [UNVERIFIED availability], keep every ingested edition (April, October) as a vintage, extend to realised-vs-forecast evaluation |
| A04, A05 | KEEP core | FT10 benchmark-only |
| A07-A26, G02-G15, remaining ext/opt | KEEP unchanged | Structural/context tiers; not forecast |
| M20 equities, M25 EPU/VIX, M26 CDS, PMI part of M03, A06 ratings | STAY DROPPED (D20; FD4) | Financial-conditions indices N02 carry some of the information; no re-opening requested by the user |
| A25 GDP deflator, A26 | KEEP | Deflator is needed to convert nominal into real nowcast aggregates |
| New | ADD | FT01-FT12 (12 target definitions, no new raw data), N01-N15 (15), B01-B10 (10, with B01 = A03 upgraded and B09/B10 not new source series) |

### Counts (proposal; target priorities confirmed by FD2)
- Core data rows: original 28 plus new core rows N01, N03 (M19 moves from ext to core), N15, B02, B03, B04 = 34 core. B09 is a computed benchmark with no source. B01 is A03 and is already counted.
- New extended rows: N02, N04, N05, N06, N07, N08, N09, N11, N12, B05, B06, B10 (12). New optional rows: N10, N13, N14, B07, B08 (5).
- Targets: 6 core (FT01-FT06), 5 ext (FT07, FT09, FT10, FT11, FT12), 1 opt (FT08). Accepted by the user (FD2).
- Net additional source series for the researcher to assess: N01-N15 and B01-B08, B10 (about 23 rows, of which several share a source with existing rows: N01 with M03, N03 with M18/M19, N09/N12/N13 derived, N15 metadata).

## Dashboard and model-layer requirements at indicator level (inputs, not design)
- Current-situation page (goal 2): the original scorecards, plus for each country the latest nowcast/forecast of growth, inflation and unemployment next to the latest observed value and the staleness flag.
- Forecast page (goal 1): for each country and target, the system forecast by horizon, official forecasts (B01-B05) side by side with their vintage dates, range or probability where available, and the track record (bias, RMSE and relative RMSE vs benchmarks, from the evaluation requirements above). Probability targets (FT11, FT12) are shown with a calibration display and the event count (FD8). Any pre-launch result is labelled "pseudo-real-time on revised data" (FD5).
- Cross-country page (goal 3): forecast comparison tables on a common definition (calendar-year GDP growth, average inflation, unemployment) with percentile rank per D16; no composite rank (D6).
- Model layer needs these derived series stored as first-class indicators: yield-curve slope (N03), real policy rate (N12), slack gap (N11), foreign demand (N09), common factors (N13), nowcast revisions ("news" per data release), forecast errors.
- Alerts: the original z-score alert rule (D9/D19) stays for observed data. Probability alerts are wanted for FT11 (recession probability) and FT12 (inflation above band) (FD8); thresholds are set in the design phase.

## Cross-country comparability issues

All 21 issues of the original stay. Additional issues specific to forecasting:
22. Official forecasts are annual (current/next year); own monthly/quarterly forecasts must be aggregated to calendar-year growth the same way (arithmetic average of quarterly levels, not the Q4/Q4 rate) before comparison [UNVERIFIED convention per source].
23. WEO, OECD and EC differ in definition (average vs end-period inflation; fiscal-year GDP for some countries, such as India [UNVERIFIED]; ESA vs GFS debt; HICP vs national CPI). Each benchmark must be stored with its own definition and compared only with the matching target definition.
24. Forecast dates differ: an IMF October forecast and an EC autumn forecast are made at different dates with different information sets. Compare only vintages with a similar information date and display the date.
25. Realised values depend on the vintage: GDP can be revised for years, and base-year and ESA/SNA changes shift levels. Always label the scoring vintage (first release vs mature).
26. Seasonal adjustment and NSA-only GDP: QoQ cannot be forecast or compared for NSA-only countries; use YoY for cross-country forecast tables.
27. Survey balances are not comparable across countries (original issue 8), so cross-country nowcast comparison must rely on own-history z-scores or model outputs, not survey levels.
28. Extreme-inflation economies (Argentina, Turkiye) dominate pooled error statistics; report errors per country and use relative (benchmark-scaled) or log measures for pooled comparison.
29. Euro-area members have a common interest rate and exchange rate; their country forecasts should be compared to the euro-area aggregate rather than treated as independent monetary regimes.
30. Evaluation sample is short for annual targets: with 1991 as the earliest start, annual current-year/next-year errors have at most about 30 observations per country in the best case, and far fewer in real time since system launch (D10). The FD6 archive import eases this for benchmark forecasts only, not for the system's own forecasts. Annual-horizon claims about accuracy will be statistically weak for years; the dashboard must say so.
31. Rare events: recessions (FT11) are few per country, so calibration and Brier scores are noisy; pooled-panel calibration and event counts should be shown (FD8).

## Excluded indicators and why

All exclusions of the original stay. Additional:
- Consensus Economics, Bloomberg and other paid consensus forecasts: excluded under D15. ECB SPF and official forecasts (free) serve as benchmarks instead.
- Market-implied expectations (OIS, inflation swaps, breakevens, futures curves): not found free and consistent across 42 countries [UNVERIFIED]; excluded for now.
- Daily/weekly data used as raw refresh inputs (financial conditions, claims, mobility, card spending, Google Trends, news sentiment): excluded as separate refresh tiers because the system refreshes monthly (AS2, FD9); month-end reads allowed for N02 and N10.
- Forecasts of policy rates, exchange rates, sovereign yields and commodity prices: not produced (naive benchmark expected to be hard to beat [UNVERIFIED]); commodity outlooks are shown as context (N14).
- Forecasts of social, structural and environmental indicators: out of scope for this amendment.
- Nowcast products of other institutions for non-US countries: not identified; not added.
- January and July WEO updates: not ingested for now (FD7); possible later add-on.

## Open questions (user / researcher)

User (still open):
- U10 (answered 2026-10-17: ok): the watch level (|z| >= 1.5) is confirmed by the user. The short-series minimum-observation rule from the original: not separately answered, still to be confirmed.
- U11 (answered 2026-10-17: yes, FD11): A02 stays a descriptive scorecard item and N11 (unemployment slack) is the model-layer replacement.
- U8-residual (answered 2026-10-17: yes, FD10): benchmark staleness limits (PR5), metric list (PR3) and reporting with/without 2020-2021 (PR4) are accepted. Alert thresholds themselves are deferred to the design phase (FD8).

Resolved questions U1-U9 have moved to the decisions table (FD1-FD9).

Researcher (to verify; no source assessment done in this document):
- R1. For N01-N15 and B01-B10: free access, licence/terms, machine-readable formats, country coverage, start dates versus 1991, and whether past editions are archived (IMF Historical Forecasts Database, EC, OECD, ECB projections archive, ECB SPF history). Also identify free national statistics office surveys (PMI-type or business-confidence) usable as substitutes for the dropped PMIs (FD4). The OECD pages returned HTTP 403 for this agent.
- R2. Coverage matrix of OECD EO, EC and WEO forecasts across the 42 countries by variable (GDP, CPI, unemployment, current account, fiscal), including which countries have unemployment forecasts at all. Also the monthly data coverage matrix that fixes final F-A / F-B / F-C tier membership (FD3).
- R3. Release calendars and first-release timestamps (N15) for the targets and predictors, including euro-area flash CPI and GDP flash timing, and country GDP release lags.
- R4. Availability of first-release and revised vintages for realised targets (Q01, M06, M09, M01) from Eurostat, OECD revision tools, ALFRED and national agencies, to assess how well "first release vs mature" scoring (FD5) can be done and how pseudo-real-time backtests on revised data can be built.
- R5. Check whether Chicago Fed NFCI and ECB CISS are free to republish in a public non-commercial project (D23 sets non-commercial public use).
- R6. Whether CPB World Trade Monitor, Kiel Trade Indicator, EIA STEO and World Bank Commodity Markets Outlook are free, citable and stable.
- R7. Target table: central-bank inflation target and tolerance metadata per economy (numeric target, band or point, tolerance, target definition such as headline CPI vs HICP, effective dates and changes over time), as input for FT12 (FD8).
- R8. D23 consequences: confirm that manual WEO downloads (April, October only, FD7) are enough for B01/A03 benchmarks, and which WEO variables (unemployment, output) exist for each of the 42 countries.
- R9. Benchmark-archive import (FD6): for the one-off import of IMF Historical Forecasts Database, EC and OECD past forecasts, assess access and licence, file formats, edition dates, variables and countries covered, start years against 1991, and how editions are identified; confirm the import contains benchmark forecasts only. IMF archive handling follows D23 (manual).

## Sources cited (accessed 2026-10-17)
- European Commission, economic forecasts page: https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/economic-forecasts_en - two fully fledged forecasts (autumn, spring), plus winter and summer editions, some interim; country/variable list and downloads not stated on the page.
- ECB Survey of Professional Forecasters: https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/index.en.html - published four times a year; inflation, real GDP growth, unemployment for the euro area; point forecasts and probability distributions.
- IMF WEO page and the IMF Historical Forecasts Database: taken from the original document (WEO page, accessed 2026-10-11) and the project's source note docs/research/data-sources-g20-eu-cross-country.md (line 88, page-verified 11 Oct 2026); not re-fetched here.
- Not retrievable in this session: OECD Economic Outlook page (https://www.oecd.org/en/publications/serials/oecd-economic-outlook_16097408.html, HTTP 403). OECD statements are [UNVERIFIED].
- All other statements marked [UNVERIFIED] come from analyst background knowledge and were not fetched.
- User decisions FD1-FD9: given by the user on 2026-10-17 and relayed in the task message; no external source.
