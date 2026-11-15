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

<div id="home-slot" class="mm-home-slot"></div>

<div class="mm-home-legacy" id="home-legacy">
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
// change loads that domain's scorecard once (cached, a failed load is not cached). V58: the Home panels share this loader (one request per domain).
const loadScorecard = createScorecardLoader({"labour": () => FileAttachment("data/scorecard/labour.json").json(), "prices": () => FileAttachment("data/scorecard/prices.json").json(), "fiscal": () => FileAttachment("data/scorecard/fiscal.json").json(), "growth": () => FileAttachment("data/scorecard/growth.json").json(), "agri": () => FileAttachment("data/scorecard/agri.json").json(), "qa": () => FileAttachment("data/scorecard/qa.json").json()});
const dash = md ? mountHomeDashboard(html, {store, data: md, declaredDomain: md.domainsDoc?.default_domain ?? null, loadScorecard}) : null;
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
const seriesFiles = {"A01": FileAttachment("data/series/A01.json"), "A02": FileAttachment("data/series/A02.json"), "A04": FileAttachment("data/series/A04.json"), "A05": FileAttachment("data/series/A05.json"), "M09": FileAttachment("data/series/M09.json"), "M10": FileAttachment("data/series/M10.json"), "M11": FileAttachment("data/series/M11.json"), "P01": FileAttachment("data/series/P01.json"), "Q08": FileAttachment("data/series/Q08.json"), "V01": FileAttachment("data/series/V01.json"), "V02": FileAttachment("data/series/V02.json"), "V03": FileAttachment("data/series/V03.json"), "V04": FileAttachment("data/series/V04.json"), "V05": FileAttachment("data/series/V05.json"), "V06": FileAttachment("data/series/V06.json")};
if (dash) mountSeriesCard(html, Plot, dash, {data: md, files: seriesFiles});
```

```js
import {homePage, homeLandingDomains} from "./lib/home-page.js";
import {resolveHome} from "./lib/home-config.js";
import {historySource} from "./lib/history.js";
```

```js
// V57 to V59: KPI strip and the four panels (A C2, B C1, C C6, D C4) above the retained cards. Only the scorecards of the strip and of the default Indicator are read now;
// the series files (C1, C4) and the map shapes (C6) are read by the panels after the page has loaded. A failed scorecard moves its cards to the disclosure.
const geoFiles = {asset: FileAttachment("geo/europe-countries.geojson"), join: FileAttachment("geo/entity_geo_join.json")};
if (md) {
  const resolved = resolveHome({indicators: md.indicators, entities: md.entities});
  const landing = homeLandingDomains(resolved, md.indicators);
  const results = await Promise.allSettled(landing.map((d) => loadScorecard(d)));
  const scorecards = {};
  const failedDomains = new Set();
  landing.forEach((d, k) => (results[k].status === "fulfilled" ? (scorecards[d] = results[k].value) : failedDomains.add(d)));
  const inputs = {entities: md.entities.filter((e) => e.is_global !== true), groups: md.groups, domains: md.domains, indicators: md.indicators, series: md.series, scorecards, knownCutoff: md.manifest.known_cutoff ?? null, bounds: periodBounds(md.manifest), manifest: md.manifest};
  document.getElementById("home-slot").replaceChildren(homePage(html, Plot, inputs, historySource(md.manifest, seriesFiles), {store, resolved, loadScorecard, failedDomains, geo: geoFiles, links: {country: (id) => `./country/${id}`, revisions: "./revisions"}}));
}
```
</div>

<section class="mm-dband" id="band-browse" aria-labelledby="band-browse-heading">
<div class="mm-band"><h2 id="band-browse-heading">Browse</h2></div>
<details class="mm-browse" id="browse"><summary>Countries, indicators and other pages</summary>
<section id="countries" class="mm-home-list" data-filter="countries" aria-labelledby="countries-heading">
<h2 id="countries-heading">Choose a country</h2>
<div class="mm-filter" data-filter-slot></div>
<ul id="country-list"><li><a href="./country/AUS">Australia</a></li><li><a href="./country/AUT">Austria</a></li><li><a href="./country/BEL">Belgium</a></li><li><a href="./country/BRA">Brazil</a></li><li><a href="./country/BGR">Bulgaria</a></li><li><a href="./country/CAN">Canada</a></li><li><a href="./country/CHN">China</a></li><li><a href="./country/HRV">Croatia</a></li><li><a href="./country/CYP">Cyprus</a></li><li><a href="./country/CZE">Czechia</a></li><li><a href="./country/DNK">Denmark</a></li><li><a href="./country/EST">Estonia</a></li><li><a href="./country/FIN">Finland</a></li><li><a href="./country/FRA">France</a></li><li><a href="./country/DEU">Germany</a></li><li><a href="./country/GRC">Greece</a></li><li><a href="./country/HUN">Hungary</a></li><li><a href="./country/IND">India</a></li><li><a href="./country/IDN">Indonesia</a></li><li><a href="./country/IRL">Ireland</a></li><li><a href="./country/ITA">Italy</a></li><li><a href="./country/JPN">Japan</a></li><li><a href="./country/LVA">Latvia</a></li><li><a href="./country/LTU">Lithuania</a></li><li><a href="./country/LUX">Luxembourg</a></li><li><a href="./country/MLT">Malta</a></li><li><a href="./country/MEX">Mexico</a></li><li><a href="./country/NLD">Netherlands</a></li><li><a href="./country/NOR">Norway</a></li><li><a href="./country/POL">Poland</a></li><li><a href="./country/PRT">Portugal</a></li><li><a href="./country/ROU">Romania</a></li><li><a href="./country/SVK">Slovakia</a></li><li><a href="./country/SVN">Slovenia</a></li><li><a href="./country/ZAF">South Africa</a></li><li><a href="./country/KOR">South Korea</a></li><li><a href="./country/ESP">Spain</a></li><li><a href="./country/SWE">Sweden</a></li><li><a href="./country/TUR">Turkiye</a></li><li><a href="./country/UKR">Ukraine</a></li><li><a href="./country/GBR">United Kingdom</a></li><li><a href="./country/USA">United States</a></li></ul>
<div data-filter-group><h3 id="aggregates">Aggregates</h3><ul id="aggregate-list"><li><a href="./country/EA">Euro area</a></li><li><a href="./country/EU27">European Union</a></li></ul></div>
</section>

<section id="indicators" class="mm-home-list" data-filter="indicators" aria-labelledby="indicators-heading">
<h2 id="indicators-heading">Choose an indicator</h2>
<div class="mm-filter" data-filter-slot></div>
<details data-filter-group id="indicators-labour"><summary>Labour</summary><ul><li><a href="./indicator/M10">Employment rate (synthetic)</a></li><li><a href="./indicator/M11">Population 15-64 (synthetic)</a></li><li><a href="./indicator/M09">Unemployment rate (synthetic)</a></li></ul></details>
<details data-filter-group id="indicators-prices"><summary>Prices</summary><ul><li><a href="./indicator/P01">Consumer price index (synthetic)</a></li></ul></details>
<details data-filter-group id="indicators-fiscal"><summary>Fiscal</summary><ul><li><a href="./indicator/A04">General government balance (synthetic)</a></li><li><a href="./indicator/A05">Gross government debt (synthetic)</a></li></ul></details>
<details data-filter-group id="indicators-growth"><summary>Growth</summary><ul><li><a href="./indicator/Q08">Business confidence (synthetic)</a></li><li><a href="./indicator/A02">Real GDP growth (synthetic)</a></li></ul></details>
<details data-filter-group id="indicators-agri"><summary>Agriculture</summary><ul><li><a href="./indicator/A01">Agricultural land share (synthetic)</a></li></ul></details>
<details data-filter-group id="indicators-qa"><summary>QA cases (synthetic)</summary><ul><li><a href="./indicator/V04">QA: flow_basis absent for some series (synthetic)</a></li><li><a href="./indicator/V03">QA: index, two base periods (synthetic)</a></li><li><a href="./indicator/V06">QA: more than one frequency (synthetic)</a></li><li><a href="./indicator/V02">QA: SA and NSA mix (synthetic)</a></li><li><a href="./indicator/V05">QA: stored value_yoy (synthetic)</a></li><li><a href="./indicator/V01">QA: two unit codes (synthetic)</a></li></ul></details>
</section>

<ul class="mm-home-links" id="home-links"><li><a href="./explorer">Time series</a></li><li><a href="./domains">Domains</a></li><li><a href="./revisions">Revisions</a></li></ul>
</details>
</section>

```js
mountFilters(document);
```
