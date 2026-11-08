---
status: approved   # approved by the user on 2026-10-17
scope: G20 (ex Russia, ex AU) + EU27 = 42 sovereign economies + EU27 and euro-area aggregates; tiered use (domain scorecards, early-warning, long-run growth); monthly refresh on day 1; history from 1991
date: 2026-10-11
updated: 2026-10-17   # user decisions D20-D23 applied; user re-approved with D20-D23 applied (stated in session, 2026-10-17)
---
# Cross-country indicator selection: growth, current situation, comparison (G20 + EU)

Access date for all URLs below: 2026-10-11. Claims not backed by a fetched page are labelled [UNVERIFIED] and come from analyst background knowledge; the researcher must confirm them.

## Decisions (set by the user; recorded 2026-10-11)

| # | Decision | Consequence in this document |
|---|---|---|
| D1 | African Union excluded; EU27 and euro area are aggregates only | Not in the country panel; aggregates carry no rank |
| D2 | Russia excluded | Panel = 42 countries + 2 aggregates (see Coverage); Russia risk notes removed |
| D3 | Rank all countries (option A); gaps left empty / n/a; no well-covered-subset restriction for now | Fairness caveat below; mitigation confirmed in D16 |
| D4 | History from 1991 onward | Long-run tier starts 1991; series starting later are accepted with gaps; longer sources (e.g. USDA ERS series from 1961/1970) are truncated to 1991+ |
| D5 | Licensed data allowed only if freely accessible or reachable through the user's university account (hneu.net); otherwise open sources only | Superseded in practice by D15 (university account coverage unknown, so free databases only) |
| D6 | Domain scorecards, no composite rank for now (optional later). Show latest value with reference date; exclude values older than a defined limit per indicator from rankings | Staleness limits confirmed in D14 |
| D7 | External indicators in USD, with currency fluctuations handled: market-rate USD for finance/trade size, PPP international dollars for living standards and growth comparisons, local currency for growth rates and inflation | "Currency basis rule" below |
| D8 | Environment/energy indicators are an optional tier for now | A19-A21 set to opt; other domains unaffected |
| D9 | Alert thresholds statistical, relative to each country's own history (z-score vs rolling window), with optional per-indicator overrides | Parameters set in D19 |
| D10 | Vintages: retain every release/revision as fetched from now on (going forward); NO backfill of historical real-time vintages | Real-time backtesting is not a requirement; see Vintage policy. Closed question. |
| D11 | Agriculture/food priority as recommended: only G01 (food CPI) is core; the other agri/food rows stay extended/optional as tagged | Counts unchanged (28 core) |
| D12 | The agriculture/food domain feeds the global early-warning view only, not country ranking; a scorecard for emerging economies is kept as informational and unranked | Scorecard table: Agri-food domain is unranked; G01 is still ranked inside the Prices scorecard because it is also a price indicator |
| D13 | USDA is not a required source; FAO, World Bank, OECD etc. may be used where they cover the 42 countries better; the researcher picks per indicator | USDA names in the catalog are hints only |
| D14 | Staleness limits confirmed as proposed: market data 45 days, surveys/PMI 75 days, monthly activity/prices/labour 120 days, quarterly 270 days, annual 24 months, triennial 4 years. History from 1991 is kept in full; the limits govern rankings only | Table in "Staleness limits"; limits never delete stored data |
| D15 | The user does not know what hneu.net covers: use freely accessible databases only. Licensed/V-flagged rows must have a free-source alternative, or be marked optional or dropped by the researcher | Lic = V rows are provisional; see Lic convention and researcher tasks |
| D16 | The coverage-count (n/N) plus percentile-rank mitigation for unequal coverage is confirmed; no imputation | Fairness caveat section below is now a confirmed rule, not a proposal |
| D17 | Core list confirmed: 28 indicators (15 monthly, 4 quarterly, 9 annual) | Priority summary below is confirmed |
| D18 | Output gap: the IMF estimate is the single headline series used for rankings; OECD and European Commission estimates are stored as separate comparison series and never mixed with the IMF series in one ranking | A02 (IMF, core) and A02b/A02c (OECD, EC, optional comparison) |
| D19 | Alert parameters: rolling window 20 years (240 months / 80 quarters); alert level |z| = 2.0. The user's reply was "20 years and 2.0"; the watch level was not restated, so 1.5 is kept but marked "pending user confirmation". The user did not object to the proposed robust z (median/MAD) for skewed series or to fixed-threshold overrides, so both stay as proposed | Alert rule below. Replaces the earlier 120 months / 40 quarters proposal |
| D20 | (2026-10-17) Free data only (D15 stands). Dropped: the PMI part of M03 (the free EC and OECD confidence surveys remain the survey indicators), M26 (sovereign risk spreads; the M18 yield spread is the free substitute), M20 (equities), A06 (sovereign ratings), M25 (policy uncertainty and VIX) | Rows marked dropped in the catalog; Markets scorecard reduced to M16; counts and V-flag list updated |
| D21 | (2026-10-17) A17 (business environment) and G13 (grain supply gap) dropped, as proposed in docs/research/data-sources-g20-eu-cross-country.md (sections on these items) | Rows marked dropped; removed from scorecards |
| D22 | (2026-10-17) A02 output gap stays core with thin emerging-economy coverage: the IMF series covers 25 of 42 countries (see the sources note, docs/research/data-sources-g20-eu-cross-country.md, F6). No mixing of sources in a ranking (D18 stands) | Ranking shows 25 countries on A02, the other 17 n/a; coverage n/N (D16) applies |
| D23 | (2026-10-17) The project is non-commercial and public. IMF data will not be bulk-downloaded by automation; the IMF WEO files are downloaded manually twice a year (April and October editions) | WEO-based annual rows (A01-A05, A02) refresh on the two manual downloads. IMF-sourced rows that would need automated IMF pulls (e.g. M14, Q05 via IMF dataflows) become a researcher question (non-IMF source or manual refresh) |

(Origin of the agri/food and USDA-related additions: user feedback 2026-10-11 that the draft lacked indicators used in USDA international analytics.)

### Vintage policy (D10)
From the first pipeline run, every release and revision is kept as fetched (value, reference period, release/vintage date). Historical real-time vintages are not backfilled. Consequence: early-warning backtests on pre-launch history use latest-revised data and must be labelled as such (revised-data bias, especially for GDP, IP, output gap). Where sources publish historical vintages (e.g. ALFRED, OECD or Eurostat revision databases [UNVERIFIED availability]), the researcher may note this as optional information only; it is not a requirement and not a selection criterion. Projection series (WEO, USDA ERS baseline to 2035) must carry a flag "projected" per observation and are never mixed with observed values in ranks or alert windows.

### Fairness caveat for D3 and confirmed mitigation (D16)
Ranking all 42 countries while leaving missing values as n/a means countries with thin monthly coverage (expected: China, India, Indonesia, Argentina, Saudi Arabia, South Africa, Turkiye, Brazil, Mexico [UNVERIFIED, researcher to confirm]) are ranked on fewer indicators than EU/OECD countries. Domain ranks are therefore not like-for-like. Confirmed mitigations (selection-level, not design): (a) display for each country and domain the number of indicators available out of those defined ("coverage n/N") next to every rank; (b) rank within a domain on the indicators actually available, never impute or zero-fill; (c) a domain with zero available fresh indicators shows "n/a" and no rank; (d) coverage is itself reported so the user can later introduce a minimum-coverage rule (option B) without redefining indicators. Percentile ranks are used rather than raw rank positions so that the differing number of ranked countries per indicator is comparable.

## Goals and analytical questions

Goal (set by user): a cross-country comparable indicator set describing each economy's growth and current situation, broad across economic, social, financial and other aspects, usable to compare countries.

Three use tiers (all required):
- U1 Dashboard/ranking: domain scorecards (no composite), where each country stands relative to peers.
- U2 Early-warning/risk monitor: where is stress building (overheating, external, fiscal, credit, market, food)?
- U3 Long-run growth analysis: what drives potential growth and convergence (from 1991)?

Refresh design principle: the pipeline runs on the 1st of each month. The "monthly core" holds natively monthly series. Quarterly and annual series form a labelled "context tier" and change only when a new release or revision arrives; most monthly runs will add no new context-tier observation. Consequence: every run must be an idempotent "what is new / revised since last run" diff, with vintages kept going forward (D10).

Timing fact: a run on the 1st sees data for the month before last for most activity series (lag 4-8 weeks), and the previous month only for fast series (market prices, PMIs/surveys, some HICP flashes).

