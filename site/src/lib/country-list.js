// V64 (A1.7, AC-V2-92): the static list of the country list page `/country`, the target of the header "Country" entry. Every entity of
// meta/entities.json that has a country page, countries first and aggregates in a labelled sub-list, each linking to /country/<entity_id>. It is an
// HTML string written into the generated page, so the links are in the built HTML without JavaScript. Display only: nothing is computed.
import {DRAFT_MODE_LABELS, HOME_AGGREGATES_HEADING, HOME_COUNTRIES_HEADING} from "./copy.js";
import {countryGroups} from "./home-lists.js";

export const COUNTRY_LIST_TITLE = DRAFT_MODE_LABELS.country;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const li = (r) => `<li><a href="./country/${esc(r.id)}" data-carry="country" data-carry-set="c=${esc(r.id)}">${esc(r.name)}</a></li>`;

export function countryListHtml(entities) {
  const c = countryGroups(entities);
  const aggregates = c.aggregates.length ? `<h3 id="aggregates">${esc(HOME_AGGREGATES_HEADING)}</h3><ul id="aggregate-list">${c.aggregates.map(li).join("")}</ul>` : "";
  return `<section id="countries" class="mm-home-list" aria-labelledby="countries-heading"><h2 id="countries-heading">${esc(HOME_COUNTRIES_HEADING)}</h2><ul id="country-list">${c.countries.map(li).join("")}</ul>${aggregates}</section>`;
}
