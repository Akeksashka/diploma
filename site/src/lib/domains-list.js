// Redesign R17: the static list of the domains page (PG-DOMAINS, spec 4.5): name, notices and a link to PG-DOMAIN. No table.
// Returns an HTML string written into the generated page, so the list is in the built HTML without JavaScript. No imports but copy.js.
import {DRAFT_HOME_DOMAINS_TITLE, INFORMATIONAL_NOTICE} from "./copy.js";

export const DOMAINS_TITLE = DRAFT_HOME_DOMAINS_TITLE;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
export const SAFE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/;

export function domainsListHtml(domains) {
  // Order: the export's domain list sorted by domain_id (CR-9 open: no editorial order is invented here).
  const sorted = [...domains].sort((a, b) => (a.domain_id < b.domain_id ? -1 : a.domain_id > b.domain_id ? 1 : 0));
  const items = sorted.map((d) => {
    if (!SAFE_ID.test(d.domain_id)) throw new Error(`unsafe domain_id: ${JSON.stringify(d.domain_id)}`);
    const notices = Array.isArray(d.notices) ? d.notices : [];
    const shown = notices.length ? notices.join("; ") : d.ranked ? "" : INFORMATIONAL_NOTICE;
    const note = shown ? ` <em>(${esc(shown)})</em>` : "";
    return `<li><a href="./domain/${esc(d.domain_id)}">${esc(d.name ?? d.domain_id)}</a>${note}</li>`;
  });
  return `<ul id="domain-list">${items.join("")}</ul>`;
}
