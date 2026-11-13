// Dependency-free shapefile (.shp polygon + .dbf) reader and Europe-extent preparation (ADR-037 A2.2,
// plan V50). The input is untrusted data: it is only parsed, with bounds checks; nothing in it is executed.
export const EUROPE_EXTENT = Object.freeze({minLon: -25, maxLon: 45, minLat: 34, maxLat: 72});
const MAX_RECORDS = 100000;

function fail(msg) {
  throw new Error(`shapefile: ${msg}`);
}

/** Polygon (type 5) records of a .shp as arrays of rings [[x, y], ...]; null shapes yield an empty array. */
export function readShp(buf) {
  if (buf.length < 100 || buf.readInt32BE(0) !== 9994) fail("bad .shp header");
  const type = buf.readInt32LE(32);
  if (type !== 5) fail(`shape type ${type} is not Polygon (5)`);
  const records = [];
  let o = 100;
  while (o + 8 <= buf.length) {
    if (records.length >= MAX_RECORDS) fail("too many records");
    const len = buf.readInt32BE(o + 4) * 2;
    const start = o + 8;
    if (len < 4 || start + len > buf.length) fail("record out of bounds");
    const t = buf.readInt32LE(start);
    if (t === 0) records.push([]);
    else if (t !== 5) fail(`record shape type ${t}`);
    else {
      const nParts = buf.readInt32LE(start + 36);
      const nPoints = buf.readInt32LE(start + 40);
      if (nParts < 0 || nPoints < 0 || 44 + nParts * 4 + nPoints * 16 > len) fail("record counts out of bounds");
      const parts = [];
      for (let i = 0; i < nParts; i++) parts.push(buf.readInt32LE(start + 44 + i * 4));
      const pOff = start + 44 + nParts * 4;
      const rings = [];
      for (let i = 0; i < nParts; i++) {
        const a = parts[i];
        const b = i + 1 < nParts ? parts[i + 1] : nPoints;
        if (a < 0 || b < a || b > nPoints) fail("part index out of bounds");
        const ring = [];
        for (let j = a; j < b; j++) ring.push([buf.readDoubleLE(pOff + j * 16), buf.readDoubleLE(pOff + j * 16 + 8)]);
        rings.push(ring);
      }
      records.push(rings);
    }
    o = start + len;
  }
  return records;
}

/** dBASE III/IV attribute table as an array of {FIELD: string}. Character and numeric fields only. */
export function readDbf(buf) {
  if (buf.length < 33) fail("bad .dbf header");
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields = [];
  let o = 32;
  while (o < headerLen && buf[o] !== 0x0d) {
    fields.push({name: buf.toString("latin1", o, o + 11).replace(/\0.*$/s, ""), len: buf[o + 16]});
    o += 32;
  }
  if (headerLen + n * recLen > buf.length) fail(".dbf record data out of bounds");
  const rows = [];
  for (let r = 0; r < n; r++) {
    let p = headerLen + r * recLen + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = buf.toString("utf8", p, p + f.len).replace(/\0/g, "").trim();
      p += f.len;
    }
    rows.push(row);
  }
  return rows;
}

const signedArea = (ring) => {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
};

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Group rings into polygons: clockwise (negative area) = exterior, counter-clockwise = hole (shapefile rule). */
export function ringsToPolygons(rings) {
  const polys = [];
  const holes = [];
  for (const r of rings) {
    if (r.length < 4) continue;
    (signedArea(r) <= 0 ? polys.push([r]) : holes.push(r));
  }
  for (const h of holes) {
    const host = polys.find((p) => pointInRing(h[0], p[0]));
    if (host) host.push(h);
  }
  return polys;
}

function clipEdge(ring, inside, cross) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    const ci = inside(cur);
    const pi = inside(prev);
    if (ci) {
      if (!pi) out.push(cross(prev, cur));
      out.push(cur);
    } else if (pi) out.push(cross(prev, cur));
  }
  return out;
}

