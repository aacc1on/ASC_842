const EPS = 1e-6;

/** Half-away-from-zero rounding so negatives mirror positives. */
function roundHalfAway(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) + EPS);
}

export function toCents(amount: number): number {
  return roundHalfAway(amount * 100) || 0;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumCents(amounts: number[]): number {
  return fromCents(amounts.reduce((s, a) => s + toCents(a), 0));
}

export function roundWhole(amount: number): number {
  return roundHalfAway(toCents(amount) / 100) || 0;
}

export interface Footed {
  parts: number[];
  total: number;
}

/** Rounds each part to whole dollars; the total is the sum of the rounded parts. */
export function footParts(parts: number[]): Footed {
  const rounded = parts.map(roundWhole);
  return { parts: rounded, total: rounded.reduce((s, p) => s + p, 0) };
}

/** Rounds the total; every part but the last is rounded and the last absorbs the difference. */
export function footToTotal(parts: number[], total: number): Footed {
  const roundedTotal = roundWhole(total);
  if (parts.length === 0) return { parts: [], total: roundedTotal };
  const head = parts.slice(0, -1).map(roundWhole);
  const last = roundedTotal - head.reduce((s, p) => s + p, 0);
  return { parts: [...head, last], total: roundedTotal };
}

export interface FootedTable {
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
}

/** Rounds every cell; row, column and grand totals are sums of the rounded cells. */
export function footTable(rows: number[][]): FootedTable {
  const cells = rows.map((r) => r.map(roundWhole));
  const width = Math.max(0, ...cells.map((r) => r.length));
  const rowTotals = cells.map((r) => r.reduce((s, c) => s + c, 0));
  const colTotals = Array.from({ length: width }, (_, j) => cells.reduce((s, r) => s + (r[j] ?? 0), 0));
  return { cells, rowTotals, colTotals, grandTotal: rowTotals.reduce((s, t) => s + t, 0) };
}
