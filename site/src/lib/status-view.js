// Renders the V5 status view from the view-model of status.js. `html` (htl) is passed in, so this
// file imports only the pure view-model. Display only: every figure is the exported one.
import {BACKLOG_NOTE, COUNTS_NOTE, COV01_NOTE, LOAD_NOTE, WINDOW_NOTE} from "./status.js";

// Feed-state glyphs (T128): inline SVG, defined once per view, aria-hidden, drawn in currentColor; the word stays visible beside them.
function feedSprite(html) {
  return html`<svg class="mm-sprite" aria-hidden="true" focusable="false" width="0" height="0"><defs>
<symbol id="mm-fg-check" viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></symbol>
<symbol id="mm-fg-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></symbol>
<symbol id="mm-fg-hourglass" viewBox="0 0 16 16"><path d="M3.5 2H12.5M3.5 14H12.5M4.5 2C4.5 6 8 7 8 8C8 9 4.5 10 4.5 14M11.5 2C11.5 6 8 7 8 8C8 9 11.5 10 11.5 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></symbol>
<symbol id="mm-fg-cross" viewBox="0 0 16 16"><path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></symbol>
<symbol id="mm-fg-dash" viewBox="0 0 16 16"><path d="M3 8H13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></symbol>
</defs></svg>`;
}

// Chip: glyph (decorative) + the state word + a 1 px border whose pattern is part of the signature (AC-UX-2).
const feedChip = (html, f) => html`<span class="mm-feed" data-feed="${f.key}" data-signature="${f.signature}"><svg class="mm-glyph" aria-hidden="true" focusable="false" viewBox="0 0 16 16"><use href="#mm-fg-${f.glyph}"></use></svg> <span class="mm-feed-word">${f.code}</span></span>`;

export function statusPage(html, vm) {
  const lr = vm.lastRun;
  return html`<div class="mm-status-view">${feedSprite(html)}
<section id="last-run"><h2>Last run</h2>
<dl><dt>Run</dt><dd id="run-id">${lr.id} (${lr.mode})</dd><dt>Started</dt><dd>${lr.started}</dd><dt>Finished</dt><dd>${lr.finished}</dd>
<dt>New raw objects</dt><dd>${lr.newRawObjects}</dd><dt>New observations</dt><dd>${lr.newObservations}</dd><dt>Revisions</dt><dd>${lr.revisions}</dd>
<dt>Active alerts</dt><dd id="active-alerts" data-none="${vm.alerts.none}">${vm.alerts.value}</dd></dl>
<p class="mm-note">${COUNTS_NOTE}</p></section>
<section id="groups"><h2>Source groups</h2>
${vm.groups.length ? html`<table id="group-table"><thead><tr><th>Source group</th><th>Series group</th><th>State</th><th>Expected period end</th><th>Latest period end</th><th>Evaluated at</th><th>Load result</th></tr></thead><tbody>${vm.groups.map(
    (g) => html`<tr data-state="${g.state}"><td>${g.source}</td><td>${g.series}</td><td>${feedChip(html, g.feed)}</td><td>${g.expected}</td><td>${g.latest}</td><td>${g.evaluated}</td><td>${g.load}</td></tr>`
  )}</tbody></table>` : html`<p>No source groups in the export.</p>`}
<p class="mm-note">${LOAD_NOTE}</p></section>
<section id="backlog"><h2>Backlog</h2>
<dl><dt>Unloaded raw objects</dt><dd id="backlog-n">${vm.backlog.unloaded}</dd><dt>Oldest</dt><dd>${vm.backlog.oldest}</dd></dl>
<p class="mm-note">${BACKLOG_NOTE}</p></section>
<section id="validation"><h2>Validation</h2>
${vm.counts.length ? html`<table id="validation-counts"><thead><tr><th>Check family</th><th>Severity</th><th class="mm-num">Results</th><th class="mm-num">Failed</th></tr></thead><tbody>${vm.counts.map(
    (c) => html`<tr><td>${c.family}</td><td>${c.severity}</td><td class="mm-num">${c.results}</td><td class="mm-num">${c.failed}</td></tr>`
  )}</tbody></table>` : html`<p>No validation results for this run.</p>`}
<h3>Coverage (COV-01)</h3>
${vm.cov01.length ? html`<table id="cov01"><thead><tr><th>Indicator</th><th>State</th><th class="mm-num">Qualifying entities</th><th class="mm-num">Results</th><th class="mm-num">Failed</th></tr></thead><tbody>${vm.cov01.map(
    (c) => html`<tr data-state="${c.state}"><td>${c.indicator}</td><td>${c.stateLabel}</td><td class="mm-num">${c.qualifying}</td><td class="mm-num">${c.results}</td><td class="mm-num">${c.failed}</td></tr>`
  )}</tbody></table>` : html`<p>No COV-01 entries.</p>`}
<p class="mm-note">${COV01_NOTE}</p>
<h3>Open drift events</h3>
<p id="drift-open">${vm.drift.open} open${vm.drift.kinds.length ? html`: ${vm.drift.kinds.map((k, i) => html`${i ? ", " : ""}${k.kind} ${k.n}`)}` : ""}.</p></section>
<section id="manual"><h2>Next manual download</h2>
${vm.manual.length ? html`<table id="manual-table"><thead><tr><th>Source</th><th>Next expected</th><th>Last edition</th><th>Last ingested</th></tr></thead><tbody>${vm.manual.map(
    (m) => html`<tr><td>${m.source}</td><td>${m.next}</td><td>${m.lastEdition}</td><td>${m.lastIngested}</td></tr>`
  )}</tbody></table>` : html`<p>No manual sources.</p>`}
<p class="mm-note">${WINDOW_NOTE}</p></section>
<section id="monthly-check"><h2>Monthly check</h2><p id="monthly-check-text">${vm.check.text}</p><p class="mm-note">Text generated ${vm.check.generatedAt}.</p></section></div>`;
}
