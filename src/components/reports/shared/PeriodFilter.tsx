import { DateRangeFilter } from '../../DateRangeFilter';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { periodLabel, shiftPeriod, type PeriodSelection } from '../../../utils/reports/period';

export function PeriodFilter({ period, onChange }: { period: PeriodSelection; onChange: (p: PeriodSelection) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="block text-xs font-bold text-slate-700 uppercase">Period Filter</label>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden shadow-sm">
          {(['year', 'month', 'week', 'date', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange({ ...period, mode })}
              className={`px-4 py-2 text-sm font-semibold capitalize transition-colors ${period.mode === mode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {mode === 'date' ? 'Day' : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {period.mode !== 'custom' && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChange(shiftPeriod(period, -1))}
            className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
            title="Previous period"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {period.mode === 'year' && (
            <div className="flex items-center gap-1 px-4 py-2 border border-slate-300 rounded-lg text-sm bg-white shadow-sm text-slate-700 font-bold min-w-[80px] justify-center tracking-wide">
              {period.year}
            </div>
          )}
          {period.mode === 'month' && (
            <input
              type="month"
              value={period.month}
              onChange={(e) => onChange({ ...period, month: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm bg-white"
            />
          )}
          {period.mode === 'week' && (
            <div className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white shadow-sm text-slate-700 font-medium min-w-[190px] justify-center">
              {periodLabel(period)}
            </div>
          )}
          {period.mode === 'date' && (
            <input
              type="date"
              value={period.date}
              onChange={(e) => onChange({ ...period, date: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm bg-white"
            />
          )}

          <button
            onClick={() => onChange(shiftPeriod(period, 1))}
            className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
            title="Next period"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        )}

        {period.mode === 'custom' && (
          <DateRangeFilter
            from={period.customStart}
            to={period.customEnd}
            onApply={(from, to) => {
              onChange({ ...period, customStart: from, customEnd: to });
            }}
          />
        )}
      </div>
    </div>
  );
}
