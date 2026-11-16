// V53 (ADR-037 A2.2, spec A2.2; AC-V2-110, 111, 113, 114, 116): the model of C6, the choropleth map. The rows, the reference period and the drawn/hidden split are the C2 selection
// (barListModel, which calls splitByCoverage once); this module only places each stored row on the stored geometry through the static join table. Colour comes from the stored value
// (the lowest and highest shown value are picked by order, never by arithmetic); there are no classes. A row is exactly one of: drawn (colour), hatched (a shape the C2 selection hides
// because it has no stored value), plain (a shape the C2 selection hides although it has a stored value: another period, a stale row, another frequency; the hatch is for blank
// cells only, A1.1), or not mapped (an aggregate, an outside-extent country, or a country with no shape). Every row stays in the hidden array or the drawn list: none is dropped.
// Display only: nothing is computed here. The geometry features and the join table are passed in (read by the page).
import {DRAFT_HIDDEN_REASON_LABELS, DRAFT_C6_NOT_MAPPED, DRAFT_C6_NOT_MAPPED_SENTENCE, DRAFT_C6_SCALE, DRAFT_C6_STORED, DRAFT_NOT_STATED} from "./copy.11b4a285.js";
import {barListModel} from "./bar-list.91fbd676.js";
import {buildCaption} from "./caption.efba8170.js";
import {valueExtent} from "./compare-data.27349a39.js";
import {checkCompatible} from "./compat.b6f64b1c.js";
import {valueText} from "./explorer.8bfe86f4.js";
import {scaleKind} from "./time-heatmap.5346feb2.js";
import {valueWithUnit} from "./tip.5281e05d.js";
import {i18n} from "./i18n.4f9e47d5.js";
const X = (key, params) => i18n.t(key, params);

// The position of a small-country marker: the first stored vertex of the shape (a stored coordinate, picked by index; the centroid of a shape is a computation and is not made here).
const anchorOf = (g) => (g?.type === "MultiPolygon" ? g.coordinates[0][0][0] : g?.type === "Polygon" ? g.coordinates[0][0] : null);

// input: as barListModel, plus `join` ({rows: [{entity_id, feature_id, marker, outside_extent}]}) and `asset` (a FeatureCollection whose feature properties.id is the join feature_id).
export function choroplethModel({join = null, asset = null, geoFailed = false, ...rest} = {}) {
  const base = barListModel(rest);
  const features = geoFailed ? [] : (asset?.features ?? []);
  const featureById = new Map(features.map((f) => [f.properties?.id, f]));
  const joinById = new Map((geoFailed ? [] : (join?.rows ?? [])).map((r) => [r.entity_id, r]));
  const c2Hidden = new Map(base.hidden.map((h) => [h.row.entityId, h.reason]));
  const barById = new Map(base.bars.map((r) => [r.entityId, r]));
  const unit = base.unit;
  const stored = (r) => (r.hasValue ? DRAFT_C6_STORED(valueWithUnit(valueText(r.value), unit), r.periodText ?? DRAFT_NOT_STATED) : (r.state?.sentence || DRAFT_NOT_STATED));
  const note = (r, why) => ({...r, mapNote: DRAFT_C6_NOT_MAPPED_SENTENCE(DRAFT_C6_NOT_MAPPED[why], stored(r))});
  const tipOf = (r) => [r.name, r.hasValue ? valueWithUnit(valueText(r.value), unit) : DRAFT_NOT_STATED, r.periodText ?? DRAFT_NOT_STATED, ...(r.estimate ? [X("TIP_STATUS.EST")] : [])].join("\n");

  const mapped = [];
  const hatched = [];
  const plain = [];
  const notMapped = [];
  const hidden = [];
  for (const r of base.rows) {
    const j = joinById.get(r.entityId) ?? null;
    const feature = j && j.outside_extent !== true ? (featureById.get(j.feature_id) ?? null) : null;
    if (r.kind === "aggregate") {
      const n = note(r, "aggregate");
      notMapped.push(n);
      hidden.push({row: n, reason: "other"});
    } else if (j?.outside_extent === true) {
      const n = note(r, "outside");
      notMapped.push(n);
      hidden.push({row: n, reason: "other"});
    } else if (feature === null) {
      // No shape: not dropped. A row the C2 selection already hid keeps its reason; a row that would have been drawn goes to `other`.
      const n = note(r, "nogeometry");
      notMapped.push(n);
      hidden.push({row: n, reason: c2Hidden.get(r.entityId) ?? "other"});
    } else if (c2Hidden.has(r.entityId)) {
      const reason = c2Hidden.get(r.entityId);
      const entry = {entityId: r.entityId, name: r.name, featureId: j.feature_id, marker: j.marker === true, position: j.marker === true ? anchorOf(feature.geometry) : null, geometry: feature.geometry, row: r, reason, tip: `${tipOf(r)}\n${DRAFT_HIDDEN_REASON_LABELS[reason]}`};
      (r.hasValue ? plain : hatched).push(entry);
      hidden.push({row: r, reason});
    } else {
      const bar = barById.get(r.entityId) ?? r;
      mapped.push({entityId: r.entityId, name: r.name, featureId: j.feature_id, marker: j.marker === true, position: j.marker === true ? anchorOf(feature.geometry) : null, geometry: feature.geometry, row: bar, value: bar.value, text: valueText(bar.value), periodText: bar.periodText, other: bar.other === true, estimate: bar.estimate === true, tip: tipOf(bar)});
    }
  }
  const metas = mapped.map((r) => r.row.meta).filter(Boolean);
  const compat = checkCompatible(metas);
  const extent = valueExtent(mapped.map((r) => r.value));
  const kind = scaleKind(extent);
  const scaleText = extent === null ? null : DRAFT_C6_SCALE(valueText(extent.min), valueText(extent.max));
  return {
    indicator: base.indicator,
    indicatorId: base.indicatorId,
    name: base.name,
    unit,
    referencePeriod: base.referencePeriod,
    referenceLabel: base.referenceLabel,
    noReference: base.noReference,
    rows: base.rows,
    mapped,
    hatched,
    markers: mapped.filter((r) => r.marker),
    hatchedMarkers: hatched.filter((r) => r.marker),
    plain,
    plainMarkers: plain.filter((r) => r.marker),
    notMapped,
    hidden,
    outline: {type: "FeatureCollection", features},
    geoFailed,
    extent,
    scaleKind: kind,
    scaleText,
    metas,
    compat,
    blocked: compat.status === "blocked",
    caption: buildCaption({indicator: base.indicator, series: metas, range: base.referencePeriod ? {from: base.referencePeriod, to: base.referencePeriod} : null, knownCutoff: rest.knownCutoff ?? null, statuses: mapped.some((r) => r.estimate) ? ["EST"] : [], scale: scaleText})
  };
}
