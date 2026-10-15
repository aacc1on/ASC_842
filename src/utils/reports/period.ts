import { toYMD } from '../formatting';
import { parseLocalYMD, startOfIsoWeek } from '../isoWeek';
import type { CashFlowData, ProfitLossData } from '../financialReports';

export type PeriodMode = 'year' | 'month' | 'week' | 'date' | 'custom';

export interface PeriodSelection {
  mode: PeriodMode;
  year: number;
  month: string;
  week: string;
  date: string;
  customStart: string;
  customEnd: string;
}

export interface WeekSlice { label: string; start: string; end: string }
export interface WeekReport { week: WeekSlice; pl: ProfitLossData | null; cf: CashFlowData | null }
export interface MonthSlice { label: string; shortLabel: string; start: string; end: string }
export interface MonthReport { month: MonthSlice; pl: ProfitLossData | null; cf: CashFlowData | null }

export function initialPeriodSelection(now: Date): PeriodSelection {
  const prev = new Date(now);
  prev.setMonth(prev.getMonth() - 1);
  const ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
  return {
    mode: 'month',
    year: now.getFullYear(),
    month: ym,
    week: toYMD(startOfIsoWeek(now)),
    date: toYMD(now),
    customStart: `${ym}-01`,
    customEnd: `${ym}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function computePeriodBounds(p: PeriodSelection): { start: string; end: string } {
  if (p.mode === 'year') {
    return { start: `${p.year}-01-01`, end: `${p.year}-12-31` };
  }
  if (p.mode === 'month') {
    const [y, m] = p.month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }
  if (p.mode === 'week') {
    const startD = startOfIsoWeek(parseLocalYMD(p.week));
    const endD = new Date(startD);
    endD.setDate(startD.getDate() + 6);
    return { start: toYMD(startD), end: toYMD(endD) };
  }
  if (p.mode === 'custom') {
    return { start: p.customStart, end: p.customEnd };
  }
  return { start: p.date, end: p.date };
}

export function shiftPeriod(p: PeriodSelection, direction: -1 | 1): PeriodSelection {
  if (p.mode === 'year') return { ...p, year: p.year + direction };
  if (p.mode === 'month') {
    const [y, m] = p.month.split('-').map(Number);
    const d = new Date(y, m - 1 + direction, 1);
    return { ...p, month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
  }
  if (p.mode === 'week') {
    const [wy, wm, wd] = p.week.split('-').map(Number);
    const d = new Date(wy, wm - 1, wd + direction * 7);
    return { ...p, week: toYMD(d) };
  }
  const [dy, dm, dd] = p.date.split('-').map(Number);
  const d = new Date(dy, dm - 1, dd + direction);
  return { ...p, date: toYMD(d) };
}

const shortRange = (startYmd: string, endYmd: string) => {
  const start = new Date(startYmd + 'T00:00:00');
  const end = new Date(endYmd + 'T00:00:00');
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

export function periodLabel(p: PeriodSelection): string {
  if (p.mode === 'year') return `${p.year}`;
  if (p.mode === 'month') {
    const [y, m] = p.month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (p.mode === 'week') {
    const { start, end } = computePeriodBounds(p);
    return shortRange(start, end);
  }
  if (p.mode === 'custom') return shortRange(p.customStart, p.customEnd);
  return new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function computeWeeks(start: string, end: string): WeekSlice[] {
  const weeks: WeekSlice[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const dayOfWeek = s.getDay();
  let cur = new Date(s);
  cur.setDate(s.getDate() - ((dayOfWeek + 6) % 7));
  while (cur <= e) {
    const wEnd = new Date(cur);
    wEnd.setDate(cur.getDate() + 6);
    const sliceStart = cur < s ? s : cur;
    const sliceEnd = wEnd > e ? e : wEnd;
    weeks.push({
      label: `${sliceStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${sliceEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      start: toYMD(sliceStart),
      end: toYMD(sliceEnd),
    });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

export function computeMonths(start: string, end: string): MonthSlice[] {
  const months: MonthSlice[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  let y = s.getFullYear();
  let m = s.getMonth();
  while (new Date(y, m, 1) <= e) {
    const mStart = new Date(y, m, 1);
    const mEnd = new Date(y, m + 1, 0);
    const sliceStart = mStart < s ? s : mStart;
    const sliceEnd = mEnd > e ? e : mEnd;
    months.push({
      label: sliceStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      shortLabel: sliceStart.toLocaleDateString('en-US', { month: 'short' }),
      start: toYMD(sliceStart),
      end: toYMD(sliceEnd),
    });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return months;
}

/** Year -> months, Month -> weeks, Custom -> months when it spans 2+ months, else weeks. */
export function breakdownGranularity(mode: PeriodMode, start: string, end: string): 'month' | 'week' | 'none' {
  if (mode === 'year') return 'month';
  if (mode === 'month') return 'week';
  if (mode === 'custom') return computeMonths(start, end).length >= 2 ? 'month' : 'week';
  return 'none';
}

export function toLocalPeriodRange(periodStart: string, periodEnd: string): { pStart: Date; pEnd: Date } {
  const [psY, psM, psD] = periodStart.split('-').map(Number);
  const [peY, peM, peD] = periodEnd.split('-').map(Number);
  return {
    pStart: new Date(psY, psM - 1, psD, 0, 0, 0, 0),
    pEnd: new Date(peY, peM - 1, peD, 23, 59, 59, 999),
  };
}