Analytical questions by domain:
1. Growth/activity: Is output expanding? Is momentum accelerating? Is the economy above/below potential?
2. Prices/inflation: Is inflation pressure building? Broad-based (core) or driven by food/energy? Are expectations anchored?
3. Labour: Is slack tightening or loosening? Is the labour market deteriorating (early signal)?
4. External: Is the country dependent on external financing? Is competitiveness eroding? Reserves adequate?
5. Fiscal/public debt: Is debt sustainable? Is the deficit narrowing? Is the sovereign priced as risky?
6. Monetary/financial conditions: Is policy tight or loose in real terms? Are financial conditions easing?
7. Financial stability/credit: Is credit growing unsustainably? Are banks resilient? Are house prices overvalued?
8. Markets: Are equities, FX, sovereign spreads signalling stress or confidence?
9. Social/demographic/inequality/health/education: Is growth translating into living standards and inclusion? What is the demographic headwind?
10. Structural/productivity/institutions: How strong are long-run growth drivers?
11. Environment/energy (optional tier, D8): energy dependence, carbon intensity, transition exposure.
12. Agriculture and food security (global early-warning view, unranked, D12): Are food prices putting pressure on households and inflation? Is the world exposed to food/fertilizer price shocks or supply shortfalls (weather, stocks)? Which emerging economies are most food-import dependent and least food-affordable? Is agricultural productivity growing?

## Coverage (economies / aggregates, history depth, frequencies)

