---
title: Data status
---

# Data freshness and status

```js
import {parseManifest} from "./lib/manifest.js";
import {pageHead} from "./lib/shell.js";
import {statusView} from "./lib/status.js";
import {statusPage} from "./lib/status-view.js";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
```

```js
const busy = busyBlock(html, R.loadingData);
display(busy);
```

```js
// FileAttachment must be called in the page (not in an imported module). A failed file becomes one alert (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest},
  {key: "status", region: R.status, load: () => FileAttachment("data/status.json").json(), parse: statusView}
]);
setBusy(busy, false);
```

```js
display(pageHead(html, boot, "status"));
if (boot.ok) display(statusPage(html, boot.data.status));
```
