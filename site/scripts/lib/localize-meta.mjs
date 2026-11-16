// Ukrainian build (MM_LANG=uk): replaces the English display names in the copied export meta (src/data/meta) with the reviewed Ukrainian names of
// src/i18n/names.uk.json, so every page, table, picker, chart label and generated page source reads one localized name. Only entries with status
// "reviewed" and non-empty text are applied; anything else keeps the stored English name (listed in i18n-report.json). Stable ids and every number are untouched.
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const reviewed = (e) => e?.status === "reviewed" && typeof e.t === "string" && e.t.trim() !== "";
const pick = (table, id) => (Object.hasOwn(table ?? {}, id) && reviewed(table[id]) ? table[id].t : null);

// meta: {domains, entities, indicators, series, groups} parsed meta documents; returns the number of names replaced per section.
// ui: {en, uk} dictionaries (optional): group names come from the GROUP_LABELS.<id> entries, and the stored English percentile_rank_label of a
// domain (the text of DOMAIN_FIGURE_LABEL) is replaced by its Ukrainian entry.
export function localizeMeta(meta, names, ui = null) {
  const done = {domains: 0, entities: 0, indicators: 0, sources: 0, groups: 0, labels: 0};
  const apply = (rows, idKey, field, table, counter) => {
    for (const r of rows) {
      const uk = pick(table, r[idKey]);
      if (uk !== null) { r[field] = uk; done[counter]++; }
    }
  };
  apply(meta.domains.domains, "domain_id", "name", names.domains, "domains");
  apply(meta.entities.entities, "entity_id", "name", names.entities, "entities");
  apply(meta.indicators.indicators, "indicator_id", "name", names.indicators, "indicators");
  apply(meta.series.series, "source_id", "source_name", names.sources, "sources");
  if (ui && meta.groups) {
    for (const g of meta.groups.groups) {
      const e = ui.uk[`GROUP_LABELS.${g.group_id}`];
      if (reviewed(e)) { g.name = e.t; done.groups++; }
    }
  }
  if (ui) done.labels += localizeLabels(meta.domains.domains, ui);
  return done;
}

// percentile_rank_label of a domain or scorecard object: the export stores the English DOMAIN_FIGURE_LABEL text; swap in the reviewed Ukrainian one.
export function localizeLabels(objects, ui) {
  const en = ui.en.DOMAIN_FIGURE_LABEL?.t;
  const uk = ui.uk.DOMAIN_FIGURE_LABEL;
  if (!en || !reviewed(uk)) return 0;
  const walk = (node) => {
    let n = 0;
    if (Array.isArray(node)) for (const x of node) n += walk(x);
    else if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "percentile_rank_label" && v === en) { node[k] = uk.t; n++; } else n += walk(v);
      }
    }
    return n;
  };
  return walk(objects);
}

const FILES = {domains: "domains.json", entities: "entities.json", indicators: "indicators.json", series: "series.json", groups: "groups.json"};

// Reads the four meta files from metaDir, localizes them and writes them back (JSON, one-space indent like the export).
export function localizeMetaDir(metaDir, names, ui = null) {
  const meta = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(readFileSync(join(metaDir, f), "utf8"))]));
  const done = localizeMeta(meta, names, ui);
  for (const [k, f] of Object.entries(FILES)) writeFileSync(join(metaDir, f), `${JSON.stringify(meta[k], null, 1)}\n`);
  // scorecards repeat the domain's percentile_rank_label
  const sc = join(metaDir, "..", "scorecard");
  if (ui && existsSync(sc)) {
    for (const f of readdirSync(sc).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(sc, f), "utf8"));
      if (localizeLabels([doc], ui) > 0) { writeFileSync(join(sc, f), `${JSON.stringify(doc, null, 1)}\n`); done.labels++; }
    }
  }
  return done;
}
