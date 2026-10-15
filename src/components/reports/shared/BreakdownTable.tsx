import { breakdownTable, type BreakdownRow, type ReportSlice } from '../../../utils/reports/breakdownRows';
import { formatCurrency } from './formatters';

interface BreakdownTableProps {
  title: string;
  loading: boolean;
  slices: ReportSlice[];
  rows: BreakdownRow<ReportSlice>[];
  variant: 'pl' | 'cf';
  columnMinWidth: string;
}

export function BreakdownTable({ title, loading, slices, rows, variant, columnMinWidth }: BreakdownTableProps) {
  const footed = breakdownTable(rows, slices, 'whole');
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {loading && <span className="text-xs text-slate-500 animate-pulse">Loading...</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 bg-slate-50 px-5 py-3 text-left text-xs font-bold text-slate-600 uppercase min-w-[230px] z-10">Line Item</th>
              {slices.map((s) => (
                <th key={s.key} className={`px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase whitespace-nowrap ${columnMinWidth}`}>{s.header}</th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-bold text-blue-700 uppercase whitespace-nowrap min-w-[110px] bg-blue-50 border-l border-blue-100">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={row.label} className={row.bold ? 'bg-slate-50' : 'hover:bg-slate-50'}>
                <td className={`sticky left-0 bg-inherit px-5 py-2.5 z-10 ${row.indent ? 'pl-9 text-slate-600' : 'font-bold text-slate-900'}`}>{row.label}</td>
                {slices.map((s, j) => {
                  const v = footed[i].values[j];
                  const cellClass = variant === 'pl'
                    ? `px-4 py-2.5 text-right whitespace-nowrap ${row.bold ? 'font-bold text-slate-900' : 'text-slate-700'}`
                    : `px-4 py-2.5 text-right whitespace-nowrap ${row.bold ? 'font-bold' : ''} ${row.color || 'text-slate-700'}`;
                  return (
                    <td key={s.key} className={cellClass}>
                      {v > 0 ? formatCurrency(v) : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className={variant === 'pl'
                  ? 'px-4 py-2.5 text-right whitespace-nowrap font-bold text-slate-900 bg-blue-50 border-l border-blue-100'
                  : `px-4 py-2.5 text-right whitespace-nowrap font-bold bg-blue-50 border-l border-blue-100 ${row.color || 'text-slate-900'}`}>
                  {formatCurrency(footed[i].total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
