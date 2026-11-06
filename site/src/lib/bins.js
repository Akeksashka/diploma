// Display mapping of a STORED percentile to one of five bins (ADR-025 decision 2, ADR-026 decision 6). Comparisons against
// the constant edges only: no arithmetic, no clamping. The bin is a colour class, never a statistic.
// Edges are lower-inclusive: 0 <= p < 0.2 is bin 1, ..., 0.8 <= p <= 1.0 is bin 5.
import {BIN_LABELS} from "./copy.js";

export const BIN_EDGES = Object.freeze([0.2, 0.4, 0.6, 0.8]);
const BINS = Object.freeze([1, 2, 3, 4, 5]);

export class BinError extends Error {
  constructor(message) {
    super(message);
    this.name = "BinError";
  }
}

// null or undefined: no bin (null). A number in [0, 1]: 1..5. Anything else is an export-contract violation and throws; the
// heatmap turns that into an error cell, never into a silently clamped bin.
export function binOf(p) {
  if (p === null || p === undefined) return null;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw new BinError(`percentile outside [0, 1]: ${String(p)}`);
  const i = BIN_EDGES.findIndex((edge) => p < edge);
  return i === -1 ? BINS.at(-1) : BINS[i];
}

export const binLabel = (bin) => BIN_LABELS[BINS.indexOf(bin)] ?? null;
