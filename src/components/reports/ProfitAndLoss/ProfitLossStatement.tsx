import { type ProfitLossData } from '../../../utils/financialReports';
import { footProfitLoss } from '../../../utils/reports/statementFooting';
import { TrendingUp, Receipt } from 'lucide-react';

import { AmountButton } from '../shared/AmountButton';
import { formatCurrency, formatDate } from '../shared/formatters';

export function ProfitLossStatement({ profitLoss }: { profitLoss: ProfitLossData }) {
  const f = footProfitLoss(profitLoss);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-orange-600 p-2.5 rounded-xl shadow-sm">
            <Receipt className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Profit &amp; Loss Statement</h3>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{formatDate(profitLoss.periodStart)} — {formatDate(profitLoss.periodEnd)}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700">Operating</p>
            <p className="text-sm font-bold text-orange-900 tabular-nums">{formatCurrency(f.operatingTotal)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">Interest</p>
            <p className="text-sm font-bold text-red-900 tabular-nums">{formatCurrency(f.interest)}</p>
          </div>
          {f.netGainLoss !== 0 && (
            <div className={`px-3 py-2 rounded-lg ${f.netGainLoss >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${f.netGainLoss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{f.netGainLoss >= 0 ? 'Gain' : 'Loss'}</p>
              <p className={`text-sm font-bold tabular-nums ${f.netGainLoss >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>{formatCurrency(Math.abs(f.netGainLoss))}</p>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-orange-100 bg-gradient-to-b from-orange-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-orange-600 text-white flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            <h4 className="text-sm font-bold uppercase tracking-wide">Operating Expenses</h4>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Depreciation (Finance)</span>
              <AmountButton value={profitLoss.operatingExpenses.depreciationExpense} display={f.depreciation} items={profitLoss.operatingExpenses.breakdown.depreciation} label="Depreciation Expense" className="text-slate-900 tabular-nums" />
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Lease Expense (Operating)</span>
              <AmountButton value={profitLoss.operatingExpenses.leaseExpense} display={f.leaseExpense} items={profitLoss.operatingExpenses.breakdown.leaseExpense} label="Lease Expense (Operating Leases)" className="text-slate-900 tabular-nums" />
            </div>
            {f.shortTermLeaseCost !== 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Short-term Lease Cost</span>
                <AmountButton value={profitLoss.operatingExpenses.shortTermLeaseCost} display={f.shortTermLeaseCost} items={profitLoss.operatingExpenses.breakdown.shortTermLeaseCost} label="Short-term Lease Cost" className="text-slate-900 tabular-nums" />
              </div>
            )}
            {profitLoss.operatingExpenses.initialDirectCostsAmortized > 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Initial Direct Costs (Amortized)</span>
                <AmountButton value={profitLoss.operatingExpenses.initialDirectCostsAmortized} display={f.idc} items={profitLoss.operatingExpenses.breakdown.idc} label="Initial Direct Costs (Amortized)" className="text-slate-900 tabular-nums" />
              </div>
            )}
            <div className="flex justify-between items-center py-3 mt-2 px-3 rounded-lg bg-orange-600 text-white">
              <span className="font-bold text-sm uppercase tracking-wide">Total Operating</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.operatingTotal)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-red-100 bg-gradient-to-b from-red-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-red-600 text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <h4 className="text-sm font-bold uppercase tracking-wide">Financing Costs</h4>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Interest Expense (Finance)</span>
              <AmountButton value={profitLoss.financingCosts.interestExpense} display={f.interest} items={profitLoss.financingCosts.breakdown.interest} label="Interest Expense (Finance Leases)" className="text-slate-900 tabular-nums" />
            </div>
            <div className="flex justify-between items-center py-3 mt-2 px-3 rounded-lg bg-red-600 text-white">
              <span className="font-bold text-sm uppercase tracking-wide">Total Interest</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.interest)}</span>
            </div>
          </div>
        </div>
      </div>

      {(profitLoss.gainLossOnTermination.gain > 0 || profitLoss.gainLossOnTermination.loss > 0) && (
        <div className="px-6 pb-2">
          <div className="rounded-xl border border-emerald-100 bg-gradient-to-b from-emerald-50/40 to-white overflow-hidden">
            <div className="px-5 py-3 bg-emerald-600 text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <h4 className="text-sm font-bold uppercase tracking-wide">Gain / Loss on Lease Termination</h4>
            </div>
            <div className="p-5 space-y-2">
              {profitLoss.gainLossOnTermination.gain > 0 && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-slate-700">Gain on Lease Termination</span>
                  <AmountButton value={profitLoss.gainLossOnTermination.gain} display={f.gain} items={profitLoss.gainLossOnTermination.breakdown.filter(b => b.value > 0)} label="Gain on Lease Termination" className="text-emerald-700 tabular-nums" />
                </div>
              )}
              {profitLoss.gainLossOnTermination.loss > 0 && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-slate-700">Loss on Lease Termination</span>
                  <AmountButton value={profitLoss.gainLossOnTermination.loss} display={f.loss} items={profitLoss.gainLossOnTermination.breakdown.filter(b => b.value < 0).map(b => ({ ...b, value: Math.abs(b.value) }))} label="Loss on Lease Termination" className="text-red-700 tabular-nums" />
                </div>
              )}
              <div className={`flex justify-between items-center py-3 mt-2 px-3 rounded-lg ${f.netGainLoss >= 0 ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
                <span className="font-bold text-sm uppercase tracking-wide">Net {f.netGainLoss >= 0 ? 'Gain' : 'Loss'}</span>
                <span className="font-bold text-lg tabular-nums">{formatCurrency(Math.abs(f.netGainLoss))}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 pb-6">
        <div className={`relative overflow-hidden rounded-2xl p-5 border ${f.netIncome >= 0 ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/60 border-emerald-200' : 'bg-gradient-to-r from-red-50 to-red-100/60 border-red-200'}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Impact on Net Income</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">Total lease-related expenses: <span className="font-bold tabular-nums">{formatCurrency(f.totalExpenses)}</span></p>
            </div>
            <span className={`text-3xl font-bold tabular-nums tracking-tight ${f.netIncome >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {formatCurrency(f.netIncome)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
