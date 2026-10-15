import { type CashFlowData } from '../../../utils/financialReports';
import { footCashFlow } from '../../../utils/reports/statementFooting';
import { DollarSign, Receipt, Wallet } from 'lucide-react';

import { AmountButton } from '../shared/AmountButton';
import { formatCurrency, formatDate } from '../shared/formatters';

export function CashFlowStatement({ cashFlow }: { cashFlow: CashFlowData }) {
  const f = footCashFlow(cashFlow);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-600 p-2.5 rounded-xl shadow-sm">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Cash Flow Statement</h3>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{formatDate(cashFlow.periodStart)} — {formatDate(cashFlow.periodEnd)}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Operating</p>
            <p className="text-sm font-bold text-blue-900 tabular-nums">{formatCurrency(f.operatingTotal)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Financing</p>
            <p className="text-sm font-bold text-emerald-900 tabular-nums">{formatCurrency(f.financingTotal)}</p>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-blue-600 text-white flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            <h4 className="text-sm font-bold uppercase tracking-wide">Operating Activities</h4>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Interest Paid (Finance)</span>
              <AmountButton value={cashFlow.operatingActivities.interestPaid} display={f.interestPaid} items={cashFlow.operatingActivities.breakdown.interest} label="Interest Paid (Finance Leases)" isNegative className="text-red-600 tabular-nums" />
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Lease Payments (Operating)</span>
              <AmountButton value={cashFlow.operatingActivities.leasePayments} display={f.leasePayments} items={cashFlow.operatingActivities.breakdown.leasePayments} label="Lease Payments (Operating Leases)" isNegative className="text-red-600 tabular-nums" />
            </div>
            {f.shortTermLeasePayments !== 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Short-term Lease Payments</span>
                <AmountButton value={cashFlow.operatingActivities.shortTermLeasePayments} display={f.shortTermLeasePayments} items={cashFlow.operatingActivities.breakdown.shortTermLeasePayments} label="Short-term Lease Payments" isNegative className="text-red-600 tabular-nums" />
              </div>
            )}
            {f.terminationCashPaid !== 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Lease Termination Payments</span>
                <AmountButton value={cashFlow.operatingActivities.terminationCashPaid} display={f.terminationCashPaid} items={cashFlow.operatingActivities.breakdown.terminationCash} label="Lease Termination Payments" isNegative className="text-red-600 tabular-nums" />
              </div>
            )}
            <div className={`flex justify-between items-center py-3 mt-2 px-3 rounded-lg text-white ${f.operatingTotal >= 0 ? 'bg-emerald-600' : 'bg-blue-700'}`}>
              <span className="font-bold text-sm uppercase tracking-wide">Net Operating</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.operatingTotal)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-gradient-to-b from-emerald-50/40 to-white overflow-hidden">
          <div className="px-5 py-3 bg-emerald-600 text-white flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            <h4 className="text-sm font-bold uppercase tracking-wide">Financing Activities</h4>
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-700">Principal Payments (Finance)</span>
              <AmountButton value={cashFlow.financingActivities.principalPayments} display={f.principalPayments} items={cashFlow.financingActivities.breakdown.principal} label="Principal Payments (Finance Leases)" isNegative className="text-red-600 tabular-nums" />
            </div>
            {cashFlow.financingActivities.initialDirectCostsPaid > 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Initial Direct Costs Paid</span>
                <AmountButton value={cashFlow.financingActivities.initialDirectCostsPaid} display={f.idcPaid} items={cashFlow.financingActivities.breakdown.idc} label="Initial Direct Costs Paid" isNegative className="text-red-600 tabular-nums" />
              </div>
            )}
            {cashFlow.financingActivities.residualValueGuaranteePaid > 0 && (
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-700">Residual Value Guarantee Paid</span>
                <AmountButton value={cashFlow.financingActivities.residualValueGuaranteePaid} display={f.rvgPaid} items={cashFlow.financingActivities.breakdown.rvg} label="Residual Value Guarantee Paid" isNegative className="text-red-600 tabular-nums" />
              </div>
            )}
            <div className={`flex justify-between items-center py-3 mt-2 px-3 rounded-lg text-white ${f.financingTotal >= 0 ? 'bg-emerald-600' : 'bg-emerald-700'}`}>
              <span className="font-bold text-sm uppercase tracking-wide">Net Financing</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(f.financingTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className={`relative overflow-hidden rounded-2xl p-5 border ${f.netCashFlow >= 0 ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/60 border-emerald-200' : 'bg-gradient-to-r from-red-50 to-red-100/60 border-red-200'}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Net Change in Cash</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">Operating + Financing</p>
            </div>
            <span className={`text-3xl font-bold tabular-nums tracking-tight ${f.netCashFlow >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {formatCurrency(f.netCashFlow)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
