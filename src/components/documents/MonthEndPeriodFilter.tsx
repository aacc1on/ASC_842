import { Filter } from 'lucide-react';
import type { PeriodFilterMode, PeriodFilterValue } from './periodFilter';

export type { PeriodFilterMode, PeriodFilterValue } from './periodFilter';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Props {
  value: PeriodFilterValue;
  years: string[];
  shownCount: number;
  totalCount: number;
  onChange: (v: PeriodFilterValue) => void;
}

const selectCls =
  'px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition';

export function MonthEndPeriodFilter({ value, years, shownCount, totalCount, onChange }: Props) {
  const modes: { key: PeriodFilterMode; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'year', label: 'Year' },
    { key: 'month', label: 'Month' },
    { key: 'custom', label: 'Custom' },
  ];
  const customInvalid = value.mode === 'custom' && value.from && value.to && value.from > value.to;

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Filter className="w-4 h-4 text-slate-500" />
        Period
      </div>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange({ ...value, mode: m.key })}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              value.mode === m.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(value.mode === 'year' || value.mode === 'month') && (
        <select aria-label="Year" className={selectCls} value={value.year} onChange={(e) => onChange({ ...value, year: e.target.value })}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {value.mode === 'month' && (
        <select aria-label="Month" className={selectCls} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })}>
          {MONTHS.map((m, i) => {
            const v = String(i + 1).padStart(2, '0');
            return <option key={v} value={v}>{m}</option>;
          })}
        </select>
      )}
      {value.mode === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" aria-label="From month" className={selectCls} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="text-sm text-slate-500">to</span>
          <input type="month" aria-label="To month" className={selectCls} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          {customInvalid && <span className="text-xs font-medium text-red-600">Start month is after end month</span>}
        </div>
      )}

      <span className="ml-auto text-xs text-slate-500">
        Showing {shownCount} of {totalCount}
      </span>
    </div>
  );
}
