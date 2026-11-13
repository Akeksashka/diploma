// Loader of the SYNTHETIC v2 fixture (tests/fixtures/v2_export, plan V7) for the Country-mode tests (V11 to V16). Invented data; not a measurement and not a real export.
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {countryModel} from "../../src/lib/country-model.js";
import {rowsFromJson} from "../../src/lib/explorer.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "v2_export");
export const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
export const manifest = load("manifest.json");
export const entities = load("meta/entities.json").entities;
export const indicators = load("meta/indicators.json").indicators;
export const series = load("meta/series.json").series;
export const domains = load("meta/domains.json").domains;
export const groups = load("meta/groups.json").groups;
export const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
export const seriesRows = (indicatorId) => rowsFromJson(load(`series/${indicatorId}.json`));
export const entity = (id) => entities.find((e) => e.entity_id === id);
export const inputsOf = (id) => ({entity: entity(id), entities, domains, scorecards, indicators, series, groups, knownCutoff: manifest.known_cutoff ?? null, bounds: {from: 2024, to: 2026}});
export const modelOf = (id) => countryModel(inputsOf(id));

// Plot stand-in: records the marks and returns an svg marker; every mark function returns {type, data, options}.
export function fakePlot() {
  const plots = [];
  const mark = (type) => (data, options) => ({type, data, options});
  const Plot = {plot: (o) => (plots.push(o), "<svg></svg>"), line: mark("line"), dot: mark("dot"), barX: mark("barX"), cell: mark("cell"), geo: mark("geo"), ruleX: mark("ruleX"), ruleY: mark("ruleY"), text: mark("text"), tip: mark("tip"), pointer: (o) => o};
  return {Plot, plots};
}
