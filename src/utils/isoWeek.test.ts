import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isoWeekOf, isoWeekStart, isoWeeksInYear, parseLocalYMD, startOfIsoWeek } from './isoWeek';
import { toYMD } from './formatting';
import { computePeriodBounds, initialPeriodSelection, shiftPeriod } from './reports/period';
import { usePeriodSelector } from '../hooks/usePeriodSelector';

const ORIGINAL_TZ = process.env.TZ;
const ZONES = ['Asia/Yerevan', 'UTC', 'America/Los_Angeles'] as const;
const OCT_OFFSET: Record<(typeof ZONES)[number], number> = { 'Asia/Yerevan': -240, UTC: 0, 'America/Los_Angeles': 420 };

afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe('isoWeek helpers', () => {
  it.each([
    ['2026-10-13', 2026, 42],
    ['2026-01-01', 2026, 1],
    ['2025-12-29', 2026, 1],
    ['2026-12-31', 2026, 53],
    ['2027-01-03', 2026, 53],
    ['2027-01-04', 2027, 1],
    ['2021-01-03', 2020, 53],
    ['2024-12-30', 2025, 1],
  ])('%s is ISO %i-W%i', (ymd, year, week) => {
    expect(isoWeekOf(parseLocalYMD(ymd))).toEqual({ year, week });
  });

  it('knows which years have 53 weeks', () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2020)).toBe(53);
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(isoWeeksInYear(2027)).toBe(52);
  });

  it('isoWeekStart returns the Monday of the week, including week 53', () => {
    expect(toYMD(isoWeekStart(2026, 1))).toBe('2025-12-29');
    expect(toYMD(isoWeekStart(2026, 42))).toBe('2026-10-12');
    expect(toYMD(isoWeekStart(2026, 53))).toBe('2026-12-28');
    expect(toYMD(startOfIsoWeek(parseLocalYMD('2026-10-18')))).toBe('2026-10-12');
  });

  it('parseLocalYMD accepts a timestamp and keeps the calendar date', () => {
    expect(toYMD(parseLocalYMD('2026-03-01T23:00:00Z'))).toBe('2026-03-01');
  });
});

describe.each(ZONES)('week calculations with TZ=%s', (zone) => {
  it('helpers give the same calendar answers in every zone', () => {
    process.env.TZ = zone;
    expect(new Date(2026, 9, 13).getTimezoneOffset()).toBe(OCT_OFFSET[zone]);
    expect(isoWeekOf(parseLocalYMD('2026-10-13'))).toEqual({ year: 2026, week: 42 });
    expect(toYMD(isoWeekStart(2026, 53))).toBe('2026-12-28');
    expect(toYMD(parseLocalYMD('2026-01-01'))).toBe('2026-01-01');
    process.env.TZ = ORIGINAL_TZ;
  });

  it('week picker uses the local date late in the evening (no UTC shift)', () => {
    process.env.TZ = zone;
    vi.useFakeTimers({ toFake: ['Date'] });
    // Local 23:30 on Sunday 2026-10-18 in each zone.
    vi.setSystemTime(new Date(2026, 9, 18, 23, 30));
    const { result } = renderHook(() => usePeriodSelector());
    expect(result.current.selectedDate).toBe('2026-10-18');
    act(() => result.current.setPeriodMode('week'));
    expect(result.current.selectedWeek).toBe(42);
    expect(toYMD(result.current.periodStart)).toBe('2026-10-12');
    expect(toYMD(result.current.periodEnd)).toBe('2026-10-18');
    expect(result.current.periodStart.getHours()).toBe(0);
    process.env.TZ = ORIGINAL_TZ;
  });

  it('reports period selection keeps local Monday and dates', () => {
    process.env.TZ = zone;
    const sel = initialPeriodSelection(new Date(2026, 9, 13, 0, 30));
    expect(sel.week).toBe('2026-10-12');
    expect(sel.date).toBe('2026-10-13');
    expect(computePeriodBounds({ ...sel, mode: 'week' })).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(shiftPeriod({ ...sel, mode: 'week' }, 1).week).toBe('2026-10-19');
    expect(shiftPeriod({ ...sel, mode: 'date' }, -1).date).toBe('2026-10-12');
    const late = initialPeriodSelection(new Date(2026, 9, 18, 23, 59));
    expect(late.week).toBe('2026-10-12');
    expect(late.date).toBe('2026-10-18');
    process.env.TZ = ORIGINAL_TZ;
  });
});
