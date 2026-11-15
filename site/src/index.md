---
title: Country scorecards
---

<h1>Country scorecards</h1>

<div class="mm-home-shell">

```js
import {parseManifest} from "./lib/manifest.js";
import {pageHead} from "./lib/shell.js";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
import {mountFilters} from "./lib/home-lists.js";
```

```js
const busy = busyBlock(html, R.loadingData);
display(busy);
```

```js
// A failed file never throws into the page: loadAll returns one failed region per file (T105). The lists below are static.
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest}
]);
setBusy(busy, false);
display(pageHead(html, boot, "lists"));
```

</div>

<p class="mm-caveat" id="caveat">Percentiles are relative position in the covered panel, not a judgement of structural quality.</p>

<div class="mm-filterbar-slot" id="filterbar-slot"></div>

```js
import {listOf} from "./lib/meta.js";
import {createFilterStore, filterGenerator} from "./lib/filter-store.js";
import {mountFilterBar} from "./lib/filter-bar.js";
import {periodBounds} from "./lib/filter-model.js";
import {createScorecardLoader, mountHomeDashboard, mountHomeFailure} from "./lib/home-dashboard.js";
import {mountKpi} from "./lib/kpi-view.js";
import {mountTableCard} from "./lib/table-card.js";
```

```js
const meta = await loadAll([
  {key: "meta", region: R.meta, load: async () => ({entities: await FileAttachment("data/meta/entities.json").json(), indicators: await FileAttachment("data/meta/indicators.json").json(), domains: await FileAttachment("data/meta/domains.json").json(), groups: await FileAttachment("data/meta/groups.json").json(), series: await FileAttachment("data/meta/series.json").json()}),
    parse: (m) => ({entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups"), series: listOf(m.series, "series"), domainsDoc: m.domains})}
]);
// L15: any failed meta file (the manifest included) means no data card is built; each card shows the alert instead (amendment 5).
// The manifest is the one boot already loaded; meta/series.json is loaded once here and reused by the rank card.
const md = boot.ok && meta.ok ? {...meta.data.meta, manifest: boot.data.manifest} : null;
```

```js
const store = createFilterStore({win: window, maxEntities: 5, known: md ? {
  bounds: periodBounds(md.manifest) ?? undefined,
  indicators: new Set(md.indicators.map((i) => i.indicator_id)), entities: new Set(md.entities.map((e) => e.entity_id)),
  groups: new Set(md.groups.map((g) => g.group_id)), domains: new Set(md.domains.map((d) => d.domain_id))} : {}});
globalThis.__mmFilterStore = store;
const barSlot = document.getElementById("filterbar-slot");
if (md) barSlot.replaceChildren(mountFilterBar(html, {page: "home", store, data: md}));
else barSlot.setAttribute("data-empty", "");
```

<div id="dashboard-slot"></div>

```js
// L11: band skeleton with empty card slots (slot API in lib/home-dashboard.js). Only the default domain's scorecard loads now; a Domain
// change loads that domain's scorecard once (cached, a failed load is not cached).
const dash = md ? mountHomeDashboard(html, {store, data: md, declaredDomain: md.domainsDoc?.default_domain ?? null,
  loadScorecard: createScorecardLoader({"agri": () => FileAttachment("data/scorecard/agri.json").json(), "environment": () => FileAttachment("data/scorecard/environment.json").json(), "external": () => FileAttachment("data/scorecard/external.json").json(), "fin": () => FileAttachment("data/scorecard/fin.json").json(), "fiscal": () => FileAttachment("data/scorecard/fiscal.json").json(), "global": () => FileAttachment("data/scorecard/global.json").json(), "growth": () => FileAttachment("data/scorecard/growth.json").json(), "labour": () => FileAttachment("data/scorecard/labour.json").json(), "prices": () => FileAttachment("data/scorecard/prices.json").json(), "social": () => FileAttachment("data/scorecard/social.json").json(), "structural": () => FileAttachment("data/scorecard/structural.json").json()})}) : null;
if (dash) document.getElementById("dashboard-slot").replaceChildren(dash.root);
if (!md) document.getElementById("dashboard-slot").replaceChildren(mountHomeFailure(html, {failures: [...boot.failures, ...meta.failures]}));
globalThis.__mmDashboard = dash;
if (dash) mountKpi(html, dash, {data: md}); // L14: Overview band
```