### Economies (explicit list; recounted after D1/D2)
G20 has 21 members: 19 sovereign countries + European Union + African Union (AU joined as a permanent member in 2023; [UNVERIFIED in this session, confirm at https://www.g20.org]). AU is excluded (supranational body, not a country; D1). EU is an aggregate only (D1). Russia is excluded (D2).

G20 sovereigns in panel (18): Argentina, Australia, Brazil, Canada, China, France*, Germany*, India, Indonesia, Italy*, Japan, Mexico, Saudi Arabia, South Africa, South Korea, Turkiye, United Kingdom, United States. (* also EU member.) The original 19 minus Russia = 18.

EU27 (27): Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France*, Germany*, Greece, Hungary, Ireland, Italy*, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden. (* also G20.)

Overlap verified: exactly 3 countries (France, Germany, Italy) are in both lists. Non-EU G20 countries in the panel = 18 - 3 = 15: Argentina, Australia, Brazil, Canada, China, India, Indonesia, Japan, Mexico, Saudi Arabia, South Africa, South Korea, Turkiye, United Kingdom, United States (count: 15, checked). Total countries = 27 + 15 = 42. Panel units = 42 countries + 2 aggregates (EU27, euro area) = 44; aggregates are shown but not ranked.

Metadata sub-groupings (not indicators): euro-area membership (Bulgaria [UNVERIFIED] joined 1 Jan 2026, giving 21 members; confirm via https://www.ecb.europa.eu), non-euro EU (Czechia, Denmark, Hungary, Poland, Romania, Sweden), advanced vs emerging (IMF WEO classification; defines the informational agri scorecard group, D12), G7 (Canada, France, Germany, Italy, Japan, UK, US), commodity exporters, major agricultural exporters/importers (for the agri domain).

History depth (D4, D14): from 1991 onward for all tiers, kept in full; staleness limits do not truncate history. Notes: many panel economies (Baltics, Czechia, Slovakia, Slovenia, Croatia, Poland, Hungary, Romania, Bulgaria) have official series only from the mid-1990s or later, and German data before 1991 refer to West Germany [UNVERIFIED] so 1991 is also a natural break; euro-area aggregates change composition over time (use fixed-composition vs changing-composition variants consistently).

Coverage quality varies: EU and OECD members (about 35 of 42 [UNVERIFIED count]) have rich monthly data via Eurostat/OECD; China, India, Indonesia, Argentina, Saudi Arabia, South Africa, Brazil, Turkiye have partial monthly coverage with different definitions. Gaps are left as n/a (D3, D16).

## Cross-cutting rules from decisions

### Currency basis rule (D7)
Every indicator carries one of three bases; do not mix them:
- B1 Local currency / index / ratio: growth rates (real GDP, IP, retail), inflation, YoY changes, percentages of GDP, shares. These are not converted to USD (conversion would import FX noise into growth rates).
- B2 Market-rate USD: size and flows for finance and trade (trade values, reserves, external debt levels, nominal GDP as a size weight). Convert at period-average rates for flows and end-period rates for stocks (flows vs stocks convention is a researcher check). To handle currency fluctuations: also publish the same series in local currency or as % of GDP so valuation moves can be distinguished, and report constant-exchange-rate change where the source offers it (BIS, IMF) [UNVERIFIED availability]. Constant-price USD at market rates (e.g. the USDA ERS dataset in billions of 2017 dollars, see A25) is a B2 variant: real, but still market-rate based, so not a living-standards measure.
- B3 PPP international dollars: living standards and cross-country growth/level comparisons (GDP per capita PPP, productivity). PPP benchmark revisions (ICP rounds) shift levels; vintages must not be compared across benchmark rounds.
Ratios to GDP (current account, debt, deficit) stay in % of GDP computed within the source's own currency, avoiding USD conversion.

### Staleness limits (D6, confirmed in D14)
Each ranked value is shown with its reference period. A value is excluded from rankings (still displayed, marked stale, and still stored) if its age (run date minus end of reference period) exceeds:

| Native frequency | Limit (confirmed) | Rationale |
|---|---|---|
| Daily/monthly market data (yields, FX, equities, policy rates, commodity prices) | 45 days | available within days; stale means broken feed |
| Monthly survey/confidence/PMI | 75 days | published within about 1 month |
| Monthly activity/prices/labour (IP, retail, CPI, unemployment, trade) | 120 days (about 4 months) | typical lag 1-2 months plus 2 months tolerance for slow reporters |
| Quarterly (GDP, current account, credit gap, debt) | 270 days (about 3 quarters) | lag up to 3-4 months plus one missed quarter |
| Annual (fiscal, demography, inequality, WGI, structural, agri structural) | 24 months (730 days) | lags of 1-2 years are normal |
| Triennial/irregular (PISA, poverty surveys, inequality surveys, FAO 3-year-average undernourishment) | 4 years | by design |
| Event-type (ratings) | 24 months without action: show as "unchanged" (my proposal, not covered by D14) | not stale in the same sense. No longer applies to any active row after D20 (A06 dropped); kept for reference |

Exclusion is per indicator and per country; the domain scorecard falls back to the remaining indicators and shows coverage n/N (D16). Per-indicator overrides remain possible if the user later requests them. Limits govern rankings only (D14); the stored history from 1991 is complete.

### Alert rule (D9, parameters set by D19)
Statistical alerts are based on each country's own history: the z-score of the transformed indicator against a rolling window of 20 years (240 monthly observations, 80 quarterly observations, 20 annual observations), using only history from 1991 onward (D4).

- Alert level (user-confirmed, D19): |z| >= 2.0, with the adverse direction defined per indicator.
- Watch level: |z| >= 1.5. Pending user confirmation: the user's reply ("20 years and 2.0") did not restate it.
- Skewed or fat-tailed series (inflation, spreads, FX, credit growth, food and fertilizer prices): robust z (median and MAD) or percentile of the own-history distribution, as proposed; the user did not object (D19).
- Fixed-threshold overrides per indicator (e.g. debt/GDP 60/90 percent, PMI 50, reserves cover 3 months, inflation vs target band), stored with their rationale, as proposed; the user did not object (D19).

Short-series rule (proposal for the user to confirm): a series with less than the full window uses all available history from 1991 (or the series start) under a minimum-observations rule, and its alerts are flagged "low confidence":
- Monthly: no alert below 60 observations (5 years); "low confidence" between 60 and 239 observations.
- Quarterly: no alert below 20 observations (5 years); "low confidence" between 20 and 79.
- Annual: no alert below 10 observations; "low confidence" between 10 and 19.
- Full confidence only with a complete 20-year window.

Notes and caveats:
- A 1991 start gives at most 35 years of data in 2026, enough for a 20-year window for most long-running series; EU-accession and emerging economies, series that start in the mid-1990s or later, and short survey or derived series will often fall into "low confidence".
- With a rolling 20-year window, the 1991-2006 history is not used for z-scores of series with a full window (it still serves long-run analysis, U3).
- The window includes 2008, 2020 and 2022-type shocks, which widen the standard deviation and make |z| >= 2 rarer; structural breaks (euro adoption, inflation-targeting regimes, hyperinflation in Argentina/Turkiye) distort a country's own history.
- A rolling window normalises a long persistent deterioration, so slow-moving risks (debt, credit gap) may need absolute reference levels (overrides).
- Because of D10, alert history computed on pre-launch periods uses revised data. Projected values (WEO, USDA baseline) are excluded from windows.

## Indicator catalog

Conventions: Class = lead/coincident/lag. Priority: core / ext / opt / dropped (dropped by user decision D20/D21; row kept for traceability, not collected). Lic (updated for D15): F = free/open (expected). V = licence or availability uncertain; provisional until the researcher finds a free-source alternative, otherwise the row becomes optional or is dropped (no reliance on the hneu.net university account). Lags typical [UNVERIFIED] unless noted. Currency basis (B1/B2/B3) given where relevant. Scorecard (SC) domain membership is given in the section "Domain scorecards". Tier: M monthly, Q quarterly, A annual. Source names in the last column are hints only (D13).

### A. Monthly tier (M and agri-monthly G)

| ID | Indicator | Question served | Definition | Class | Frequency | Transformation | Coverage | Revision/lag notes (run effect) | Priority | Lic | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M01 | Industrial production index (excl. construction) | Growth | Volume index of mining, manufacturing, utilities | Coinc | Monthly | YoY, 3m/3m annualized SA (B1) | Nearly all; patchy China (value-added growth only), Argentina, Saudi | Lag ~4-8 wks; revised; SA vs NSA mixes. Adds 1 obs, revises 1-3 | core | F | Eurostat, OECD MEI, national, IMF IFS |
| M02 | Retail trade volume | Domestic demand | Volume index of retail sales | Coinc | Monthly | YoY, 3m/3m (B1) | EU, OECD, major EMs partial | Lag ~4-6 wks; some nominal only; flag nominal vs real | core | F | Eurostat, OECD, national |
| M03 | Business-confidence survey (EC ESI, OECD BCI). The PMI part (manufacturing/services/composite, S&P Global) is DROPPED (D20) | Momentum/early warning | Survey diffusion/balance index; free sources EC ESI, OECD BCI | Lead | Monthly | Level, own-history z (no 50-neutral PMI override: PMI dropped) | EC ESI EU only; OECD BCI broader | Freshest data in run; seldom revised (SA factors revised). Free EC/OECD confidence surveys are the survey indicators (D20) | core | F (PMI part dropped, D20) | EC BCS, OECD |
| M04 | Consumer confidence | Demand outlook | Survey balance | Lead | Monthly | Level, own-history z | EU, OECD, several EMs | Rarely revised; levels not comparable across countries, use z only | core | F | EC BCS, OECD CCI |
| M05 | OECD Composite Leading Indicator | Turning points | Amplitude-adjusted CLI, 100 = trend | Lead | Monthly | Level, 6m change | OECD + major partners | Lag ~1-2 months; revised each release. OECD methodology page was HTTP 403 - unverified | ext | F | OECD |
| M06 | Headline CPI / HICP inflation | Prices | HICP is the EU harmonised CPI under a single set of definitions (https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Glossary:Harmonised_index_of_consumer_prices_(HICP)) | Coinc/lag | Monthly | YoY, 3m annualized SA, gap to target (B1) | All; HICP for EU27, national CPI elsewhere | Lag ~2-6 wks (EU flash at month-end); rarely revised | core | F | Eurostat, OECD, national, IMF |
| M07 | Core inflation (ex food, energy) | Underlying pressure | CPI excl. food, energy (definition varies) | Lag | Monthly | YoY, 3m annualized (B1) | EU, OECD; EMs partial | As M06 | core | F | Eurostat, OECD |
| M08 | Industrial producer prices | Pipeline | Output price index | Lead | Monthly | YoY (B1) | EU, OECD, EMs partial | Lag ~4-6 wks; revised | ext | F | Eurostat, OECD |
| M09 | Unemployment rate | Labour | ILO-definition share of labour force (ILO page HTTP 403: unverified) | Lag | Monthly | Level, 12m change | EU, OECD; China urban surveyed; Brazil, Mexico, South Africa etc. partly quarterly | Lag 1-2 months; EU monthly values partly model-based from LFS; SA; revised | core | F | Eurostat, OECD, ILOSTAT |
| M10 | Youth unemployment (<25) | Labour slack | As M09, age 15/16-24 | Coinc | Monthly | Level | EU, OECD | Noisy | ext | F | Eurostat, OECD |
| M11 | Employment level/rate (monthly) | Labour | Persons employed | Coinc | Monthly (subset) | YoY | US/JP/CA/AU monthly, EU quarterly | Subset only; Q03 fallback | opt | F | OECD, national |
| M12 | Merchandise exports and imports | External | Customs-basis goods trade | Coinc/lead | Monthly | YoY in local currency or volume where available (B1); size in USD (B2); balance % of GDP | Nearly all; intra-EU trade for EU members | Lag ~4-8 wks; mirror asymmetries; USD conversion adds FX noise (D7) | core | F | UN Comtrade, IMF DOTS, Eurostat, national |
| M13 | Goods trade balance / monthly current account | External sustainability | Net goods trade | Coinc | Monthly | 12m rolling sum % GDP (B1) | Goods broad; CA monthly subset | CA mostly Q05 | ext | F | national, ECB |
| M14 | Official FX reserves | External vulnerability | Reserve assets incl. gold | Coinc | Monthly | USD level (B2), months of imports, % of GDP | All central banks (SDDS) | Lag ~1 month; valuation effects (FX, gold). Source routing under D23: no automated IMF pulls | core | F | IMF IFS/COFER (manual only, D23), national |
| M15 | Real effective exchange rate | Competitiveness | Trade-weighted CPI-based index | Lead/coinc | Monthly | 12m % change, deviation from own average (B1) | BIS broad | Lag ~1 month; weights revised | core | F | BIS |
| M16 | Exchange rate vs USD | Markets | Month-average and end-month | Coinc | Daily/monthly | 12m % change, volatility (B1) | All | No revision | core | F | ECB, BIS, central banks |
| M17 | Policy interest rate | Monetary stance | CB main rate | Policy | Monthly | Level, real rate (policy minus core YoY), 12m change | All | Immediate; euro area members share ECB rate | core | F | BIS, national CBs |
| M18 | 10-year government bond yield and spread vs Germany/US | Sovereign risk | Benchmark 10y yield, monthly average | Lead | Monthly | Level, spread, 12m change | Nearly all; Argentina, Saudi limited | Benchmark definitions vary slightly. Free substitute for the dropped M26 (D20) | core | F | ECB, OECD, national, FRED |
| M19 | Short-term interbank rate | Money market | 3m rate | Coinc | Monthly | Level, term spread | OECD+ | LIBOR transition breaks | ext | F | OECD, FRED |
| M20 | Equity index (broad national) | Markets | Month-end level | Lead | Daily/monthly | DROPPED (D20) | | | dropped (D20) | n/a | |
| M21 | Private-sector bank credit growth | Fin. stability | Monetary survey aggregates | Lead | Monthly | YoY, real YoY (B1) | Euro area/EU, UK, US, Japan, major EMs partial | Lag ~1 month; reclassification breaks | ext | F | ECB, national CBs |
| M22 | Broad money (M2/M3) | Liquidity | Broad money | Lead | Monthly | YoY (B1) | Most | Scope varies; weak signal | opt | F | ECB, IMF IFS |
| M23 | (placeholder; moved to Q07 residential property prices) | | | | | | | | | | |
| M24 | Commodity and energy prices: Brent, gas, food index | Inflation/energy | Monthly average benchmark | Lead | Monthly | YoY in USD (B2, global factor); local-currency translation per country | Global (not per country) | No revision. Overlaps G02 (food and fertilizer sub-indices): M24 keeps energy and the headline food index, G02 the agricultural detail | core | F | World Bank Pink Sheet, EIA, FAO, IMF |
| M25 | Policy uncertainty / global risk (EPU, VIX) | Risk | Index | Lead | Monthly | DROPPED (D20) | | | dropped (D20) | n/a | |
| M26 | Sovereign CDS / EMBI spread | Sovereign risk | Spread | Lead | Daily/monthly | DROPPED (D20); M18 spread is the free substitute | | | dropped (D20) | n/a | |
| M27 | Electricity generation/consumption proxy | Activity nowcast | Electricity | Coinc | Monthly | YoY | Patchy | Experimental | opt | F | Ember, IEA |
| G01 | Food CPI / HICP food and non-alcoholic beverages | Food price pressure, household affordability | Food sub-index of consumer prices (HICP food component for EU27; national CPI food elsewhere). USDA ERS also publishes food CPI series [UNVERIFIED: ERS food CPI page could not be fetched] | Coinc/lag | Monthly | YoY, 3m annualized SA, contribution to headline, food minus core gap (B1) | EU27 full; OECD broad; EMs partial (China, India, Indonesia, Brazil, Turkiye usually available [UNVERIFIED]) | Same release as M06 (no extra fetch lag); food weights in CPI differ strongly across countries (higher in EMs); rarely revised. Component of M06. Core (D11); ranked within the Prices scorecard (D12) | core | F | Eurostat, OECD, national, IMF, FAO, ERS (hint) |
| G02 | Agricultural and fertilizer commodity prices: grains (wheat, maize, rice), soybeans, vegetable oils, sugar, fertilizer index (urea, DAP, potash) | Imported food/input cost shocks | World benchmark monthly prices (global factor, same for all countries); FAO Food Price Index and World Bank agriculture/fertilizer sub-indices as candidates | Lead | Monthly | YoY in USD (B2), YoY in local currency per country (B1 translation), 20y rolling z (D19) | Global; country exposure weights via G09/G10/G15 | No revision; overlaps M24 (headline food index) | ext | F | World Bank Pink Sheet, FAO, IMF, USDA (hint) |
| G03 | Stocks-to-use ratio for wheat, coarse grains, rice, oilseeds (world and major producers/importers) | Supply tightness / food price risk | Ending stocks divided by total use, from supply-and-demand balances (USDA PSD / WASDE; alternatives e.g. AMIS, FAO [UNVERIFIED]). The PSD Online landing page returned no descriptive content and the WASDE page returned HTTP 403, so contents and the monthly WASDE schedule are [UNVERIFIED]; ERS says the International Baseline's latest projections reflect conditions as of the October 2024 WASDE (https://ers.usda.gov/data-products/international-baseline-data, accessed 2026-10-11) | Lead | Monthly estimates (marketing-year balances) [UNVERIFIED] | Level, own-history z, change vs previous estimate | World aggregate plus selected major countries - not a full 42-country series | Estimates are revised each month for current and next marketing year; marketing year differs from calendar year and by crop and country; store each monthly estimate as a vintage (fits D10) | ext | F | USDA FAS PSD, USDA WASDE, AMIS, FAO (hint) |
| G04 | Agricultural trade balance (agri-food exports minus imports) | External, food import dependence | Goods trade in agricultural products (HS chapters 1-24 or WTO definition) | Coinc | Monthly | 12m sum, % of total goods trade and % GDP (B1); size in USD (B2) | Derivable for all from M12 data by HS chapter | Needs product-level trade; same lags as M12; definition of "agricultural" differs by agency (USDA FATUS excludes fertilizers, agricultural machinery, seafood, forest products; search result for https://ers.usda.gov/data-products accessed 2026-10-11); overlaps M12 | ext | F | UN Comtrade, Eurostat, WTO, national |
| G05 | Real trade-weighted agricultural exchange rate index | Agri competitiveness | ERS nominal and real exchange rates and real trade-weighted commodity exchange-rate indexes, with agricultural trade weights; 79 countries plus EU, monthly and annual, released quarterly, from 1970 (https://ers.usda.gov/data-products/agricultural-exchange-rate-data-set, accessed 2026-10-11; page does not state base year) | Lead/coinc | Monthly (released quarterly) | 12m % change, deviation from own average (B1) | 79 countries + EU: probably most of the 42 [UNVERIFIED country list] | Quarterly release; overlaps M15 (BIS REER) - use M15 as default, this only as an agricultural-weighted variant | opt | F | USDA ERS |
| G06 | Weather and drought anomalies in cropland (precipitation/temperature anomaly, Standardized Precipitation Index, vegetation index) | Harvest risk | Gridded weather indices aggregated to country cropland | Lead | Monthly (dekadal/daily underlying) | Anomaly, own-history z (B1) | Global gridded; country aggregation required | No revision for observed; reanalysis revisions; USDA FAS crop-condition/weather products are candidates [UNVERIFIED] | opt | F | USDA FAS IPAD, NOAA, Copernicus (hint) |

### B. Quarterly context tier (Q)

Run effect: at most one new observation per quarter plus revisions to the previous 1-4 quarters; a monthly run looks for new vintages, not for new data.

| ID | Indicator | Question served | Definition | Class | Frequency | Transformation | Coverage | Revision/lag notes | Priority | Lic | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | Real GDP (volume, SA) | Growth | GDP at constant prices (SNA/ESA vintages [UNVERIFIED]) | Coinc | Quarterly | QoQ SA annualised, YoY (B1) | All; NSA-only conventions in some EMs | First estimate ~30-45 days after quarter end; revisions over years | core | F | Eurostat, OECD QNA, IMF IFS, national |
| Q02 | Real GDP per capita, PPP | Living standards | Q01 per capita, PPP intl $ (B3) | Coinc | Q/A | YoY | All | Population and PPP revisions | ext | F | OECD, WB |
| Q03 | Employment, hours worked | Labour | Persons / hours | Coinc | Quarterly | YoY | EU, OECD, EMs partial | Lag ~2-3 months | ext | F | Eurostat, OECD |
| Q04 | Expenditure components (consumption, GFCF, net exports) | Growth composition | Contributions to growth | Coinc | Quarterly | contribution to YoY (B1) | OECD/EU, EMs partial | As Q01 | ext | F | Eurostat, OECD |
| Q05 | Current account balance % of GDP | External | BPM6 current account | Lag | Quarterly | 4q sum % GDP (B1); USD level for size (B2) | All (IMF BOP) | Lag ~1.5-3 months; revised. Source routing under D23: no automated IMF pulls (use Eurostat/OECD/national or manual refresh; researcher to advise) | core | F | Eurostat, OECD, national; IMF BOP (manual only, D23) |
| Q06 | Credit to private non-financial sector % of GDP and credit-to-GDP gap | Fin. stability | BIS standardised credit; gap vs trend | Lead | Quarterly | % GDP, gap | BIS ~40+ economies | Lag ~3-4 months; one-sided HP filter (recomputation causes revisions) | core | F | BIS |
| Q07 | Residential property prices (real) | Fin. stability | House price index deflated | Lead | Quarterly (few monthly) | YoY real (B1) | EU, OECD, BIS broad | Methods vary | ext | F | BIS, Eurostat, OECD |
| Q08 | General government gross debt % of GDP | Fiscal | Maastricht (EU) vs IMF GGGD | Lag | Quarterly (EU, some OECD) | % GDP, 4q change (B1) | EU quarterly; others annual | Scope differences | core | F | Eurostat, IMF, OECD |
| Q09 | Net international investment position % GDP | External | NIIP | Lag | Quarterly | % GDP | Most | Valuation-driven | ext | F | IMF, Eurostat |
| Q10 | External debt; short-term external debt vs reserves | External (EM) | Gross external debt | Lag | Quarterly | USD level (B2), % GDP, % reserves | EM mostly | Coverage differs | ext | F | World Bank QEDS, BIS |
| Q11 | Banking soundness: NPL ratio, Tier 1 capital | Fin. stability | FSIs | Lag | Quarterly | Level | IMF FSI broad; EBA/ECB for EU | Lag 2-4 months | ext | F | IMF FSI, ECB, EBA |
| Q12 | Government net lending % of GDP | Fiscal | ESA / GFS | Coinc | Quarterly (EU) | 4q sum % GDP | EU quarterly; others annual | Scope differences | ext | F | Eurostat, OECD |
| Q13 | Household debt % of GDP | Fin. stability | Debt of households and NPISH | Lag | Quarterly | % GDP | BIS, OECD, EU | Fairly comparable via BIS | opt | F | BIS, OECD |
| Q14 | Inflation expectations | Prices | Survey or market-based | Lead | M/Q | Level | Euro area, US, UK, some | Concepts differ; Consensus licensed | opt | V (free central-bank/EC surveys only; else drop) | ECB, central banks, EC |
| Q15 | Labour productivity (GDP per hour) | Structural | GDP per hour | Lag | Q/A | YoY, PPP level (B3) | OECD/EU | Hours data weak in EMs | ext | F (OECD); Conference Board version dropped under D15 unless free | OECD |
| Q16 | Unit labour costs | Competitiveness | Compensation / productivity | Lag | Quarterly | YoY | OECD/EU | Revised | opt | F | OECD, Eurostat |
| Q17 | Agriculture gross value added, volume (quarterly national accounts, sector A) | Agri output | Real GVA of agriculture, forestry, fishing | Coinc | Quarterly | YoY (B1) | EU, OECD; EMs partial | Lag as Q01; strongly seasonal and weather-driven; overlaps Q01 (component) | opt | F | Eurostat, OECD, national |

### C. Annual context tier (A and agri-annual G)

Run effect: values change once or twice per year. IMF WEO is published in April and October with January/July updates (https://www.imf.org/en/Publications/WEO, accessed 2026-10-11). Treat each annual vintage as an event. Under D23 the WEO files are downloaded manually in April and October (no automated IMF pulls); the January/July updates are not assumed to be ingested unless the user says so.

| ID | Indicator | Question served | Definition | Class | Frequency | Transformation | Coverage | Revision/lag notes | Priority | Lic | Candidate sources (hint) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A01 | GDP per capita PPP (intl $) and ratio to US | Size/convergence | PPP-converted GDP (B3) | Structural | Annual | Level, ratio to US, log; USD market GDP as size weight (B2) | All | Level shifts at each ICP round; do not compare across rounds. USDA ERS International Macroeconomic Data Set offers real GDP and GDP per capita in billions of 2017 dollars (market-rate basis, B2 variant) as a cross-check only (see A25) | core | F | IMF WEO (manual download, D23), WDI, Penn World Table, USDA ERS (cross-check) |
| A02 | Output gap / potential growth, IMF estimate (headline, D18) | Cycle vs trend | Gap between actual and potential output as estimated by the IMF (WEO); the single series used in rankings | Coinc | Annual (with forecasts) | % of potential | IMF WEO covers 25 of 42 panel countries (D22; sources note F6); the other 17 are n/a. Thin for emerging economies; no other source is mixed into the ranking | Model-based and unobservable; heavily revised; keep WEO vintage ID (Apr/Oct); forecast years flagged "projected"; refreshed on the manual twice-yearly WEO download (D23) | core | F | IMF WEO (manual download) |
| A02b | Output gap, OECD estimate (comparison series) | Cycle vs trend (cross-check) | OECD Economic Outlook estimate of the output gap | Coinc | Semi-annual | % of potential | OECD members only | Stored separately, never mixed with A02 in one ranking (D18); OECD methodology page not fetched (HTTP 403 earlier for other OECD pages) | opt | F | OECD Economic Outlook |
| A02c | Output gap, European Commission estimate (comparison series) | Cycle vs trend (cross-check) | EC (AMECO) estimate of the output gap | Coinc | Semi-annual | % of potential | EU27 (and some other economies) | Stored separately, never mixed with A02 in one ranking (D18) | opt | F | EC AMECO |
| A03 | WEO forecasts: growth, inflation, current account, fiscal balance (current and next year) | Forward view | Official projections | Lead | Semi-annual | Level (B1) | All panel economies | Keep vintage ID (Apr/Oct, Jan/Jul updates). Manual WEO download twice a year (D23). USDA ERS IMDS projections to 2035 are a secondary cross-check | core | F | IMF WEO (manual download) |
| A04 | General government balance and primary balance % of GDP | Fiscal | GFS/ESA net lending | Coinc | Annual | % GDP | WEO all | Fiscal-year vs calendar-year (India, Australia, Japan etc.); revised | core | F | WEO (manual download, D23), Eurostat |
| A05 | Gross government debt % of GDP | Fiscal | General vs central government scope | Lag | Annual | % GDP, r-g, stabilising primary balance | WEO; some central only [UNVERIFIED] | Needs M18 and nominal growth | core | F | WEO (manual download, D23), Eurostat |
| A06 | Sovereign credit rating | Risk | Long-term foreign-currency rating, numeric scale | Lag | Event | DROPPED (D20) | | | dropped (D20) | n/a | |
| A07 | Gross fixed capital formation % of GDP | Growth drivers | GFCF share | Structural | Annual | % GDP | All | Quarterly in Q04 | ext | F | WDI, OECD |
| A08 | Gross national saving % of GDP | External drivers | Saving | Structural | Annual | % GDP | WEO | | opt | F | WEO |
| A09 | Total factor productivity growth (whole economy) | Structural | Residual growth | Structural | Annual | 5y average | PWT, AMECO | Model-dependent; distinct from agricultural TFP (G07) | ext | F | PWT, AMECO |
| A10 | Population, working-age share, old-age dependency | Demography | UN WPP | Structural | Annual | Level, 10y projected change | All | UN WPP revised every ~2 years [UNVERIFIED]; USDA ERS IMDS also carries population and growth | core | F | UN WPP, WDI |
| A11 | Life expectancy at birth | Health | Period life expectancy | Lag | Annual | Level | All | | core | F | WHO, Eurostat, WDI |
| A12 | Health expenditure % GDP | Social | Current health expenditure | Structural | Annual | % GDP | WHO GHED | Lag ~2 years | opt | F | WHO |
| A13 | Educational attainment (tertiary share 25-34), PISA, schooling years | Human capital | | Structural | Annual / 3-yearly | Level | OECD+; PISA covers many; China only subnational [UNVERIFIED] | Non-participation breaks panel | ext | F | OECD, UNESCO UIS |
| A14 | Income inequality: Gini (disposable), S80/S20, poverty rate | Inclusion | Equivalised disposable income | Structural | Annual | Level | EU-SILC, OECD IDD, WB PIP for EMs | Income vs consumption surveys not comparable | core | F | Eurostat, OECD, WB PIP |
| A15 | Human Development Index | Well-being | Composite | Structural | Annual | Level | All | Redundant with A01/A11/A13 | opt | F | UNDP |
| A16 | Worldwide Governance Indicators (six dimensions: voice and accountability, political stability, government effectiveness, regulatory quality, rule of law, control of corruption). Annual, >200 economies, 1996-2025, 35 sources (https://www.worldbank.org/en/publication/worldwide-governance-indicators, accessed 2026-10-11) | Institutions | Perception composites | Structural | Annual | Level, percentile, own z | All | Large margin of error; WGI starts 1996 (not 1991) | core | F | World Bank |
| A17 | Business environment (B-READY; WEF) | Institutions | Composite | Structural | Annual | DROPPED (D21) | | | dropped (D21) | n/a | |
| A18 | Export complexity, FDI inflows % GDP | Structural | | Structural | Annual | Level | All | | opt | F | Atlas, UNCTAD |
| A19 | Energy import dependence; energy intensity; electricity mix | Energy (optional tier, D8) | | Structural | Annual | % | All | Lag ~1 year | opt | F | Eurostat, IEA, EI |
| A20 | GHG emissions per capita and per GDP | Environment (optional tier, D8) | Territorial emissions | Structural | Annual | Level, 5y change | All; EDGAR/GCP vs UNFCCC differ | Lag 1-2 years | opt | F | EDGAR, GCP, UNFCCC |
| A21 | Renewable share of electricity | Environment (optional tier, D8) | | Structural | Annual | % | Broad | | opt | F | Ember |
| A22 | Poverty headcount; labour force participation | Social | | Structural | Annual | Level | EMs | Survey-based irregular years | ext | F | WB PIP, ILOSTAT |
| A23 | R&D % GDP, patents | Structural | | Structural | Annual | % GDP | OECD+ | | opt | F | OECD, WIPO |
| A24 | Cyclically adjusted primary balance | Fiscal | Model-based | Structural | Annual | | EU/OECD | Method-dependent | opt | F | EC, IMF |
| A25 | GDP deflator inflation (and real GDP share of world) | Prices, size | GDP deflator and growth, real GDP shares: both are in the USDA ERS International Macroeconomic Data Set (series: real GDP and growth, real GDP per capita and growth, GDP deflator and growth, real GDP shares, real exchange rate, CPI, population; 181 countries; 1970-2035 combining history and projections; base year 2017; annual; XLSX removed 27 May 2026, CSV remains; https://ers.usda.gov/data-products/international-macroeconomic-data-set, accessed 2026-10-11) | Coinc/lag | Annual | GDP deflator YoY (B1); world share of real GDP (B2 constant-2017 USD) | All | Gap in the first draft: broad-based (non-consumer) price measure and size share. Overlaps M06, A01 and A10; GDP deflator is also obtainable from IMF WEO/OECD/WDI, USDA is a candidate, not required (D13). Page notes last-updated dates of individual files (1/8/2026 to 4/1/2026) and that values to 2035 are projections: flag "projected" | ext | F | IMF WEO (manual, D23), WDI, OECD, USDA ERS |
| A26 | Household consumption per capita and food/alcohol/tobacco share of consumer spending | Living standards, affordability | USDA ERS International Food and Alcoholic Beverage Expenditure Data (food including non-alcoholic beverages as a share of consumer expenditure on all goods and services; per-capita food expenditures and per-capita consumer expenditures, current US dollars; 104 countries; https://ers.usda.gov/data-products/international-food-and-alcoholic-beverage-expenditure-data, accessed 2026-10-11; years and frequency not stated on the page) | Structural | Annual | Share (B1); per capita in USD market rates (B2) and in PPP where available (B3) | 104 countries (list not shown; panel coverage [UNVERIFIED]) | Share falls with income (Engel pattern, page statement); use the share as an affordability/welfare proxy, not as a ranking of "good" or "bad" without income control. Also see G11 (same data) | opt | F | USDA ERS, national accounts, WDI, Eurostat/OECD household budget data |
| G07 | Agricultural total factor productivity (TFP) index, with output and input indices (land, labor, capital, materials) | Structural agri productivity | USDA ERS growth-accounting TFP: output relative to all inputs, covering all inputs and commodities; index 2015 = 100, 1961-2023, internationally comparable growth rates, not levels; sources mainly FAO and ILO; updated 1/27/2026; annual schedule not stated (https://ers.usda.gov/data-products/international-agricultural-productivity, accessed 2026-10-11) | Structural | Annual | 5y/10y growth rate; index not comparable in level across countries; cut to 1991+ (B1) | Countries, regions, income groups, world; panel coverage [UNVERIFIED but likely complete] | Series revised with each update and lags ~2-3 years (1961-2023 in a 2026 update); distinct from A09 (whole-economy TFP) and Q15 (labour productivity) | ext | F | USDA ERS (no obvious alternative identified) |
| G08 | Cereal yield (kg/ha) and agricultural value added per worker | Productivity | Output per hectare; agri VA per worker (constant prices, PPP for cross-country level B3) | Structural | Annual | Level, 5y growth; B3 for PPP VA/worker | All | FAO/WDI lag ~1 year; yields volatile with weather: use 3-5y averages; overlaps G07 and Q15 | ext | F | FAOSTAT, World Bank WDI |
| G09 | Agriculture value added % GDP and employment share in agriculture | Structure | Sector shares | Structural | Annual | % (B1) | All | National accounts and LFS differences; informal agriculture counted differently; overlaps Q17 | ext | F | WDI, ILOSTAT, OECD |
| G10 | Cereal import dependency / self-sufficiency ratio | Food supply exposure | Production divided by domestic use (or net imports as a share of supply) for cereals, from supply-and-demand balances (USDA PSD or FAO food balance sheets). The PSD page fetched no descriptive content; per an ERS search result PSD contains official USDA production, supply and distribution data for the US and major importing and exporting countries (https://ers.usda.gov/data-products, search result accessed 2026-10-11) | Structural | Annual (marketing year) | Ratio (B1); trade value in USD (B2) | PSD: major producers/traders (not necessarily all 42); FAO food balance sheets broader [UNVERIFIED] | Marketing-year vs calendar-year; revised monthly during the year and finalised later; ratio over 100 percent for exporters | ext | F | FAOSTAT food balance sheets, USDA FAS PSD |
| G11 | Food expenditure share of household spending (affordability) | Food affordability | Same as A26: ERS expenditure shares, 104 countries, current USD per capita; the ERS International Food Consumption Patterns (144 countries, 2005 base) is discontinued and excluded | Structural | Annual | Share (B1) | 104 countries | See A26 (duplicate: keep one row in the data design; this ID is the agri-scorecard membership of A26) | ext | F | USDA ERS, national statistics |
| G12 | Prevalence of undernourishment and moderate/severe food insecurity (FIES) | Food security outcome | FAO SOFI indicators (3-year averages for undernourishment) [UNVERIFIED]. The USDA ERS International Food Security data page lists grain demand and supply-gap indicators, not food-insecurity prevalence, and it does not define food insecurity (https://ers.usda.gov/data-products/international-food-security, accessed 2026-10-11) | Lag | Annual (3-year averages) | Level (B1) | All, but low-prevalence countries are reported as censored ("<2.5 percent") [UNVERIFIED], so most EU/OECD countries lack variation | Annual SOFI release; lag ~1 year; revised; most informative for India, Indonesia, South Africa, Brazil, Mexico, Argentina, Turkiye, Saudi Arabia | ext | F | FAO SOFI, World Bank |
| G13 | Implied additional grain supply required (grain demand not met by domestic production) | Food supply gap | ERS Global Food Assessment (regional/subregional; not a 42-country series) | Structural / projection | Annual | DROPPED (D21) | | | dropped (D21) | n/a | |
| G14 | 10-year agricultural supply, demand and trade projections (ERS International Baseline) | Forward food view | Annual USDA Agricultural Projections; supply, demand and trade for major commodities and for exporters/importers, plus limited macro data, published in February; latest reflects the October 2024 WASDE; downloadable file last updated 3/28/2025 (https://ers.usda.gov/data-products/international-baseline-data, accessed 2026-10-11) | Lead | Annual | Level, growth (B1) | Major exporting and importing countries and regions (list not given) | Projections only; large interpretive caveat; overlaps A03 (macro forecasts) conceptually | opt | F | USDA ERS, OECD-FAO Agricultural Outlook (hint) |
| G15 | Agricultural land, irrigated area, fertilizer use per hectare and fertilizer import dependence | Inputs and resources | Cropland share, irrigated area share, nutrient use per hectare. ERS TFP product includes land measures including a quality-adjusted version (search result accessed 2026-10-11); fertilizer, land use and irrigation data are listed as FAOSTAT topics in ERS readings (search result accessed 2026-10-11) | Structural | Annual | Level, 5y change (B1) | All | Lag 1-2 years; definitions of "arable" and "cropland" differ by source; energy and fertilizer input cost link to G02 | opt | F | FAOSTAT, USDA ERS |

## Domain scorecards (D6, no composite) and counts

Scorecards are per domain, per country: percentile rank, coverage n/N (D16), latest reference dates. Exception (D12): the Agriculture and food security scorecard is informational and unranked, shown for emerging economies only. Comparison series A02b/A02c are not part of any ranked scorecard (D18). Dropped rows (D20, D21) are removed from the scorecards.

| Scorecard domain | Ranked? | Indicators |
|---|---|---|
| Growth/activity | yes | M01, M02, M03, M04, M05, Q01, Q02, Q04, A02 (IMF; 25 of 42 countries, D22) |
| Prices | yes | M06, M07, M08, G01, A25 |
| Labour | yes | M09, M10, M11, Q03 |
| External | yes | M12, M13, M14, M15, Q05, Q09, Q10 |
| Fiscal | yes | A04, A05, Q08, Q12, A24 |
| Financial conditions and stability | yes | M17, M18, M19, M21, Q06, Q07, Q11, Q13 |
| Markets | yes | M16 (only remaining indicator after D20; M20, M25, M26 dropped; thin domain, M18 also informs sovereign risk) |
| Social | yes | A10, A11, A12, A13, A14, A22, A26 |
| Structural/institutions | yes | A01, A07, A09, A16, A18, A23, Q15 |
| Environment/energy (optional, D8) | yes (optional) | A19, A20, A21, M27 |
| Agriculture and food security (D12) | no: informational, emerging economies only | G01, G02, G03, G04, G05, G06, Q17, G07, G08, G09, G10, G11, G12, G14, G15 |

Note: the Agri-food domain mixes monthly price/supply indicators (G01-G06) and annual structural/outcome indicators (G07-G15, G13 dropped). Per D12 it feeds the global early-warning view only (G02, G03 and G06 are country-invariant or global-factor signals; G01, G04, G09-G12 give country-level context for emerging economies) and is not used for country ranking. G01 is the exception that is ranked, but only as a member of the Prices scorecard.

### Counts (after USDA additions, D18, and D20/D21)
- Monthly catalog: 26 M rows less M23 (placeholder) and less M20, M25, M26 (dropped) = 23 active + 6 G rows = 29.
- Quarterly: 17 (Q01-Q16 + Q17).
- Annual: A01-A26 (26) less A06, A17 (dropped) = 24, + A02b, A02c (2 comparison series) + G07-G15 less G13 (8) = 34.
- Total active indicators approx. 80 (29 + 17 + 34); was approx. 86 before D20/D21.
- Core (confirmed, D17; unchanged by D20-D23): monthly 15 (M01, M02, M03, M04, M06, M07, M09, M12, M14, M15, M16, M17, M18, M24, G01), quarterly 4 (Q01, Q05, Q06, Q08), annual 9 (A01, A02 [IMF], A03, A04, A05, A10, A11, A14, A16) = 28 core (agri/food core = G01 only, D11). A02b and A02c are optional and do not change the core count. No core row carries a V flag any more (M03 is now survey-only and F).
- Rows with Lic = V under D15 (provisional; free alternative needed or optional/drop): Q14 only. Count: 1. (M03 PMI part, M20, M25, M26, A06, A17 resolved by dropping, D20/D21.)
- Dropped by the user on 2026-10-17: M20, M25, M26, A06, A17, G13, and the PMI part of M03 (7 items).
- Added after user feedback: 16 agri/food rows (G01-G15, Q17; G13 since dropped) and 2 macro gaps (A25 GDP deflator/real GDP share, A26 per-capita consumption and food expenditure share).

### Overlaps between USDA-derived rows and existing rows
- G01 vs M06/M07: component of headline; same release, so no extra fetch lag; separate row for affordability analysis and Prices scorecard.
- G02 vs M24: M24 keeps headline food and energy; G02 adds grains, oils and fertilizer detail (could be merged by the researcher if same source file).
- G04 vs M12: derived from the same product-level trade data; definitional caveat on "agricultural".
- G05 vs M15: M15 default; G05 optional agricultural-weighted variant.
- G07 vs A09/Q15; G08 vs G07/Q15; G09 vs Q17; G11 duplicates A26.
- A25/A01/A10 vs ERS International Macroeconomic Data Set: cross-check candidate, not primary source. Real exchange rates, CPI, population and GDP series there overlap M15, M06, A10 and A01.
- G14 vs A03: both projections, different scope.

## Priority summary (core set confirmed, D17)

Monthly core (15): M01, M02, M03, M04, M06, M07, M09, M12, M14, M15, M16, M17, M18, M24, G01.
Quarterly core (4): Q01, Q05, Q06, Q08.
Annual core (9): A01, A02 (IMF output gap), A03, A04, A05, A10, A11, A14, A16.
Agri/food other than G01 stays extended/optional (D11). Environment/energy (A19-A21, A20, M27) remains optional (D8).

Redundancy flags: M05 CLI overlaps M03/M04. M08 PPI mostly captured by M06/M24. M22 broad money weak. A15 HDI duplicates A01/A11/A13. A04/A05 duplicate Q08/Q12 for EU (use quarterly for EU, WEO annual to fill all). M23 is a placeholder. M10/M11 thin coverage. G11 duplicates A26. G05 largely duplicates M15. A02b/A02c duplicate A02 by design (comparison only).

## Monthly refresh handling (cross-cutting)

- A run on the 1st sees: (a) previous-month PMIs/confidence, market data to month-end, policy rates, HICP flash; (b) activity data for month t-2 for many countries; (c) quarterly/annual only when a release landed since the previous run. (PMIs are dropped, D20; "confidence" means the EC/OECD surveys.)
- Output per run: "latest observation, reference period, publication/vintage date, staleness" per country-indicator (D6, D14), with stale values excluded from ranks per limits above (data itself retained).
- Vintage handling (D10): retain every release and revision as fetched from the first run onward, for all indicators (most important for GDP, IP, retail, employment, CLI, output gap, WEO, WASDE/PSD balances which are revised monthly); no backfill.
- IMF-sourced data (D23): no automated IMF requests; WEO files are added manually in April and October, so IMF-based rows change only on those two events.
- Seasonal adjustment: use source-SA series; where only NSA is available use YoY. Never MoM on NSA.
- Event-driven items (CB decisions, WEO releases) go in an event log, not a series. (Ratings dropped, D20.)
- USDA ERS data sets update on irregular dates (individual last-updated dates, e.g. IMDS files between 1/8/2026 and 4/1/2026, the exchange-rate data set 8/27/2026 with next update 11/19/2026; https://ers.usda.gov/data-products and https://ers.usda.gov/data-products/agricultural-exchange-rate-data-set, accessed 2026-10-11), so a monthly run only checks for a newer file than the stored one; most months bring no change.

## Cross-country comparability issues

1. Inflation: HICP (EU) vs national CPI (non-EU) differ in housing treatment, weights, administered prices. Definition: https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Glossary:Harmonised_index_of_consumer_prices_(HICP) (accessed 2026-10-11). Turkiye and Argentina: extreme inflation requires robust z / capped transformations. Use HICP for all 27 EU members, including non-euro ones. Food CPI weights vary a lot (high in EMs): compare food inflation contributions, not just rates.
2. Unemployment: ILO definition vs registered; informality in EMs [UNVERIFIED]; China publishes urban surveyed rate.
3. GDP: base years, chain-linking, SA differ; NSA-only in some EMs so QoQ not comparable, use YoY for cross-country ranking; China smoothness/reliability caveat [UNVERIFIED]; Argentina rebasing; Ireland (multinationals; consider GNI*), Luxembourg, Malta, Netherlands distortions [UNVERIFIED].
4. Currency (D7): see currency basis rule. PPP for living standards, market USD for finance/trade size, local currency for growth and inflation. USD-denominated YoY changes mix real change with FX moves (e.g. Turkiye, Argentina, Japan); never rank growth on USD values. USDA ERS real GDP is in constant 2017 market-rate dollars (base year 2017), which is neither PPP nor local currency.
5. Fiscal: general vs central government, Maastricht vs IMF gross debt, fiscal-year vs calendar-year.
6. External: intra-EU trade; euro-area members' trade with each other is "foreign" trade; openness inflated for small EU states. Agricultural trade: "agricultural" definitions differ by agency (HS 1-24, WTO, USDA FATUS excludes fertilizers, machinery, seafood and forest products).
7. Euro-area members inherit ECB rate, euro exchange rate and (partly) reserves: those indicators have no within-area variation; flag as inherited.
8. Surveys: confidence levels not comparable; use own-history z (PMI dropped, D20).
9. Standardisation: ranks use percentiles; alerts use own-history z over a 20-year window (D19). 2020 distorts windows.
10. Seasonal/calendar adjustment differs; Chinese New Year distorts Jan/Feb China data.
11. Frequency mismatch: mixing M/Q/A in one domain scorecard requires staleness flags; no blending without it.
12. Perception indices (WGI, HDI) are ordinal composites: use levels/percentiles, not growth rates; WGI starts 1996.
13. Aggregates (EU27, euro area) are not sums of members for ratios; use official aggregates, not ranked.
14. Missing data: left n/a (D3); coverage n/N shown; no imputation (D16). D15 and D20-D22 add gaps (dropped licensed rows; A02 25 of 42) and lower coverage for EMs.
15. Series starting after 1991 for many EU-accession and emerging economies; aggregated history therefore has changing composition; their alerts are "low confidence" until 20 years of data accrue (D19 short-series rule).
16. Agri marketing years vs calendar years (PSD/WASDE balances); crop-specific marketing years differ by country; calendarising is a transformation decision for later.
17. Agri indicators are weather-driven and volatile: use multi-year averages for structural comparison (yield, TFP), and expect negative skew in alert windows.
18. Agri/food indicators discriminate poorly among high-income countries (food insecurity censored at low prevalence; low food import dependence) and strongly among EMs; this is why D12 keeps the domain unranked and informational.
19. Mixing observed and projected values in USDA series (IMDS to 2035; baseline 10-year): projected flag required, projections excluded from alert windows and ranks.
20. Discontinued USDA products (ERS International Food Consumption Patterns, China Agricultural and Economic Data, Commodity and Food Elasticities) should not be relied on (https://ers.usda.gov/data-products, accessed 2026-10-11).
21. Output gap (D18, D22): IMF, OECD and EC estimates use different methods and vintages; only the IMF series enters rankings (25 of 42 countries); OECD and EC series are comparison-only, stored separately, and cover fewer countries (OECD members; EU27 respectively).

## Excluded indicators and why

- Raw nominal GDP in USD as a growth/standing measure: market-FX distortions; kept only as a size weight (B2).
- Nominal retail/industrial indices: price effects mixed with volume.
- Daily market series as raw inputs: aggregated to monthly.
- Consensus/Bloomberg forecasts and other paid-only data: excluded under D15 (freely accessible databases only).
- Dropped by user decision 2026-10-17 (D20, D21): PMI part of M03 (S&P Global data not free), M20 equity indices, M25 policy uncertainty and VIX, M26 sovereign CDS/EMBI spreads, A06 sovereign ratings (no free machine-readable source found per the sources note), A17 business environment (no time series per the sources note), G13 implied grain supply gap (regional only, no free alternative).
- Company-level earnings and general news sentiment: out of scope.
- Housing starts/permits monthly: patchy; Q07 suffices.
- National-specific series (e.g. US payrolls, core PCE): not comparable; possible country extensions later.
- African Union and Russia: excluded by user decision (D1, D2).
- Composite country rank: deferred (D6).
- USDA ERS Foreign Agricultural Trade of the United States (FATUS): US exports/imports by partner country; US-bilateral, not a cross-country comparable series (derive agri trade from M12/G04 instead).
- USDA commodity-specific yearbooks (Rice Yearbook, Sugar and Sweeteners, Wheat Data, Feed Grains, Fruit and Tree Nuts, Vegetables and Pulses, Livestock and Meat International Trade): too commodity-specific for a macro panel; world supply/use balances are covered at aggregate level by G03/G10 (https://ers.usda.gov/data-products, accessed 2026-10-11).
- Discontinued USDA products: International Food Consumption Patterns, China Agricultural and Economic Data, Commodity and Food Elasticities.
- Country-level crop-by-crop PSD detail (production/area/yield per commodity): not retained at the selection level; only aggregated ratios (G03, G10) are proposed. Revisit if the user wants agricultural-sector analysis.

## Open questions (user / researcher)

Resolved by user decisions: AU and aggregates (D1), Russia (D2), ranking coverage and its mitigation (D3, D16), history depth (D4), licensing and hneu.net (D5 superseded by D15), composite vs scorecards (D6), staleness limits (D14), currency basis (D7), environment/energy tier (D8), alert parameters (D9, D19), vintage retention and no backfill (D10), agri/food priority (D11), agri/food ranking role (D12), USDA as optional source (D13), free databases only (D15), core list (D17), output-gap source (D18), V-flag rows and dropped indicators (D20, D21), A02 coverage (D22), non-commercial public use and manual IMF WEO downloads (D23).

User (still open, minor):
1. Watch level (|z| >= 1.5): pending confirmation (D19; not restated by the user).
2. Short-series minimum-observations rule (proposal in the Alert rule section: no alert below 60 monthly / 20 quarterly / 10 annual observations; "low confidence" below the full 20-year window): confirm or adjust.
3. Re-approve this document (status reset to draft on 2026-10-17 because the approved list changed).
4. Not decided by the user in this change: whether the January/July WEO updates should also be downloaded manually, or only April and October.

Researcher (to verify; no assessment done here):
1. Release calendars, typical lags and a monthly coverage matrix for the 42 countries (especially M01, M02, M09, M12, M21 for China, India, Indonesia, Saudi Arabia, Argentina, South Africa, Turkiye, Brazil, Mexico).
2. D15: Q14 is the only remaining Lic = V row; find a free, citable source or recommend drop. Also check terms of use for the free sources of F rows (OECD, ILOSTAT, BIS, UN WPP, Penn World Table; OECD and ILOSTAT pages returned HTTP 403 for this agent). Do not rely on the hneu.net university account.
3. Confirm euro-area membership list (Bulgaria 2026), G20 membership including AU, ESA/SNA versions.
4. Optional (not a requirement, per D10): note where sources publish historical vintages (ALFRED, OECD or Eurostat revision databases, ECB data portal, IMF WEO archive).
5. Whether harmonised multi-country sources (OECD MEI, BIS, World Bank WDI, Eurostat) can cover most core indicators without automated IMF access (D23); IMF IFS/DataMapper only via manual download.
6. Availability of USD conversions, PPP series and constant-exchange-rate series (D7) and flow/stock conversion conventions.
7. Start dates per indicator relative to 1991 (D4), and how many core series have the full 20-year window for the 42 countries (D19): this determines how many alerts will be "low confidence".
8. Agri/food source choice per indicator (D13): compare USDA, FAO, World Bank, OECD coverage of the 42 countries. Unverified here: contents, country coverage and monthly cadence of FAS PSD Online and WASDE (PSD landing page returned no content, WASDE page HTTP 403; host www.ers.usda.gov did not resolve while ers.usda.gov did); the ERS food CPI and food price pages; country lists of the IMDS (181 countries), expenditure data (104), exchange rate data (79 + EU); availability of FAS crop-weather products (G06).
9. D23 consequences: for M14 (reserves), Q05 (current account) and any other row whose researched source is an IMF dataflow, propose a non-IMF source (national central banks, Eurostat, OECD, World Bank) or flag manual-only refresh. Also check whether a manual WEO download is sufficient for A01, A02, A03, A04, A05 and A25.
10. D22: list the 25 countries with an IMF output gap and the 17 without (the sources note, F6, has the matrix); where OECD and EC comparison series (A02b, A02c) are available. Do not assess methodology beyond coverage and vintage availability.

## Sources cited (accessed 2026-10-11)
- Eurostat HICP glossary: https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Glossary:Harmonised_index_of_consumer_prices_(HICP) - HICP is the harmonised EU consumer price index under a single set of definitions; page does not discuss national-CPI differences or timing.
- IMF WEO page: https://www.imf.org/en/Publications/WEO - April/October editions, January/July updates.
- World Bank WGI: https://www.worldbank.org/en/publication/worldwide-governance-indicators - six dimensions, annual, 1996-2025, 35 sources.
- USDA ERS International Macroeconomic Data Set: https://ers.usda.gov/data-products/international-macroeconomic-data-set - 181 countries (>99 percent of world economy), 1970-2035 history plus projections, real GDP, GDP per capita, GDP deflator, real GDP shares, real exchange rate, CPI, population; base 2017; annual; XLSX removed 27 May 2026.
- USDA ERS International Agricultural Productivity: https://ers.usda.gov/data-products/international-agricultural-productivity - TFP index, 2015 = 100, 1961-2023, growth not levels, updated 1/27/2026.
- USDA ERS International Food Security (Global Food Assessment): https://ers.usda.gov/data-products/international-food-security - grain demand, production and implied additional supply required, current year plus 10 years, CSV updated 8/26/2026; no definition of food insecurity or food affordability on the page.
- USDA ERS Agricultural Exchange Rate Data Set: https://ers.usda.gov/data-products/agricultural-exchange-rate-data-set - 79 countries plus EU, monthly and annual, quarterly release, from 1970, updated 8/27/2026, next 11/19/2026.
- USDA ERS International Food and Alcoholic Beverage Expenditure Data: https://ers.usda.gov/data-products/international-food-and-alcoholic-beverage-expenditure-data - 104 countries, expenditure shares and per-capita figures in current USD, updated 8/11/2026.
- USDA ERS International Baseline Data: https://ers.usda.gov/data-products/international-baseline-data - 10-year supply, demand, trade projections, published in February, reflect October 2024 WASDE.
- USDA ERS Data Products index: https://ers.usda.gov/data-products - list of international products and discontinuations.
- Web search result (ERS data products, FATUS, PS&D and FAOSTAT references), accessed 2026-10-11, used only for the PSD/FATUS/land-use statements marked above.
- Not retrievable: OECD CLI page and ILOSTAT unemployment-rate definition (HTTP 403); USDA WASDE page https://www.usda.gov/oce/commodity/wasde (HTTP 403); FAS PSD Online https://apps.fas.usda.gov/psdonline/app/index.html (page returned only its title); the host www.ers.usda.gov did not resolve (ers.usda.gov worked); the ERS international food CPI page was not fetched. Related statements are marked unverified.
- For D20-D23 (user decisions of 2026-10-17): coverage figures (IMF output gap 25 of 42) and the drop proposals for A17 and G13 are taken from the project's own research note docs/research/data-sources-g20-eu-cross-country.md (F6, F8, F11; read 2026-10-17), not re-verified here. The IMF automated-download restriction is that note's reading of https://www.imf.org/en/About/copyright-and-terms (quoted there, accessed 17 Oct 2026); not re-fetched here.

## Change log

- 2026-10-17: Applied user decisions D20-D23. Status set to draft (was approved); the user must re-approve. Changes: (1) new decisions D20-D23 in the decisions table; (2) catalog: M03 PMI part dropped (survey-only, Lic F); M20, M25, M26, A06, A17, G13 marked dropped, rows kept for traceability; (3) A02 row notes 25 of 42 coverage and manual WEO refresh; IMF-source hints for M14, Q05, A01, A03-A05, A25 annotated with D23; (4) scorecards: Markets reduced to M16, A17 and G13 removed; (5) counts: approx. 80 active indicators (was 86), V-flag rows 1 (Q14), core list unchanged at 28; (6) excluded-indicators list, comparability notes, refresh handling and open questions updated to match; (7) front matter: status draft, `updated` date added. Nothing else was changed.
