// Combined URL-hash state (dashboard redesign spec 1.5): #i=<indicator_id>&c=<entity_id>[,<entity_id>...]&g=<group_id>&d=<domain_id>&f=<D|M|Q|A>&from=<YYYY>&to=<YYYY> (layout amendment 2.3).
// Each part is optional. The old peers form #c=<entity_id> is a valid subset. Pure functions; nothing is computed
// beyond splitting and validating. Invalid input never throws: invalid parts fall back to the default and `note` is true.
// v2 (A1.3): x, y, p, pc, ctx, oth, stl, rb appended in that order. `m` and `proj` are removed keys: ignored, neither parsed nor written, no note.
const KEYS = ["i", "c", "g", "d", "f", "from", "to", "x", "y", "p", "pc", "ctx", "oth", "stl", "rb"];
const IGNORED = ["m", "proj"];
const FLAGS = ["pc", "ctx", "oth", "stl"]; // 0|1, default 0 (false)
// One reference period: YYYY, YYYY-Qn (n 1..4) or YYYY-MM (01..12). Never a range, never an alias of from/to.
const PERIOD = /^[0-9]{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/;
const ID = /^[A-Za-z0-9_.-]+$/;
const FREQUENCIES = ["D", "M", "Q", "A"];
const YEAR = /^[0-9]{4}$/;

export function emptyHashState() {
  return {i: null, c: [], g: null, d: null, f: null, from: null, to: null, x: null, y: null, p: null, pc: false, ctx: false, oth: false, stl: false, rb: null, note: false};
}

// known: optional {indicators, entities, groups, domains} Sets and {bounds: {from, to}} (inclusive years); when given, ids not in the
// set are invalid. maxEntities: optional cap on c; extra entries are invalid (dropped, note set). Default: no cap.
// known.periods: optional Set of the stored common periods; a p outside it is absent (note). known.basePeriods: optional Set for rb.
// x, y are indicator ids (known.indicators). pc, ctx, oth, stl accept 0|1 only; 0 is the default.
// from/to (layout amendment 2.3) are valid only as a pair with from <= to inside the bounds; otherwise both are ignored with the note.
export function parseHash(hash, known = {}, {maxEntities = Infinity} = {}) {
  const out = emptyHashState();
  if (hash == null || hash === "" || hash === "#") return out;
  if (typeof hash !== "string" || !hash.startsWith("#")) return {...out, note: true};
  const seen = new Set();
  const years = {};
  for (const part of hash.slice(1).split("&")) {
    const [key, ...rest] = part.split("="); // key before the first "=", raw is everything after it
    const raw = rest.join("=");
    if (IGNORED.includes(key)) continue;
    if (!KEYS.includes(key) || seen.has(key)) {
      out.note = true;
      continue;
    }
    seen.add(key);
    if (key === "c") {
      const ids = [];
      for (const id of raw.split(",")) {
        const ok = ID.test(id) && (!known.entities || known.entities.has(id)) && !ids.includes(id) && ids.length < maxEntities;
        if (ok) ids.push(id);
        else out.note = true;
      }
      out.c = ids;
    } else if (key === "from" || key === "to") {
      years[key] = raw;
    } else if (key === "f") {
      if (FREQUENCIES.includes(raw)) out.f = raw;
      else out.note = true;
    } else if (FLAGS.includes(key)) {
      if (raw === "0" || raw === "1") out[key] = raw === "1";
      else out.note = true;
    } else if (key === "p" || key === "rb") {
      const set = key === "p" ? known.periods : known.basePeriods;
      if (PERIOD.test(raw) && (!set || set.has(raw))) out[key] = raw;
      else out.note = true;
    } else {
      const set = {i: known.indicators, x: known.indicators, y: known.indicators, g: known.groups, d: known.domains}[key];
      if (ID.test(raw) && (!set || set.has(raw))) out[key] = raw;
      else out.note = true;
    }
  }
  if (seen.has("from") || seen.has("to")) {
    const {from, to} = years;
    const lo = known.bounds?.from ?? -Infinity;
    const hi = known.bounds?.to ?? Infinity;
    const ok = from !== undefined && to !== undefined && YEAR.test(from) && YEAR.test(to) && Number(from) <= Number(to) && Number(from) >= lo && Number(to) <= hi;
    if (ok) {
      out.from = Number(from);
      out.to = Number(to);
    } else out.note = true;
  }
  return out;
}

// state: {i?, c?, g?, d?, f?, from?, to?, x?, y?, p?, pc?, ctx?, oth?, stl?, rb?}. Fixed order i, c, g, d, f, from, to, x, y, p, pc, ctx, oth, stl, rb so one state gives one hash. Empty parts are omitted;
// returns "" when nothing is set. A state read by parseHash and written back keeps every parameter the page did not touch.
export function serializeHash(state = {}) {
  const parts = [];
  if (state.i) parts.push(`i=${state.i}`);
  if (state.c && state.c.length) parts.push(`c=${state.c.join(",")}`);
  if (state.g) parts.push(`g=${state.g}`);
  if (state.d) parts.push(`d=${state.d}`);
  if (state.f) parts.push(`f=${state.f}`);
  if (state.from != null && state.to != null) parts.push(`from=${state.from}`, `to=${state.to}`);
  if (state.x && ID.test(state.x)) parts.push(`x=${state.x}`);
  if (state.y && ID.test(state.y)) parts.push(`y=${state.y}`);
  if (state.p && PERIOD.test(state.p)) parts.push(`p=${state.p}`);
  for (const k of FLAGS) if (state[k] === true || state[k] === 1) parts.push(`${k}=1`);
  if (state.rb && PERIOD.test(state.rb)) parts.push(`rb=${state.rb}`);
  return parts.length ? `#${parts.join("&")}` : "";
}