```js
import * as Plot from "@observablehq/plot";
import {mountRankCard} from "./lib/rank-view.js";
import {mountHeatmapCard} from "./lib/heatmap-card.js";
```

```js
// L12: the ranked comparison card and the facts card. meta/series.json (reference-period labels, "no series" wording) comes from the meta load above.
if (dash) mountRankCard(html, Plot, dash, {data: md, series: md ? md.series : null});
```

```js
if (dash) mountHeatmapCard(html, dash, {data: md}); // L13: Domain band
```

```js
if (dash) mountTableCard(html, dash, {data: md}); // L17: Indicators band (one Country in focus)
```

```js
import {mountSeriesCard} from "./lib/series-card.js";
```

```js
// L18: Over time band. One literal FileAttachment per series file; each is lazy and nothing is requested until the "Load history" button.
const seriesFiles = {"A01": FileAttachment("data/series/A01.parquet"), "A02": FileAttachment("data/series/A02.parquet"), "A04": FileAttachment("data/series/A04.parquet"), "A05": FileAttachment("data/series/A05.parquet"), "A14": FileAttachment("data/series/A14.parquet"), "A22": FileAttachment("data/series/A22.parquet"), "G01": FileAttachment("data/series/G01.parquet"), "G02": FileAttachment("data/series/G02.parquet"), "G03": FileAttachment("data/series/G03.parquet"), "M02": FileAttachment("data/series/M02.parquet"), "M06": FileAttachment("data/series/M06.parquet"), "M07": FileAttachment("data/series/M07.parquet"), "M09": FileAttachment("data/series/M09.parquet"), "M17": FileAttachment("data/series/M17.parquet"), "M18": FileAttachment("data/series/M18.parquet"), "Q06": FileAttachment("data/series/Q06.parquet"), "Q08": FileAttachment("data/series/Q08.parquet")};
if (dash) mountSeriesCard(html, Plot, dash, {data: md, files: seriesFiles});
```

<section class="mm-dband" id="band-browse" aria-labelledby="band-browse-heading">
<div class="mm-band"><h2 id="band-browse-heading">Browse</h2></div>
<details class="mm-browse" id="browse"><summary>Countries, indicators and other pages</summary>
<section id="countries" class="mm-home-list" data-filter="countries" aria-labelledby="countries-heading">
<h2 id="countries-heading">Choose a country</h2>
<div class="mm-filter" data-filter-slot></div>
<ul id="country-list"><li><a href="./country/ARG">Argentina</a></li><li><a href="./country/AUS">Australia</a></li><li><a href="./country/AUT">Austria</a></li><li><a href="./country/BEL">Belgium</a></li><li><a href="./country/BRA">Brazil</a></li><li><a href="./country/BGR">Bulgaria</a></li><li><a href="./country/CAN">Canada</a></li><li><a href="./country/CHN">China</a></li><li><a href="./country/HRV">Croatia</a></li><li><a href="./country/CYP">Cyprus</a></li><li><a href="./country/CZE">Czechia</a></li><li><a href="./country/DNK">Denmark</a></li><li><a href="./country/EST">Estonia</a></li><li><a href="./country/FIN">Finland</a></li><li><a href="./country/FRA">France</a></li><li><a href="./country/DEU">Germany</a></li><li><a href="./country/GRC">Greece</a></li><li><a href="./country/HUN">Hungary</a></li><li><a href="./country/IND">India</a></li><li><a href="./country/IDN">Indonesia</a></li><li><a href="./country/IRL">Ireland</a></li><li><a href="./country/ITA">Italy</a></li><li><a href="./country/JPN">Japan</a></li><li><a href="./country/LVA">Latvia</a></li><li><a href="./country/LTU">Lithuania</a></li><li><a href="./country/LUX">Luxembourg</a></li><li><a href="./country/MLT">Malta</a></li><li><a href="./country/MEX">Mexico</a></li><li><a href="./country/NLD">Netherlands</a></li><li><a href="./country/POL">Poland</a></li><li><a href="./country/PRT">Portugal</a></li><li><a href="./country/ROU">Romania</a></li><li><a href="./country/SAU">Saudi Arabia</a></li><li><a href="./country/SVK">Slovakia</a></li><li><a href="./country/SVN">Slovenia</a></li><li><a href="./country/ZAF">South Africa</a></li><li><a href="./country/KOR">South Korea</a></li><li><a href="./country/ESP">Spain</a></li><li><a href="./country/SWE">Sweden</a></li><li><a href="./country/TUR">Turkiye</a></li><li><a href="./country/GBR">United Kingdom</a></li><li><a href="./country/USA">United States</a></li></ul>
<div data-filter-group><h3 id="aggregates">Aggregates</h3><ul id="aggregate-list"><li><a href="./country/EA">Euro area</a></li><li><a href="./country/EU27">European Union (27)</a></li></ul></div>
</section>

