import { summarizeLedgerSlice, type DetailedLedgerEntry } from '../../../utils/reports/ledger';
import { type ReportSlice } from '../../../utils/reports/breakdownRows';
import { formatCurrency } from '../shared/formatters';

const dash = <span className="text-slate-300">—</span>;
const money = (v: number) => (v > 0 ? formatCurrency(v) : dash);

export function LedgerSliceTable({ title, firstColumn, slices, detailedLedger }: { title: string; firstColumn: string; slices: ReportSlice[]; detailedLedger: DetailedLedgerEntry[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 bg-slate-50 px-5 py-3 text-left text-xs font-bold text-slate-600 uppercase min-w-[160px] z-10">{firstColumn}</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Entries</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase whitespace-nowrap">Total Amount</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-blue-700 uppercase whitespace-nowrap">Initial Recog.</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-emerald-700 uppercase whitespace-nowrap">Lease Payments</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-sky-700 uppercase whitespace-nowrap">Interest Accrual</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase whitespace-nowrap">Depreciation</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-amber-700 uppercase whitespace-nowrap">Other</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slices.map((slice) => {
              const s = summarizeLedgerSlice(detailedLedger, slice.start, slice.end);
              return (
                <tr key={slice.key} className="hover:bg-slate-50">
                  <td className="sticky left-0 bg-inherit px-5 py-3 font-semibold text-slate-800 z-10 whitespace-nowrap">{slice.header}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{s.count > 0 ? s.count : dash}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{money(s.total)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{money(s.byType('Initial Recognition'))}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{money(s.byType('Lease Payment'))}</td>
                  <td className="px-4 py-3 text-right text-sky-700">{money(s.byType('Interest Accrual'))}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{money(s.byType('Depreciation'))}</td>
                  <td className="px-4 py-3 text-right text-amber-700">{money(s.other)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-300 font-bold">
              <td className="sticky left-0 bg-slate-50 px-5 py-3 z-10">Total</td>
              <td className="px-4 py-3 text-right">{detailedLedger.length}</td>
              <td className="px-4 py-3 text-right">{formatCurrency(detailedLedger.reduce((s, e) => s + e.amount, 0))}</td>
              <td colSpan={5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
