import { formatCurrencyVal } from '../shared/formatters';
import { type Lease } from '../../../types/lease';
import { type LeaseBalancesByType } from '../../../utils/financialReports';
import { footBalancesByType } from '../../../utils/reports/balanceSheetFooting';
import { sumPayments, type WeightedMetrics } from '../../../utils/reports/complianceCalculations';
import { LeaseBalancesByTypeTable } from '../BalanceSheet/LeaseBalancesByTypeTable';

interface QuantitativeDisclosuresProps {
  finance: Lease[];
  operating: Lease[];
  metrics: WeightedMetrics;
  leaseBalancesByType: LeaseBalancesByType | null;
  periodEnd: string;
}

export function QuantitativeDisclosures({ finance, operating, metrics, leaseBalancesByType, periodEnd }: QuantitativeDisclosuresProps) {
  const { watFinance, watOperating, wadrFinance, wadrOperating } = metrics;
  const footed = leaseBalancesByType ? footBalancesByType(leaseBalancesByType) : null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[
          { label: 'Weighted-Avg Remaining Term — Finance', value: `${watFinance.toFixed(2)} years`, foot: `${finance.length} finance lease${finance.length === 1 ? '' : 's'}`, accent: 'from-blue-500 to-blue-700' },
          { label: 'Weighted-Avg Remaining Term — Operating', value: `${watOperating.toFixed(2)} years`, foot: `${operating.length} operating lease${operating.length === 1 ? '' : 's'}`, accent: 'from-emerald-500 to-emerald-700' },
          { label: 'Weighted-Avg Discount Rate — Finance', value: `${wadrFinance.toFixed(2)}%`, foot: 'IBR weighted by liability', accent: 'from-orange-500 to-orange-700' },
          { label: 'Weighted-Avg Discount Rate — Operating', value: `${wadrOperating.toFixed(2)}%`, foot: 'IBR weighted by liability', accent: 'from-cyan-500 to-cyan-700' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className={`h-1 bg-gradient-to-r ${c.accent}`} />
            <div className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase">{c.label}</div>
              <div className="text-3xl font-bold text-slate-900 mt-2">{c.value}</div>
              <div className="text-xs text-slate-500 mt-2">{c.foot}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h4 className="font-bold text-slate-900">Lease Cost & Balance Summary by Classification</h4>
          <p className="text-xs text-slate-500 mt-0.5">Required under ASC 842-20-50-4(a). Cost components are reflected in Financial Reports.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase">Classification</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Leases</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Total ROU Asset</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Total Lease Liability</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Monthly Payments</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Wtd Avg Term</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase">Wtd Avg Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { label: 'Finance', list: finance, term: watFinance, rate: wadrFinance, color: 'bg-blue-100 text-blue-800' },
                { label: 'Operating', list: operating, term: watOperating, rate: wadrOperating, color: 'bg-emerald-100 text-emerald-800' },
              ].map(({ label, list, term, rate, color }) => {
                const cls = label === 'Finance' ? 'finance' : 'operating';
                const rou = footed?.rou[cls] ?? 0;
                const liab = footed?.liability[cls] ?? 0;
                const pay = sumPayments(list);
                return (
                  <tr key={label} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-bold rounded-full ${color}`}>{label}</span></td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{list.length}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrencyVal(rou)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrencyVal(liab)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrencyVal(pay)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{term.toFixed(2)} yrs</td>
                    <td className="px-4 py-3 text-right text-slate-700">{rate.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {leaseBalancesByType && (
        <LeaseBalancesByTypeTable
          balancesByType={leaseBalancesByType}
          subtitle={`Operating vs finance lease balances, reconciled to the Balance Sheet as of ${new Date(periodEnd).toLocaleDateString()}.`}
        />
      )}
    </div>
  );
}
