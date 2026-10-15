import { type LeaseReport } from '../../../types/lease';
import { BarChart3, TrendingUp, FileText, DollarSign, Building2, Receipt, Wallet } from 'lucide-react';

import { formatCurrency } from '../shared/formatters';

export function PortfolioStats({ report }: { report: LeaseReport }) {
  return (
    <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {[
            { label: 'Total Leases', value: report.totalLeases.toLocaleString(), foot: `${report.activeLeases} active`, Icon: FileText, ring: 'ring-blue-100', accent: 'bg-blue-600', soft: 'bg-blue-50 text-blue-700', barFrom: 'from-blue-500', barTo: 'to-blue-700' },
            { label: 'Total ROU Assets', value: formatCurrency(report.totalRouAsset), foot: 'Right-of-use assets', Icon: TrendingUp, ring: 'ring-emerald-100', accent: 'bg-emerald-600', soft: 'bg-emerald-50 text-emerald-700', barFrom: 'from-emerald-500', barTo: 'to-emerald-700' },
            { label: 'Total Liabilities', value: formatCurrency(report.totalLiability), foot: 'Lease obligations', Icon: DollarSign, ring: 'ring-orange-100', accent: 'bg-orange-600', soft: 'bg-orange-50 text-orange-700', barFrom: 'from-orange-500', barTo: 'to-orange-700' },
            { label: 'Monthly Payments', value: formatCurrency(report.totalMonthlyPayments), foot: 'Active leases only', Icon: Wallet, ring: 'ring-cyan-100', accent: 'bg-cyan-600', soft: 'bg-cyan-50 text-cyan-700', barFrom: 'from-cyan-500', barTo: 'to-cyan-700' },
          ].map(({ label, value, foot, Icon, ring, accent, soft, barFrom, barTo }) => (
            <div key={label} className={`group relative overflow-hidden bg-white rounded-2xl border border-slate-200 ring-1 ${ring} shadow-sm hover:shadow-md transition-all`}>
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${barFrom} ${barTo}`}></div>
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className={`${accent} p-2.5 rounded-xl shadow-sm`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${soft}`}>{foot}</span>
                </div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">{value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-900">Classification Breakdown</h3>
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{report.totalLeases.toLocaleString()} total</span>
            </div>
            {(() => {
              const total = Math.max(1, report.totalLeases);
              const finPct = (report.financeLeases / total) * 100;
              const opPct = (report.operatingLeases / total) * 100;
              const R = 56;
              const C = 2 * Math.PI * R;
              const finLen = (finPct / 100) * C;
              const opLen = (opPct / 100) * C;
              return (
                <div className="flex items-center gap-6">
                  <div className="relative shrink-0">
                    <svg viewBox="0 0 140 140" className="w-36 h-36 -rotate-90">
                      <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="18" />
                      <circle
                        cx="70" cy="70" r={R} fill="none"
                        stroke="#2563eb" strokeWidth="18" strokeLinecap="butt"
                        strokeDasharray={`${finLen} ${C - finLen}`}
                        strokeDashoffset={0}
                      />
                      <circle
                        cx="70" cy="70" r={R} fill="none"
                        stroke="#ea580c" strokeWidth="18" strokeLinecap="butt"
                        strokeDasharray={`${opLen} ${C - opLen}`}
                        strokeDashoffset={-finLen}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-slate-900 tabular-nums">{report.totalLeases}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Leases</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/60 border border-blue-100">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Finance</p>
                          <p className="text-[11px] text-slate-500">{finPct.toFixed(1)}% of portfolio</p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-blue-700 tabular-nums">{report.financeLeases}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50/60 border border-orange-100">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-600"></span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Operating</p>
                          <p className="text-[11px] text-slate-500">{opPct.toFixed(1)}% of portfolio</p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-orange-700 tabular-nums">{report.operatingLeases}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-5">Key Metrics</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Weighted Avg Borrowing Rate', value: `${report.avgBorrowingRate.toFixed(2)}%`, Icon: TrendingUp, tint: 'bg-emerald-50 text-emerald-700' },
                { label: 'Asset / Liability', value: report.totalLiability ? (report.totalRouAsset / report.totalLiability).toFixed(2) : '—', Icon: BarChart3, tint: 'bg-blue-50 text-blue-700' },
                { label: 'Avg Asset / Lease', value: formatCurrency(report.totalRouAsset / Math.max(1, report.activeLeases)), Icon: Building2, tint: 'bg-cyan-50 text-cyan-700' },
                { label: 'Avg Liability / Lease', value: formatCurrency(report.totalLiability / Math.max(1, report.activeLeases)), Icon: Receipt, tint: 'bg-orange-50 text-orange-700' },
              ].map(({ label, value, Icon, tint }) => (
                <div key={label} className="p-4 rounded-xl border border-slate-100 bg-slate-50/40 hover:bg-white hover:border-slate-200 transition-colors">
                  <div className={`inline-flex w-9 h-9 items-center justify-center rounded-lg ${tint} mb-3`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
    </>
  );
}
