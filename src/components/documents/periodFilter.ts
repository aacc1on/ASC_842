export type PeriodFilterMode = 'all' | 'year' | 'month' | 'custom';

export interface PeriodFilterValue {
  mode: PeriodFilterMode;
  year: string;
  month: string;
  from: string;
  to: string;
}


/** period is 'YYYY-MM'; from/to are 'YYYY-MM' month inputs. */
export function matchesPeriodFilter(period: string, f: PeriodFilterValue): boolean {
  const p = period.slice(0, 7);
  if (f.mode === 'year') return p.slice(0, 4) === f.year;
  if (f.mode === 'month') return p === `${f.year}-${f.month}`;
  if (f.mode === 'custom') {
    if (f.from && p < f.from) return false;
    if (f.to && p > f.to) return false;
    return true;
  }
  return true;
}
