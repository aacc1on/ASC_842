export interface WeekSlice {
  label: string;
  start: string;
  end: string;
}

export interface MonthSlice {
  label: string;
  shortLabel: string;
  start: string;
  end: string;
}

export type PeriodMode = 'year' | 'month' | 'week' | 'date' | 'custom';

export function computePeriodBounds(
  mode: PeriodMode,
  year: number,
  month: string,
  week: string,
  date: string,
  customRangeStart: string,
  customRangeEnd: string
): { start: string; end: string } {
  if (mode === 'year') {
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (mode === 'month') {
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }
  if (mode === 'week') {
    const [wy, wm, wd] = week.split('-').map(Number);
    const startD = new Date(wy, wm - 1, wd);
    const endD = new Date(startD);
    endD.setDate(startD.getDate() + 6);
    return {
      start: `${startD.getFullYear()}-${String(startD.getMonth()+1).padStart(2,'0')}-${String(startD.getDate()).padStart(2,'0')}`,
      end: `${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,'0')}-${String(endD.getDate()).padStart(2,'0')}`,
    };
  }
  if (mode === 'custom') {
    return { start: customRangeStart, end: customRangeEnd };
  }
  return { start: date, end: date };
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
      start: `${sliceStart.getFullYear()}-${String(sliceStart.getMonth()+1).padStart(2,'0')}-${String(sliceStart.getDate()).padStart(2,'0')}`,
      end: `${sliceEnd.getFullYear()}-${String(sliceEnd.getMonth()+1).padStart(2,'0')}-${String(sliceEnd.getDate()).padStart(2,'0')}`,
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
      start: `${sliceStart.getFullYear()}-${String(sliceStart.getMonth()+1).padStart(2,'0')}-${String(sliceStart.getDate()).padStart(2,'0')}`,
      end: `${sliceEnd.getFullYear()}-${String(sliceEnd.getMonth()+1).padStart(2,'0')}-${String(sliceEnd.getDate()).padStart(2,'0')}`,
    });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return months;
}
