---
title: Country scorecards
---

# Country scorecards

```js
import {parseManifest} from "./lib/manifest.js";
import {listOf} from "./lib/meta.js";
import {pageHead} from "./lib/shell.js";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
```

```js
// Loading container (aria-busy while the files are fetched); reserved height is set in style.css.
const busy = busyBlock(html, R.loadingData);
display(busy);
```

```js
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest},
  {key: "domains", region: R.domains, load: () => FileAttachment("data/meta/domains.json").json(), parse: (d) => listOf(d, "domains")}
]);
setBusy(busy, false);
```

```js
display(pageHead(html, boot, "landing"));
```

<p class="mm-caveat" id="caveat">Percentiles are relative position in the covered panel, not a judgement of structural quality.</p>

```js
if (boot.ok) display(html`<ul id="domain-list">${boot.data.domains.map((d) => html`<li><a href="./domain/${d.domain_id}">${d.name}</a>${d.ranked ? "" : html` <em>(${d.notices.length ? d.notices.join("; ") : "informational, unranked"})</em>`}</li>`)}</ul>`);
```

<p><a href="./explorer">Time-series explorer</a> | <a href="./revisions">Vintage and revision view</a> | <a href="./status">Data status</a></p>
