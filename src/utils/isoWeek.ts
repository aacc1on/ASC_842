/** ISO-8601 week helpers (Monday start, week 1 contains the year's first Thursday). All math uses local dates. */

export interface IsoWeek {
  year: number;
  week: number;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfIsoWeek(date: Date): Date {
  const d = localMidnight(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function isoWeekOf(date: Date): IsoWeek {
  const thursday = startOfIsoWeek(date);
  thursday.setDate(thursday.getDate() + 3);
  const year = thursday.getFullYear();
  const week1Monday = startOfIsoWeek(new Date(year, 0, 4));
  const days = Math.round((thursday.getTime() - week1Monday.getTime()) / 86400000);
  return { year, week: Math.floor(days / 7) + 1 };
}

export function isoWeeksInYear(year: number): 52 | 53 {
  return isoWeekOf(new Date(year, 11, 28)).week === 53 ? 53 : 52;
}

export function isoWeekStart(year: number, week: number): Date {
  const d = startOfIsoWeek(new Date(year, 0, 4));
  d.setDate(d.getDate() + (week - 1) * 7);
  return d;
}

/** Parses 'YYYY-MM-DD' (or an ISO timestamp's date part) as a local calendar date. */
export function parseLocalYMD(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
