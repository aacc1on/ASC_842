import { useCallback, useMemo, useState } from 'react';
import { toYMD } from '../utils/formatting';
import { isoWeekOf, isoWeekStart, isoWeeksInYear } from '../utils/isoWeek';

export type PeriodMode = 'year' | 'month' | 'week' | 'date' | 'custom';

export interface UsePeriodSelectorResult {
  periodStart: Date;
  periodEnd: Date;
  periodMode: PeriodMode;
  selectedYear: number;
  selectedMonth: number; // 0-indexed (JS month)
  selectedWeek: number; // ISO-8601 week (1-53) of selectedYear
  selectedDate: string; // ISO yyyy-mm-dd
  customRangeStart: string;
  customRangeEnd: string;
  setPeriodMode: (mode: PeriodMode) => void;
  setSelectedYear: (year: number) => void;
  setSelectedMonth: (month: number) => void;
  setSelectedDate: (date: string) => void;
  setCustomRangeStart: (date: string) => void;
  setCustomRangeEnd: (date: string) => void;
  shiftPeriod: (direction: number) => void;
  periodLabel: string;
}

/**
 * Centralizes period-selection state for the financial reports tab.
 * Computes concrete [periodStart, periodEnd] bounds from the active mode
 * and exposes a `shiftPeriod` helper to move the selection forward/backward.
 */
export function usePeriodSelector(): UsePeriodSelectorResult {
  const now = new Date();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('year');
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedWeek, setSelectedWeek] = useState(() => isoWeekOf(now).week);
  const [selectedDate, setSelectedDate] = useState(() => toYMD(now));
  const [customRangeStart, setCustomRangeStart] = useState(() => toYMD(new Date(now.getFullYear(), 0, 1)));
  const [customRangeEnd, setCustomRangeEnd] = useState(() => toYMD(now));

  const changePeriodMode = useCallback((mode: PeriodMode) => {
    if (mode === 'week') {
      const today = isoWeekOf(new Date());
      setSelectedYear(today.year);
      setSelectedWeek(today.week);
    }
    setPeriodMode(mode);
  }, []);

  const computed = useMemo(() => {
    let start: Date;
    let end: Date;
    let label: string;

    switch (periodMode) {
      case 'year':
        start = new Date(selectedYear, 0, 1);
        end = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
        label = String(selectedYear);
        break;
      case 'month': {
        start = new Date(selectedYear, selectedMonth, 1);
        end = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
        label = start.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        break;
      }
      case 'week': {
        start = isoWeekStart(selectedYear, selectedWeek);
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
        label = `Week ${selectedWeek} · ${selectedYear}`;
        break;
      }
      case 'date': {
        const [y, m, d] = selectedDate.split('-').map(Number);
        start = new Date(y, m - 1, d);
        end = new Date(y, m - 1, d, 23, 59, 59, 999);
        label = start.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        break;
      }
      case 'custom': {
        const [sy, sm, sd] = customRangeStart.split('-').map(Number);
        const [ey, em, ed] = customRangeEnd.split('-').map(Number);
        start = new Date(sy, sm - 1, sd);
        end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
        label = `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
        break;
      }
      default: {
        start = new Date(selectedYear, 0, 1);
        end = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
        label = String(selectedYear);
      }
    }
    return { start, end, label };
  }, [
    periodMode,
    selectedYear,
    selectedMonth,
    selectedWeek,
    selectedDate,
    customRangeStart,
    customRangeEnd,
  ]);

  const shiftPeriod = useCallback(
    (direction: number) => {
      const dir = direction < 0 ? -1 : 1;
      switch (periodMode) {
        case 'year':
          setSelectedYear((y) => y + dir);
          break;
        case 'month': {
          let m = selectedMonth + dir;
          let y = selectedYear;
          if (m < 0) {
            m = 11;
            y -= 1;
          } else if (m > 11) {
            m = 0;
            y += 1;
          }
          setSelectedMonth(m);
          setSelectedYear(y);
          break;
        }
        case 'week': {
          let w = selectedWeek + dir;
          let y = selectedYear;
          if (w < 1) {
            y -= 1;
            w = isoWeeksInYear(y);
          } else if (w > isoWeeksInYear(y)) {
            w = 1;
            y += 1;
          }
          setSelectedWeek(w);
          setSelectedYear(y);
          break;
        }
        case 'date': {
          const [y, m, d] = selectedDate.split('-').map(Number);
          const next = new Date(y, m - 1, d);
          next.setDate(next.getDate() + dir);
          setSelectedDate(toYMD(next));
          break;
        }
        case 'custom':
          // Custom ranges are manipulated directly via the setters.
          break;
      }
    },
    [periodMode, selectedYear, selectedMonth, selectedWeek, selectedDate],
  );

  return {
    periodStart: computed.start,
    periodEnd: computed.end,
    periodMode,
    selectedYear,
    selectedMonth,
    selectedWeek,
    selectedDate,
    customRangeStart,
    customRangeEnd,
    setPeriodMode: changePeriodMode,
    setSelectedYear,
    setSelectedMonth,
    setSelectedDate,
    setCustomRangeStart,
    setCustomRangeEnd,
    shiftPeriod,
    periodLabel: computed.label,
  };
}
