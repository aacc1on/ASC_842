import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePeriodSelector, type PeriodMode } from './usePeriodSelector';

const iso = (d: Date) => d.toISOString();

describe('usePeriodSelector (today = 2026-10-13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises every selection from today and defaults to the full current year', () => {
    const { result } = renderHook(() => usePeriodSelector());
    const r = result.current;
    expect(r.periodMode).toBe('year');
    expect(r.selectedYear).toBe(2026);
    expect(r.selectedMonth).toBe(9);
    expect(r.selectedWeek).toBe(42);
    expect(r.selectedDate).toBe('2026-10-13');
    expect(r.customRangeStart).toBe('2026-01-01');
    expect(r.customRangeEnd).toBe('2026-10-13');
    expect(iso(r.periodStart)).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(r.periodEnd)).toBe('2026-12-31T23:59:59.999Z');
    expect(r.periodLabel).toBe('2026');
  });

  it('year mode shifts by one year regardless of the magnitude of direction', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.shiftPeriod(-3));
    expect(result.current.selectedYear).toBe(2025);
    expect(result.current.periodLabel).toBe('2025');
    act(() => result.current.shiftPeriod(5));
    act(() => result.current.shiftPeriod(0));
    expect(result.current.selectedYear).toBe(2027);
    expect(iso(result.current.periodStart)).toBe('2027-01-01T00:00:00.000Z');
  });

  it('month mode computes month bounds and rolls over year boundaries in both directions', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('month'));
    expect(result.current.periodLabel).toBe('October 2026');
    expect(iso(result.current.periodStart)).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(result.current.periodEnd)).toBe('2026-10-31T23:59:59.999Z');

    act(() => result.current.shiftPeriod(1));
    act(() => result.current.shiftPeriod(1));
    act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedMonth).toBe(0);
    expect(result.current.selectedYear).toBe(2027);
    expect(result.current.periodLabel).toBe('January 2027');

    act(() => result.current.shiftPeriod(-1));
    expect(result.current.selectedMonth).toBe(11);
    expect(result.current.selectedYear).toBe(2026);

    act(() => result.current.setSelectedMonth(1));
    act(() => result.current.setSelectedYear(2028));
    expect(iso(result.current.periodEnd)).toBe('2028-02-29T23:59:59.999Z');
  });

  it('week mode uses ISO-8601 weeks (Monday start): 2026-10-13 is week 42, Oct 12-18', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('week'));
    expect(result.current.selectedWeek).toBe(42);
    expect(result.current.periodLabel).toBe('Week 42 · 2026');
    expect(result.current.periodStart.getDay()).toBe(1);
    expect(iso(result.current.periodStart)).toBe('2026-10-12T00:00:00.000Z');
    expect(iso(result.current.periodEnd)).toBe('2026-10-18T23:59:59.999Z');
  });

  it('week mode reaches ISO week 53 in 2026 and wraps 53 -> 2027 week 1 -> back to 53', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('week'));
    for (let i = 0; i < 11; i++) act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedWeek).toBe(53);
    expect(iso(result.current.periodStart)).toBe('2026-12-28T00:00:00.000Z');
    expect(iso(result.current.periodEnd)).toBe('2027-01-03T23:59:59.999Z');
    act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedWeek).toBe(1);
    expect(result.current.selectedYear).toBe(2027);
    expect(iso(result.current.periodStart)).toBe('2027-01-04T00:00:00.000Z');
    act(() => result.current.shiftPeriod(-1));
    expect(result.current.selectedWeek).toBe(53);
    expect(result.current.selectedYear).toBe(2026);
  });

  it('week mode wraps backwards into a 52-week year (2026 week 1 -> 2025 week 52)', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('week'));
    for (let i = 0; i < 41; i++) act(() => result.current.shiftPeriod(-1));
    expect(result.current.selectedWeek).toBe(1);
    expect(iso(result.current.periodStart)).toBe('2025-12-29T00:00:00.000Z');
    act(() => result.current.shiftPeriod(-1));
    expect(result.current.selectedYear).toBe(2025);
    expect(result.current.selectedWeek).toBe(52);
  });

  it('date mode covers a single day and steps across month/year ends', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('date'));
    expect(result.current.periodLabel).toBe('Oct 13, 2026');
    expect(iso(result.current.periodStart)).toBe('2026-10-13T00:00:00.000Z');
    expect(iso(result.current.periodEnd)).toBe('2026-10-13T23:59:59.999Z');

    act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedDate).toBe('2026-10-14');
    act(() => result.current.setSelectedDate('2026-12-31'));
    act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedDate).toBe('2027-01-01');
    act(() => result.current.shiftPeriod(-1));
    act(() => result.current.shiftPeriod(-1));
    expect(result.current.selectedDate).toBe('2026-12-30');
  });

  it('custom mode uses the custom range and ignores shiftPeriod', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => {
      result.current.setPeriodMode('custom');
      result.current.setCustomRangeStart('2026-03-01');
      result.current.setCustomRangeEnd('2026-03-31');
    });
    const start = new Date(2026, 2, 1);
    const end = new Date(2026, 2, 31, 23, 59, 59, 999);
    expect(result.current.periodStart.getTime()).toBe(start.getTime());
    expect(result.current.periodEnd.getTime()).toBe(end.getTime());
    expect(result.current.periodLabel).toBe(`${start.toLocaleDateString()} – ${end.toLocaleDateString()}`);

    act(() => result.current.shiftPeriod(1));
    expect(result.current.customRangeStart).toBe('2026-03-01');
    expect(result.current.customRangeEnd).toBe('2026-03-31');
    expect(result.current.selectedYear).toBe(2026);
  });

  it('falls back to the full selected year for an unknown mode', () => {
    const { result } = renderHook(() => usePeriodSelector());
    act(() => result.current.setPeriodMode('quarter' as unknown as PeriodMode));
    expect(result.current.periodLabel).toBe('2026');
    expect(iso(result.current.periodEnd)).toBe('2026-12-31T23:59:59.999Z');
    act(() => result.current.shiftPeriod(1));
    expect(result.current.selectedYear).toBe(2026);
  });
});
