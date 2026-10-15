import { type Lease } from '../../../types/lease';
import { leaseLifecycle, LIFECYCLE_BADGE, LIFECYCLE_LABEL } from '../../../utils/leaseLifecycle';
import { Calendar, Wallet } from 'lucide-react';

import { formatCurrency } from '../shared/formatters';

export function PortfolioKanban({ leases }: { leases: Lease[] }) {
  const columns = [
    { key: 'finance', title: 'Finance Leases', accent: 'blue', headerBg: 'bg-blue-50', headerBorder: 'border-blue-200', chip: 'bg-blue-100 text-blue-700', dot: 'bg-blue-600', leases: leases.filter((l) => l.lease_classification === 'finance') },
    { key: 'operating', title: 'Operating Leases', accent: 'orange', headerBg: 'bg-orange-50', headerBorder: 'border-orange-200', chip: 'bg-orange-100 text-orange-700', dot: 'bg-orange-600', leases: leases.filter((l) => l.lease_classification !== 'finance') },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {columns.map((col) => {
        const totalRou = col.leases.reduce((s: number, l) => s + (l.currentBalances?.currentRouAsset || 0), 0);
        const totalLiab = col.leases.reduce((s: number, l) => s + (l.currentBalances?.currentLiability || 0), 0);
        return (
          <div key={col.key} className={`border ${col.headerBorder} rounded-xl overflow-hidden bg-slate-50/40`}>
            <div className={`${col.headerBg} border-b ${col.headerBorder} px-5 py-4`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`}></span>
                  <h4 className="text-base font-bold text-slate-900">{col.title}</h4>
                  <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full text-xs font-bold ${col.chip}`}>
                    {col.leases.length}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <div>
                  <p className="text-slate-500 font-medium uppercase tracking-wide">ROU Total</p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(totalRou)}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-medium uppercase tracking-wide">Liability Total</p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(totalLiab)}</p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-3 max-h-[640px] overflow-y-auto">
              {col.leases.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-500">
                  No leases in this category
                </div>
              ) : (
                col.leases.map((lease) => {
                  const rou = lease.currentBalances?.currentRouAsset || 0;
                  const liab = lease.currentBalances?.currentLiability || 0;
                  return (
                    <div key={lease.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-slate-300 transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <h5 className="text-sm font-bold text-slate-900 leading-tight">{lease.lease_name}</h5>
                        <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${LIFECYCLE_BADGE[leaseLifecycle(lease)]}`}>
                          {LIFECYCLE_LABEL[leaseLifecycle(lease)]}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{lease.lease_start_date ? new Date(lease.lease_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500 justify-end">
                          <span>{lease.lease_term_months ? `${lease.lease_term_months} mo` : '—'}</span>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">ROU Asset</p>
                          <p className="text-sm font-semibold text-slate-900 mt-0.5">{formatCurrency(rou)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Liability</p>
                          <p className="text-sm font-semibold text-slate-900 mt-0.5">{formatCurrency(liab)}</p>
                        </div>
                        <div className="col-span-2 flex items-center gap-1.5 text-slate-600 pt-2 border-t border-slate-100 mt-1">
                          <Wallet className="w-3.5 h-3.5" />
                          <span className="text-xs">Monthly:</span>
                          <span className="text-xs font-semibold text-slate-900">{formatCurrency(lease.payment_amount)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
