// Redesign R18: the static lists of PG-HOME (spec 4.1 C-HOME-2..4) and their progressive-enhancement filter. The lists are HTML strings
// written into the generated page, so every country and indicator link is in the built HTML without JavaScript; `mountFilters` (browser
// only) then adds one labelled text filter per list, which only sets `hidden`. Display only: no value is computed here.
import {
  HOME_AGGREGATES_HEADING, HOME_COUNTRIES_HEADING, DRAFT_HOME_FILTER_COUNT, HOME_FILTER_LABEL, DRAFT_HOME_FILTER_NONE,
  HOME_INDICATORS_HEADING, HOME_LINKS, OTHER_INDICATORS_GROUP
} from "./copy.js";
import {SAFE_ID} from "./domains-list.js";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const byName = (a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const safe = (id, what) => {
  if (!SAFE_ID.test(id)) throw new Error(`unsafe ${what}: ${JSON.stringify(id)}`);
  return id;
};

// Entities that have a country page (not is_global), split by kind: countries first, aggregates after; each alphabetical by name.
export function countryGroups(entities) {
  const rows = entities.filter((e) => e.is_global !== true).map((e) => ({id: safe(e.entity_id, "entity_id"), name: e.name ?? e.entity_id, kind: e.kind}));
  return {countries: rows.filter((r) => r.kind === "country").sort(byName), aggregates: rows.filter((r) => r.kind !== "country").sort(byName)};
}

// One group per domain of meta/domains.json (file order) holding the indicators that name it in `domain_ids` (one in two domains is in both);
// indicators naming no known domain go to a last group, so every indicator has a link (AC-RD-02). Indicators sorted by name.
export function indicatorGroups(indicators, domains) {
  const known = new Set(domains.map((d) => d.domain_id));
  const rows = indicators.map((i) => ({id: safe(i.indicator_id, "indicator_id"), name: i.name ?? i.indicator_id, domainIds: Array.isArray(i.domain_ids) ? i.domain_ids : []}));
  const groups = domains.map((d) => ({id: d.domain_id, name: d.name ?? d.domain_id, items: rows.filter((r) => r.domainIds.includes(d.domain_id)).sort(byName)}));
  const other = rows.filter((r) => !r.domainIds.some((x) => known.has(x))).sort(byName);
  if (other.length) groups.push({id: "other", name: OTHER_INDICATORS_GROUP, items: other});
  return groups.filter((g) => g.items.length > 0);
}

const li = (kind, r) => `<li><a href="./${kind}/${esc(r.id)}">${esc(r.name)}</a></li>`;

export function homeListsHtml({entities, indicators, domains}) {
  const c = countryGroups(entities);
  const groups = indicatorGroups(indicators, domains);
  const aggregates = c.aggregates.length
    ? `<div data-filter-group><h3 id="aggregates">${esc(HOME_AGGREGATES_HEADING)}</h3><ul id="aggregate-list">${c.aggregates.map((r) => li("country", r)).join("")}</ul></div>`
    : "";
  const details = groups.map((g) => `<details data-filter-group id="indicators-${esc(g.id)}"><summary>${esc(g.name)}</summary><ul>${g.items.map((r) => li("indicator", r)).join("")}</ul></details>`).join("\n");
  return `<section id="countries" class="mm-home-list" data-filter="countries" aria-labelledby="countries-heading">
<h2 id="countries-heading">${esc(HOME_COUNTRIES_HEADING)}</h2>
<div class="mm-filter" data-filter-slot></div>
<ul id="country-list">${c.countries.map((r) => li("country", r)).join("")}</ul>
${aggregates}
</section>

<section id="indicators" class="mm-home-list" data-filter="indicators" aria-labelledby="indicators-heading">
<h2 id="indicators-heading">${esc(HOME_INDICATORS_HEADING)}</h2>
<div class="mm-filter" data-filter-slot></div>
${details}
</section>

<ul class="mm-home-links" id="home-links"><li><a href="./explorer">${esc(HOME_LINKS.series)}</a></li><li><a href="./domains">${esc(HOME_LINKS.domains)}</a></li><li><a href="./revisions">${esc(HOME_LINKS.revisions)}</a></li></ul>`;
}

// Case-insensitive substring match; an empty query matches everything.
export const matches = (text, query) => String(text).toLowerCase().includes(String(query).trim().toLowerCase());

// Applies `query` inside `section`: hides non-matching list items, hides a group (`[data-filter-group]`) with no match and opens a matching
// <details> while a query is active; an empty query restores everything and the groups' original open state. Returns the shown count.
export function applyFilter(section, query) {
  const active = String(query).trim() !== "";
  for (const item of section.querySelectorAll("li")) item.hidden = active && !matches(item.textContent, query);
  for (const g of section.querySelectorAll("[data-filter-group]")) {
    const any = [...g.querySelectorAll("li")].some((x) => !x.hidden);
    g.hidden = active && !any;
    if (g.tagName === "DETAILS") {
      if (active) g.open = any;
      else g.open = g.dataset.open === "1";
    }
  }
  // Unique links: an indicator listed under two domains counts once.
  const hrefs = new Set();
  for (const x of section.querySelectorAll("li")) if (!x.hidden) hrefs.add(x.querySelector?.("a")?.getAttribute("href") ?? x.textContent);
  return hrefs.size;
}

// Browser only: one labelled search input and a polite status line per `section[data-filter]` (inserted after the heading).
export function mountFilters(doc) {
  for (const section of doc.querySelectorAll("section[data-filter]")) {
    if (section.querySelector("input")) continue;
    const key = section.dataset.filter;
    const id = `filter-${key}`;
    const wrap = section.querySelector("[data-filter-slot]") ?? doc.createElement("div");
    wrap.className = "mm-filter";
    wrap.innerHTML = `<label for="${id}">${esc(HOME_FILTER_LABEL[key])}</label> <input type="search" id="${id}" autocomplete="off"><p class="mm-filter-status" role="status" id="${id}-status"></p>`;
    if (!wrap.parentNode) section.querySelector("h2").after(wrap);
    for (const d of section.querySelectorAll("details")) d.dataset.open = d.open ? "1" : "0";
    const input = wrap.querySelector("input");
    const status = wrap.querySelector("p");
    input.addEventListener("input", () => {
      const shown = applyFilter(section, input.value);
      status.textContent = input.value.trim() === "" ? "" : shown === 0 ? DRAFT_HOME_FILTER_NONE : DRAFT_HOME_FILTER_COUNT(shown);
    });
  }
}
