import {headerHtml} from "./src/lib/shell.js";
import {i18n} from "./src/lib/i18n.js";
import {langSettings} from "./scripts/lib/lang-config.mjs";
import {DRAFT_CRUMB_HOME, DRAFT_MODE_LABELS, HOME_LINKS} from "./src/lib/copy.js";

// Macro Monitor dashboard site (ADR-010, ADR-023). Static build; no request may leave the origin.
const title = i18n.t("SITE_TITLE");
// V42 (ADR-037 A2.1): MM_LANG (en default, uk) drives base and output; English stays at "/" in dist, Ukrainian is built under "/uk/" into dist-uk.
const {lang, base, output} = langSettings(process.env.MM_LANG, process.env.MM_BASE_PREFIX);
// Header navigation (AC-RD-01, decisions G-STR4 as replaced by D-1, ADR-037 A2.6 item 2, spec section 2): exactly these six, in this order.
// "Country" is the static country list page (A1.7); the language switch (A2.1) is not a page and stays outside this list.
const pages = [{name: DRAFT_CRUMB_HOME, path: "/"}, {name: DRAFT_MODE_LABELS.country, path: "/country"}, {name: DRAFT_MODE_LABELS.compare, path: "/compare"}, {name: HOME_LINKS.series, path: "/explorer"}, {name: HOME_LINKS.domains, path: "/domains"}, {name: HOME_LINKS.revisions, path: "/revisions"}];

export default {
  title,
  root: "src",
  output,
  base,
  pages,
  // T104: static header (skip link, title, `pages` nav). Framework's sidebar, pager and contents list stay off so the
  // header is the only navigation and no empty nav landmark is emitted.
  header: ({path}) => headerHtml({title, pages, path, lang}),
  // V46 (OQ-20): no `head` alternate links. Framework 1.13.4 resolves every local href of `head` as a file to copy and the build stops ("Not found: /compare", verified); the header link carries lang and hreflang instead.
  toc: false,
  pager: false,
  search: false,
  sidebar: false,
  // T101 (ADR-025 decision 1): the project stylesheet replaces the theme and imports Framework base/themes locally.
  style: "style.css",
  // ADR-023 decision 4: the default theme loads Google Fonts (breaks AC-DASH-1). System fonts only;
  // any web font must be self-hosted under src/ with its licence recorded.
  globalStylesheets: [],
  // T130: the second paragraph is print-only (style.css). The script fills in the page URL and, because page.pdf() and browsers differ
  // in whether closed <details> print open, opens every <details> before printing and restores them afterwards.
  footer: `Macro Monitor. Data from public sources, attributed per page. Not investment advice.<p class="mm-print-url">Page URL: <span id="mm-print-url"></span></p><script>(function(){var s=function(){var e=document.getElementById("mm-print-url");if(e)e.textContent=location.href},c=[];s();addEventListener("beforeprint",function(){s();c=[].slice.call(document.querySelectorAll("details:not([open])"));c.forEach(function(d){d.open=true})});addEventListener("afterprint",function(){c.forEach(function(d){d.open=false});c=[]})})()</script>`
};
