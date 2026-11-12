// L9 (layout amendment 2.1, 2.2, 2.5): the Period chip. <details><summary> ("Period: 2015 to 2025"), From and To year <select>s over the manifest
// bounds, presets All / Last 10 years / Last 5 years. Writes from/to only as a valid pair (from <= to, inside the bounds); a pair with from > to is
// refused with a visible message and nothing is written. Without bounds (manifest.history_start absent) no range is invented: the chip is disabled and
// the existing error block is shown.
import {DRAFT_FILTER_CHIP_SUMMARY, DRAFT_FILTER_LABELS as L, DRAFT_PERIOD_INVALID, DRAFT_PERIOD_PRESETS, DRAFT_PERIOD_REGION, DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE, DRAFT_PERIOD_VALUE} from "./copy.js";
import {periodBounds, presetRange} from "./filter-model.js";
import {wireChip} from "./filter-chip.js";
import {errorBlock} from "./state-blocks.js";

export const periodYears = (bounds) => (bounds ? Array.from({length: bounds.to - bounds.from + 1}, (_, k) => bounds.from + k) : []);

// {ok, from, to} for a pair the user chose; ok is false for from > to, a year outside the bounds, or no bounds.
export function validatePair(from, to, bounds) {
  const f = Number(from);
  const t = Number(to);
  if (!bounds || !Number.isInteger(f) || !Number.isInteger(t)) return {ok: false};
  if (f > t || f < bounds.from || t > bounds.to) return {ok: false};
  return {ok: true, from: f, to: t};
}

export const periodSummaryValue = (state) => (state.from != null && state.to != null ? DRAFT_PERIOD_VALUE(state.from, state.to) : DRAFT_PERIOD_PRESETS.all);

export function mountPeriodChip(html, {store, manifest}) {
  const bounds = periodBounds(manifest);
  const summary = html`<summary id="filter-period-summary"></summary>`;
  if (!bounds) {
    summary.textContent = DRAFT_FILTER_CHIP_SUMMARY(L.period, DRAFT_PERIOD_PRESETS.all);
    summary.setAttribute("aria-disabled", "true");
    const err = errorBlock(html, {region: DRAFT_PERIOD_REGION, kind: "missing", consequence: DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE, id: "mm-error-period"});
    const chip = html`<div class="mm-chip-wrap"><details class="mm-chip mm-chip--disabled" id="filter-period" data-filter-control="period" data-disabled="true">${summary}</details>${err}</div>`;
    // A disabled chip never opens.
    chip.querySelector("details").addEventListener("toggle", (e) => {
      e.target.open = false;
    });
    summary.addEventListener("click", (e) => e.preventDefault());
    return chip;
  }
  const years = periodYears(bounds);
  const opt = (y) => html`<option value="${y}">${y}</option>`;
  const from = html`<select id="filter-period-from" data-period-select="from">${years.map(opt)}</select>`;
  const to = html`<select id="filter-period-to" data-period-select="to">${years.map(opt)}</select>`;
  const msg = html`<p class="mm-chip-msg" id="filter-period-msg" role="status"></p>`;
  const preset = (key) => html`<button type="button" class="mm-chip-preset" data-period-preset="${key}">${DRAFT_PERIOD_PRESETS[key]}</button>`;
  const chip = html`<details class="mm-chip" id="filter-period" data-filter-control="period">${summary}<div class="mm-chip-body"><label class="mm-chip-field">${L.from} ${from}</label><label class="mm-chip-field">${L.to} ${to}</label>${msg}<div class="mm-chip-presets">${["all", "last10", "last5"].map(preset)}</div></div></details>`;

  const sync = (state) => {
    const pair = state.from != null && state.to != null;
    from.value = String(pair ? state.from : bounds.from);
    to.value = String(pair ? state.to : bounds.to);
    summary.textContent = DRAFT_FILTER_CHIP_SUMMARY(L.period, periodSummaryValue(state));
    msg.textContent = "";
  };
  sync(store.get());
  store.subscribe(sync);

  const choose = (f, t, src) => {
    const r = validatePair(f, t, bounds);
    if (!r.ok) {
      msg.textContent = DRAFT_PERIOD_INVALID;
      src.value = String(src === from ? (store.get().from ?? bounds.from) : (store.get().to ?? bounds.to)); // show the stored value again
      return;
    }
    msg.textContent = "";
    store.set({from: r.from, to: r.to});
  };
  chip.addEventListener("change", (e) => {
    if (e.target === from || e.target === to) choose(from.value, to.value, e.target);
  });
  chip.addEventListener("click", (e) => {
    const key = e.target?.dataset?.periodPreset;
    if (!key) return;
    msg.textContent = "";
    const r = presetRange(key, bounds);
    store.set(r); // "all" gives null/null; a preset gives the pair, held at the first available year
  });
  wireChip(chip);
  return chip;
}
