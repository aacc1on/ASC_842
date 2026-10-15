import { type BalanceSheetData } from '../../../utils/financialReports';
import { footBalanceSheet } from '../../../utils/reports/balanceSheetFooting';
import { parseLocalDate } from '../../../utils/formatting';
import { TrendingUp, DollarSign, Building2 } from 'lucide-react';

import { AmountButton } from '../shared/AmountButton';
import { formatCurrency, formatDate } from '../shared/formatters';

export function BalanceSheetReport({ balanceSheet, periodEnd }: { balanceSheet: BalanceSheetData; periodEnd: string }) {
  const f = footBalanceSheet(balanceSheet);
  const { assets, liabilities } = balanceSheet;
  const accItems = (cls: 'finance' | 'operating') => assets.breakdown.accDepreciation.filter((i) => i.classification === cls);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-sm">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Balance Sheet</h3>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">As of {formatDate(parseLocalDate(periodEnd))}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Net ROU</p>
            <p className="text-sm font-bold text-emerald-900 tabular-nums">{formatCurrency(f.netRou)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700">Liabilities</p>
            <p className="text-sm font-bold text-orange-900 tabular-nums">{formatCurrency(f.totalLiability)}</p>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-blue-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <h4 className="text-sm font-bold uppercase tracking-wide">Assets</h4>
            </div>
            <span className="text-xs font-semibold opacity-90">Right-of-Use</span>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between items-center py-3 px-3 rounded-lg bg-blue-600 text-white">
              <span className="font-bold text-sm uppercase tracking-wide">Net ROU Assets</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.netRou)}</span>
            </div>
            <div className="pt-2 border-t border-slate-100 mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Breakdown</p>
              <div className="flex justify-between py-1.5">
                <span className="text-sm text-slate-600">Right-of-Use Assets (Gross)</span>
                <AmountButton value={assets.currentRouAsset} display={f.grossRou} items={assets.breakdown.grossRou} label="Right-of-Use Assets (Gross)" className="text-slate-900 tabular-nums" />
              </div>
              <p className="text-[11px] text-slate-500 italic ml-1 -mt-0.5 mb-1">PV of lease payments + initial direct costs + prepaid rent − lease incentives</p>
              <div className="flex justify-between py-1.5">
                <span className="text-sm text-slate-600">Less: Accumulated amortization</span>
                <AmountButton value={assets.accumulatedDepreciation} display={f.accumulatedTotal} items={assets.breakdown.accDepreciation} label="Accumulated Amortization" className="text-red-700 tabular-nums" />
              </div>
              <div className="flex justify-between gap-3 py-1 pl-4">
                <span className="text-xs text-slate-500">Accumulated amortization (finance)</span>
                <AmountButton value={assets.accumulatedAmortizationFinance} display={f.accumulatedFinance} items={accItems('finance')} label="Accumulated amortization (finance)" className="text-xs text-slate-700 tabular-nums" />
              </div>
              <div className="flex justify-between gap-3 py-1 pl-4">
                <span className="text-xs text-slate-500">Accumulated ROU amortization (operating — straight-line cost less interest)</span>
                <AmountButton value={assets.accumulatedAmortizationOperating} display={f.accumulatedOperating} items={accItems('operating')} label="Accumulated ROU amortization (operating)" className="text-xs text-slate-700 tabular-nums shrink-0" />
              </div>
              {f.impairment !== 0 && (
                <div className="flex justify-between py-1.5">
                  <span className="text-sm text-slate-600">Less: Accumulated impairment</span>
                  <AmountButton value={assets.impairment} display={f.impairment} items={assets.breakdown.impairment} label="Accumulated Impairment" className="text-red-700 tabular-nums" />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-orange-100 bg-gradient-to-b from-orange-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-orange-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              <h4 className="text-sm font-bold uppercase tracking-wide">Liabilities</h4>
            </div>
            <span className="text-xs font-semibold opacity-90">Lease Obligations</span>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Current Lease Liabilities</span>
              <AmountButton value={liabilities.currentPortion} display={f.current} items={liabilities.breakdown.current} label="Current Lease Liabilities" className="text-slate-900 tabular-nums" />
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Long-term Lease Liabilities</span>
              <AmountButton value={liabilities.longTermPortion} display={f.longTerm} items={liabilities.breakdown.longTerm} label="Long-term Lease Liabilities" className="text-slate-900 tabular-nums" />
            </div>
            <div className="flex justify-between items-center py-3 mt-2 px-3 rounded-lg bg-orange-600 text-white">
              <span className="font-bold text-sm uppercase tracking-wide">Total Liabilities</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.totalLiability)}</span>
            </div>
            {(liabilities.residualValueGuarantee > 0 || liabilities.leaseIncentiveLiability > 0) && (
              <div className="pt-2 mt-2 border-t border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Memo — not included in total above</p>
                {liabilities.residualValueGuarantee > 0 && (
                  <div className="flex justify-between py-1">
                    <span className="text-xs text-slate-600">Residual Value Guarantees</span>
                    <span className="text-xs font-semibold text-slate-800 tabular-nums">{formatCurrency(liabilities.residualValueGuarantee)}</span>
                  </div>
                )}
                {liabilities.leaseIncentiveLiability > 0 && (
                  <div className="flex justify-between py-1">
                    <span className="text-xs text-slate-600">Lease Incentives Received</span>
                    <span className="text-xs font-semibold text-slate-800 tabular-nums">{formatCurrency(liabilities.leaseIncentiveLiability)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-700">ROU assets vs lease liabilities: </span>
          ROU assets {formatCurrency(f.netRou)} and lease liabilities {formatCurrency(f.totalLiability)} are measured separately under ASC 842; the difference between them is not a reported measure.
        </div>
      </div>
    </div>
  );
}