/** Sutherland-Hodgman clip of one ring to the lon/lat rectangle. Returns a closed ring or null. */
export function clipRing(ring, e = EUROPE_EXTENT) {
  let pts = ring.slice(0, -1);
  const atX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const atY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const steps = [
    [(p) => p[0] >= e.minLon, atX(e.minLon)],
    [(p) => p[0] <= e.maxLon, atX(e.maxLon)],
    [(p) => p[1] >= e.minLat, atY(e.minLat)],
    [(p) => p[1] <= e.maxLat, atY(e.maxLat)],
  ];
  for (const [inside, cross] of steps) {
    if (!pts.length) return null;
    pts = clipEdge(pts, inside, cross);
  }
  return pts.length < 3 ? null : [...pts, pts[0]];
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Douglas-Peucker (planar degrees) on an open point list, endpoints kept. tol 0 returns the input. */
export function simplifyLine(pts, tol) {
  if (!(tol > 0) || pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (len2 === 0) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
        d = Math.hypot(pts[i][0] - ax - t * dx, pts[i][1] - ay - t * dy);
      }
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function roundRing(ring, tol = 0) {
  const simple = roundRingPlain(ring, tol);
  return simple ?? (tol > 0 ? roundRingPlain(ring, 0) : null);
}

function roundRingPlain(ring, tol) {
  const out = [];
  for (const [x, y] of simplifyLine(ring.slice(0, -1), tol)) {
    const p = [round2(x), round2(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length < 3 ? null : [...out, out[0]];
}

/**
 * Europe-clipped FeatureCollection. Parts wholly outside the extent (overseas territories) are dropped,
 * crossing parts are clipped, coordinates are rounded to 2 decimals. Ring winding is the shapefile one
 * (exterior clockwise, the d3-geo convention; not RFC 7946). Properties: id (idField), name (nameField).
 */
export function buildEuropeCollection(records, attrs, {idField, nameField, extent = EUROPE_EXTENT, minPartArea = 0.002, simplify = 0} = {}) {
  if (records.length !== attrs.length) fail("record and attribute counts differ");
  const features = [];
  const dropped = [];
  records.forEach((rings, i) => {
    const id = attrs[i][idField];
    const name = attrs[i][nameField];
    const parts = [];
    for (const poly of ringsToPolygons(rings)) {
      const [outer, ...holes] = poly.map((r) => clipRing(r, extent)).map((r) => (r ? roundRing(r, simplify) : null));
      if (!outer) continue;
      parts.push([outer, ...holes.filter(Boolean)]);
    }
    const big = parts.filter((p) => Math.abs(signedArea(p[0])) >= minPartArea);
    const largest = [...parts].sort((a, b) => Math.abs(signedArea(b[0])) - Math.abs(signedArea(a[0])))[0];
    const kept = big.length ? big : largest ? [largest] : [];
    if (!kept.length) {
      dropped.push({id, name});
      return;
    }
    features.push({
      type: "Feature",
      properties: {id, name},
      geometry: kept.length === 1 ? {type: "Polygon", coordinates: kept[0]} : {type: "MultiPolygon", coordinates: kept},
    });
  });
  return {collection: {type: "FeatureCollection", features}, dropped};
}

/** Planar even-odd containment of [lon, lat] in a prepared feature (orientation independent). */
export function featureContains(feature, pt) {
  const g = feature.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((h) => pointInRing(pt, h)));
}

/** Release gate (plan V52, G-CRIMEA): the user's inspection must be recorded with a value and a date. */
export function crimeaReleaseProblems(source) {
  const out = [];
  if (!source || !source.crimea_checked_by_user) out.push("crimea_checked_by_user is not set (only the user records it)");
  if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(source.crimea_checked_date ?? "")) out.push("crimea_checked_date is not a YYYY-MM-DD date");
  return out;
}