<section id="indicators" class="mm-home-list" data-filter="indicators" aria-labelledby="indicators-heading">
<h2 id="indicators-heading">Choose an indicator</h2>
<div class="mm-filter" data-filter-slot></div>
<details data-filter-group id="indicators-agri"><summary>Agri-food</summary><ul><li><a href="./indicator/G14">10-year agricultural projections (ERS baseline)</a></li><li><a href="./indicator/G15">Agricultural land, irrigated area, fertilizer use</a></li><li><a href="./indicator/G07">Agricultural total factor productivity index</a></li><li><a href="./indicator/G04">Agricultural trade balance, 12-month sum</a></li><li><a href="./indicator/Q17">Agriculture gross value added, volume</a></li><li><a href="./indicator/G09">Agriculture value added % of GDP; employment share in agriculture</a></li><li><a href="./indicator/G10">Cereal import dependency / self-sufficiency ratio</a></li><li><a href="./indicator/G08">Cereal yield; agricultural value added per worker</a></li><li><a href="./indicator/G01">Food CPI / HICP food and non-alcoholic beverages</a></li><li><a href="./indicator/G11">Food expenditure share of household spending</a></li><li><a href="./indicator/G12">Prevalence of undernourishment and food insecurity (FAO, 3-year averages)</a></li><li><a href="./indicator/G05">Real trade-weighted agricultural exchange rate index</a></li><li><a href="./indicator/G06">Weather and drought anomalies in cropland</a></li></ul></details>
<details data-filter-group id="indicators-environment"><summary>Environment</summary><ul><li><a href="./indicator/M27">Electricity generation/consumption proxy</a></li><li><a href="./indicator/A19">Energy import dependence; energy intensity; electricity mix</a></li><li><a href="./indicator/A20">GHG emissions per capita and per GDP</a></li><li><a href="./indicator/A21">Renewable share of electricity</a></li></ul></details>
<details data-filter-group id="indicators-external"><summary>External</summary><ul><li><a href="./indicator/Q05">Current account balance, % of GDP</a></li><li><a href="./indicator/M16">Exchange rate vs USD</a></li><li><a href="./indicator/Q10">External debt; short-term external debt vs reserves</a></li><li><a href="./indicator/M13">Goods trade balance, 12-month sum as % of GDP</a></li><li><a href="./indicator/M12">Merchandise exports and imports</a></li><li><a href="./indicator/Q09">Net international investment position, % of GDP</a></li><li><a href="./indicator/M14">Official FX reserves</a></li><li><a href="./indicator/M15">Real effective exchange rate</a></li></ul></details>
<details data-filter-group id="indicators-fin"><summary>Financial</summary><ul><li><a href="./indicator/M18">10-year government bond yield and spread</a></li><li><a href="./indicator/Q11">Banking soundness (NPL ratio, Tier 1 capital)</a></li><li><a href="./indicator/Q06">Credit to private non-financial sector, % of GDP and credit-to-GDP gap</a></li><li><a href="./indicator/Q13">Household debt, % of GDP</a></li><li><a href="./indicator/M17">Policy interest rate</a></li><li><a href="./indicator/M21">Private-sector bank credit growth</a></li><li><a href="./indicator/Q07">Residential property prices (real)</a></li><li><a href="./indicator/M19">Short-term interbank rate</a></li></ul></details>
<details data-filter-group id="indicators-fiscal"><summary>Fiscal</summary><ul><li><a href="./indicator/A24">Cyclically adjusted primary balance</a></li><li><a href="./indicator/A04">General government balance and primary balance, % of GDP</a></li><li><a href="./indicator/Q08">General government gross debt, % of GDP</a></li><li><a href="./indicator/Q12">Government net lending, % of GDP</a></li><li><a href="./indicator/A05">Gross government debt, % of GDP</a></li></ul></details>
<details data-filter-group id="indicators-global"><summary>Global series</summary><ul><li><a href="./indicator/G02">Agricultural and fertilizer commodity prices</a></li><li><a href="./indicator/M24">Commodity and energy prices (Brent, gas, food index)</a></li><li><a href="./indicator/G03">Stocks-to-use ratio (wheat, coarse grains, rice, oilseeds)</a></li></ul></details>
<details data-filter-group id="indicators-growth"><summary>Growth</summary><ul><li><a href="./indicator/M03">Business-confidence survey (EC ESI, OECD BCI)</a></li><li><a href="./indicator/M04">Consumer confidence</a></li><li><a href="./indicator/Q04">Expenditure components (contributions to growth)</a></li><li><a href="./indicator/M01">Industrial production index (excl. construction)</a></li><li><a href="./indicator/M05">OECD Composite Leading Indicator</a></li><li><a href="./indicator/A02">Output gap, IMF estimate (headline)</a></li><li><a href="./indicator/Q01">Real GDP (volume, SA)</a></li><li><a href="./indicator/Q02">Real GDP per capita, PPP</a></li><li><a href="./indicator/M02">Retail trade volume</a></li></ul></details>
<details data-filter-group id="indicators-labour"><summary>Labour market</summary><ul><li><a href="./indicator/M11">Employment level/rate (monthly)</a></li><li><a href="./indicator/Q03">Employment, hours worked</a></li><li><a href="./indicator/M09">Unemployment rate</a></li><li><a href="./indicator/M10">Youth unemployment (&lt;25)</a></li></ul></details>
<details data-filter-group id="indicators-prices"><summary>Prices and inflation</summary><ul><li><a href="./indicator/M07">Core inflation (ex food, energy)</a></li><li><a href="./indicator/G01">Food CPI / HICP food and non-alcoholic beverages</a></li><li><a href="./indicator/A25">GDP deflator inflation (and real GDP share of world)</a></li><li><a href="./indicator/M06">Headline CPI / HICP inflation</a></li><li><a href="./indicator/M08">Industrial producer prices</a></li></ul></details>
<details data-filter-group id="indicators-social"><summary>Social</summary><ul><li><a href="./indicator/A13">Educational attainment (tertiary share 25-34), PISA, schooling years</a></li><li><a href="./indicator/A12">Health expenditure, % of GDP</a></li><li><a href="./indicator/A26">Household consumption per capita; food share of consumer spending</a></li><li><a href="./indicator/A14">Income inequality (Gini, S80/S20, poverty rate)</a></li><li><a href="./indicator/A11">Life expectancy at birth</a></li><li><a href="./indicator/A10">Population, working-age share, old-age dependency</a></li><li><a href="./indicator/A22">Poverty headcount; labour force participation</a></li></ul></details>
<details data-filter-group id="indicators-structural"><summary>Structural</summary><ul><li><a href="./indicator/A18">Export complexity, FDI inflows % of GDP</a></li><li><a href="./indicator/A01">GDP per capita PPP and ratio to US</a></li><li><a href="./indicator/A07">Gross fixed capital formation, % of GDP</a></li><li><a href="./indicator/Q15">Labour productivity (GDP per hour)</a></li><li><a href="./indicator/A23">R&amp;D, % of GDP; patents</a></li><li><a href="./indicator/A09">Total factor productivity growth (whole economy)</a></li><li><a href="./indicator/A16">Worldwide Governance Indicators (six dimensions)</a></li></ul></details>
</section>

<ul class="mm-home-links" id="home-links"><li><a href="./explorer">Time series</a></li><li><a href="./domains">Domains</a></li><li><a href="./revisions">Revisions</a></li></ul>
</details>
</section>

```js
mountFilters(document);
```
