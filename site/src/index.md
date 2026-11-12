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
  loadScorecard: createScorecardLoader({"labour": () => FileAttachment("data/scorecard/labour.json").json(), "prices": () => FileAttachment("data/scorecard/prices.json").json(), "agri": () => FileAttachment("data/scorecard/agri.json").json(), "global": () => FileAttachment("data/scorecard/global.json").json(), "fin": () => FileAttachment("data/scorecard/fin.json").json()})}) : null;
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
const seriesFiles = {"M09": FileAttachment("data/series/M09.parquet"), "P01": FileAttachment("data/series/P01.parquet")};
if (dash) mountSeriesCard(html, Plot, dash, {data: md, files: seriesFiles});
```

<section class="mm-dband" id="band-browse" aria-labelledby="band-browse-heading">
<div class="mm-band"><h2 id="band-browse-heading">Browse</h2></div>
<details class="mm-browse" id="browse"><summary>Countries, indicators and other pages</summary>
<section id="countries" class="mm-home-list" data-filter="countries" aria-labelledby="countries-heading">
<h2 id="countries-heading">Choose a country</h2>
<div class="mm-filter" data-filter-slot></div>
<ul id="country-list"><li><a href="./country/FRA">France</a></li><li><a href="./country/DEU">Germany</a></li><li><a href="./country/IND">India</a></li><li><a href="./country/ITA">Italy</a></li><li><a href="./country/JPN">Japan</a></li><li><a href="./country/POL">Poland</a></li><li><a href="./country/USA">United States</a></li></ul>
<div data-filter-group><h3 id="aggregates">Aggregates</h3><ul id="aggregate-list"><li><a href="./country/EA">Euro area</a></li></ul></div>
</section>

<section id="indicators" class="mm-home-list" data-filter="indicators" aria-labelledby="indicators-heading">
<h2 id="indicators-heading">Choose an indicator</h2>
<div class="mm-filter" data-filter-slot></div>
<details data-filter-group id="indicators-labour"><summary>Labour</summary><ul><li><a href="./indicator/M10">Employment rate</a></li><li><a href="./indicator/M11">Population 15-64</a></li><li><a href="./indicator/M09">Unemployment rate</a></li></ul></details>
<details data-filter-group id="indicators-prices"><summary>Prices</summary><ul><li><a href="./indicator/P01">CPI inflation</a></li></ul></details>
<details data-filter-group id="indicators-agri"><summary>Agriculture</summary><ul><li><a href="./indicator/A01">Cereal price index</a></li></ul></details>
<details data-filter-group id="indicators-global"><summary>Global</summary><ul><li><a href="./indicator/B01">World trade volume</a></li></ul></details>
<details data-filter-group id="indicators-fin"><summary>Financial</summary><ul><li><a href="./indicator/M18">10-year government bond yield spread</a></li></ul></details>
</section>

<ul class="mm-home-links" id="home-links"><li><a href="./explorer">Time series</a></li><li><a href="./domains">Domains</a></li><li><a href="./revisions">Revisions</a></li></ul>
</details>
</section>

```js
mountFilters(document);
```
