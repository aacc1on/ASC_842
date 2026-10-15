import { BookOpen } from 'lucide-react';
import { formatCurrencyVal } from '../shared/formatters';
import { type Lease } from '../../../types/lease';
import { type MaturityResult } from '../../../utils/financialReports';
import { footMaturity } from '../../../utils/reports/statementFooting';

interface MaturityAnalysisProps {
  maturityFinance: MaturityResult;
  maturityOperating: MaturityResult;
  bucketLabels: string[];
  finance: Lease[];
  operating: Lease[];
}

export function MaturityAnalysis({ maturityFinance, maturityOperating, bucketLabels, finance, operating }: MaturityAnalysisProps) {
  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex gap-3">
        <BookOpen className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <span className="font-bold">ASC 842-20-50-6 Maturity Analysis.</span> Undiscounted future lease payments by year, reconciled to the recorded lease liability. The difference represents imputed interest (discount).
        </div>
      </div>

      {[
        { label: 'Finance Leases', data: maturityFinance, accent: 'from-blue-600 to-blue-800', list: finance },
        { label: 'Operating Leases', data: maturityOperating, accent: 'from-emerald-600 to-emerald-800', list: operating },
      ].map(({ label, data, accent, list }) => {
        const m = footMaturity(data);
        return (
        <div key={label} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className={`px-5 py-3 bg-gradient-to-r ${accent} text-white flex items-center justify-between`}>
            <h4 className="font-bold">{label}</h4>
            <span className="text-xs font-semibold opacity-90">{list.length} lease{list.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: bucketLabels[0], val: m.years[0] },
                  { label: bucketLabels[1], val: m.years[1] },
                  { label: bucketLabels[2], val: m.years[2] },
                  { label: bucketLabels[3], val: m.years[3] },
                  { label: bucketLabels[4], val: m.years[4] },
                  { label: 'Thereafter', val: m.thereafter },
                ].map((row) => (
                  <tr key={row.label} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5 text-slate-700">{row.label}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-slate-900">{formatCurrencyVal(row.val)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td className="px-5 py-3 font-bold text-slate-900">Total Undiscounted Lease Payments</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{formatCurrencyVal(m.totalUndiscounted)}</td>
                </tr>
                <tr>
                  <td className="px-5 py-2.5 text-slate-700">Less: Imputed Interest</td>
                  <td className="px-5 py-2.5 text-right text-red-600 font-semibold">({formatCurrencyVal(m.imputedInterest)})</td>
                </tr>
                <tr className="bg-slate-900 text-white">
                  <td className="px-5 py-3 font-bold">Present Value of Lease Liability</td>
                  <td className="px-5 py-3 text-right font-bold">{formatCurrencyVal(m.liability)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        );
      })}
    </div>
  );
}
