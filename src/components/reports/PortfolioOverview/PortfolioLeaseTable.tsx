import { type Lease } from '../../../types/lease';
import { leaseLifecycle, LIFECYCLE_BADGE, LIFECYCLE_LABEL } from '../../../utils/leaseLifecycle';
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

import { defaultPortfolioSortDir, PORTFOLIO_PAGE_SIZE, sortPortfolioLeases, type PortfolioSortKey, type PortfolioViewState } from '../../../utils/reports/portfolio';
import { formatCurrency } from '../shared/formatters';

export function PortfolioLeaseTable({ leases, view, onViewChange }: { leases: Lease[]; view: PortfolioViewState; onViewChange: (v: PortfolioViewState) => void }) {
  const sortedPortfolioLeases = sortPortfolioLeases(leases, view.sortKey, view.sortDir);
  const handlePortfolioSort = (key: PortfolioSortKey) => {
    onViewChange(view.sortKey === key
      ? { ...view, sortDir: view.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }
      : { ...view, sortKey: key, sortDir: defaultPortfolioSortDir(key), page: 1 });
  };

  return (
    <>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200">
                {([
                  { key: 'lease_name', label: 'Lease Name', align: 'left' },
                  { key: 'lease_classification', label: 'Classification', align: 'left' },
                  { key: 'lease_start_date', label: 'Start Date', align: 'left' },
                  { key: 'lease_term_months', label: 'Duration (mo)', align: 'right' },
                  { key: 'rou_asset', label: 'ROU Asset', align: 'right' },
                  { key: 'liability', label: 'Liability', align: 'right' },
                  { key: 'payment_amount', label: 'Monthly Payment', align: 'right' },
                  { key: 'status', label: 'Status', align: 'center' },
                ] as { key: PortfolioSortKey; label: string; align: string }[]).map(col => (
                  <th
                    key={col.key}
                    onClick={() => handlePortfolioSort(col.key)}
                    className={`px-4 py-3 text-xs font-bold text-slate-700 uppercase whitespace-nowrap cursor-pointer select-none hover:bg-slate-200 transition-colors ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}>
                      {col.label}
                      {view.sortKey === col.key ? (
                        view.sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sortedPortfolioLeases.slice((view.page - 1) * PORTFOLIO_PAGE_SIZE, view.page * PORTFOLIO_PAGE_SIZE).map((lease, index) => {
                const currentRouAsset = lease.currentBalances?.currentRouAsset || 0;
                const currentLiability = lease.currentBalances?.currentLiability || 0;
                return (
                  <tr key={lease.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{lease.lease_name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${lease.lease_classification === 'finance' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                        {lease.lease_classification === 'finance' ? 'Finance' : 'Operating'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {lease.lease_start_date ? new Date(lease.lease_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                      {lease.lease_term_months ? lease.lease_term_months : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">{formatCurrency(currentRouAsset)}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">{formatCurrency(currentLiability)}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">{formatCurrency(lease.payment_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${LIFECYCLE_BADGE[leaseLifecycle(lease)]}`}>
                        {LIFECYCLE_LABEL[leaseLifecycle(lease)]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {leases.length > PORTFOLIO_PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-600">
              Page {view.page} of {Math.ceil(leases.length / PORTFOLIO_PAGE_SIZE)}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onViewChange({ ...view, page: Math.max(1, view.page - 1) })}
                disabled={view.page === 1}
                className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => onViewChange({ ...view, page: Math.min(Math.ceil(leases.length / PORTFOLIO_PAGE_SIZE), view.page + 1) })}
                disabled={view.page === Math.ceil(leases.length / PORTFOLIO_PAGE_SIZE)}
                className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
    </>
  );
}
