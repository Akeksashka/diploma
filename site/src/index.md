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

<section id="countries" class="mm-home-list" data-filter="countries" aria-labelledby="countries-heading">
<h2 id="countries-heading">Choose a country</h2>
<ul id="country-list"><li><a href="./country/FRA">France</a></li><li><a href="./country/DEU">Germany</a></li><li><a href="./country/IND">India</a></li><li><a href="./country/ITA">Italy</a></li><li><a href="./country/JPN">Japan</a></li><li><a href="./country/POL">Poland</a></li><li><a href="./country/USA">United States</a></li></ul>
<div data-filter-group><h3 id="aggregates">Aggregates</h3><ul id="aggregate-list"><li><a href="./country/EA">Euro area</a></li></ul></div>
</section>

<section id="indicators" class="mm-home-list" data-filter="indicators" aria-labelledby="indicators-heading">
<h2 id="indicators-heading">Choose an indicator</h2>
<details data-filter-group id="indicators-labour"><summary>Labour</summary><ul><li><a href="./indicator/M10">Employment rate</a></li><li><a href="./indicator/M11">Population 15-64</a></li><li><a href="./indicator/M09">Unemployment rate</a></li></ul></details>
<details data-filter-group id="indicators-prices"><summary>Prices</summary><ul><li><a href="./indicator/P01">CPI inflation</a></li></ul></details>
<details data-filter-group id="indicators-agri"><summary>Agriculture</summary><ul><li><a href="./indicator/A01">Cereal price index</a></li></ul></details>
<details data-filter-group id="indicators-global"><summary>Global</summary><ul><li><a href="./indicator/B01">World trade volume</a></li></ul></details>
<details data-filter-group id="indicators-fin"><summary>Financial</summary><ul><li><a href="./indicator/M18">10-year government bond yield spread</a></li></ul></details>
</section>

<ul class="mm-home-links" id="home-links"><li><a href="./explorer">Time series</a></li><li><a href="./domains">Domains</a></li><li><a href="./revisions">Revisions</a></li></ul>

```js
mountFilters(document);
```
