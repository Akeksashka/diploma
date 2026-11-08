// Combined URL-hash state (dashboard redesign spec 1.5): #i=<indicator_id>&c=<entity_id>[,<entity_id>...]&g=<group_id>.
// Each part is optional. The old peers form #c=<entity_id> is a valid subset. Pure functions; nothing is computed
// beyond splitting and validating. Invalid input never throws: invalid parts fall back to the default and `note` is true.
const KEYS = ["i", "c", "g"];
const ID = /^[A-Za-z0-9_.-]+$/;

export function emptyHashState() {
  return {i: null, c: [], g: null, note: false};
}

// known: optional {indicators, entities, groups} Sets; when given, ids not in the set are invalid.
// maxEntities: optional cap on c; extra entries are invalid (dropped, note set). Default: no cap.
export function parseHash(hash, known = {}, {maxEntities = Infinity} = {}) {
  const out = emptyHashState();
  if (hash == null || hash === "" || hash === "#") return out;
  if (typeof hash !== "string" || !hash.startsWith("#")) return {...out, note: true};
  const seen = new Set();
  for (const part of hash.slice(1).split("&")) {
    const [key, ...rest] = part.split("="); // key before the first "=", raw is everything after it
    const raw = rest.join("=");
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
    } else {
      const set = key === "i" ? known.indicators : known.groups;
      if (ID.test(raw) && (!set || set.has(raw))) out[key] = raw;
      else out.note = true;
    }
  }
  return out;
}

// state: {i?, c?, g?}. Empty parts are omitted; returns "" when nothing is set.
export function serializeHash(state = {}) {
  const parts = [];
  if (state.i) parts.push(`i=${state.i}`);
  if (state.c && state.c.length) parts.push(`c=${state.c.join(",")}`);
  if (state.g) parts.push(`g=${state.g}`);
  return parts.length ? `#${parts.join("&")}` : "";
}
