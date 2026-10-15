import { useState, useMemo } from 'react';
import { type Lease } from '../../../types/lease';
import {
  buildContractExpirationCsv,
  buildExpirationRows,
  contractExpirationCsvFilename,
  countExpirationBuckets,
  formatExpirationCurrency,
  formatExpirationDate,
  getRowStatus,
  isExpired,
  sortExpirationRows,
  startOfDay,
  toggleSortDirection,
  type ExpirationSortKey,
  type SortDirection,
} from '../../../utils/reports/contractExpiration';
import { Download, Calendar, CheckCircle2, XCircle, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export function ContractExpirationReport({ leases }: { leases: Lease[] }) {
  const [sortKey, setSortKey] = useState<ExpirationSortKey>('days_remaining');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const leaseData = useMemo(() => buildExpirationRows(leases, startOfDay(new Date())), [leases]);

  const sorted = useMemo(() => sortExpirationRows(leaseData, sortKey, sortDir), [leaseData, sortKey, sortDir]);

  const handleSort = (key: ExpirationSortKey) => {
    if (sortKey === key) {
      setSortDir(toggleSortDirection);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const { criticalCount, warningCount, expiredCount } = countExpirationBuckets(leaseData);

  const downloadCsv = () => {
    const csv = buildContractExpirationCsv(sorted);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = contractExpirationCsvFilename(new Date());
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: ExpirationSortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Contract Expiration Report
          </h3>
          <p className="text-sm text-slate-500 mt-1">Lease contracts with approaching expiration dates</p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={sorted.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="bg-red-600 p-2 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
            <p className="text-xs text-red-600 font-medium">Expiring within 1 month</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="bg-amber-500 p-2 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-700">{warningCount}</p>
            <p className="text-xs text-amber-600 font-medium">Expiring within 2 months</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <div className="bg-slate-500 p-2 rounded-lg">
            <XCircle className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-700">{expiredCount}</p>
            <p className="text-xs text-slate-500 font-medium">Already expired</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300"></span> 1 month or less</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300"></span> 1-2 months</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-slate-200"></span> More than 2 months</span>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th onClick={() => handleSort('lease_name')} className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase cursor-pointer select-none hover:bg-slate-200 transition-colors">
                <span className="inline-flex items-center gap-1">Lease <SortIcon col="lease_name" /></span>
              </th>
              <th onClick={() => handleSort('lessor_name')} className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase cursor-pointer select-none hover:bg-slate-200 transition-colors">
                <span className="inline-flex items-center gap-1">Lessor <SortIcon col="lessor_name" /></span>
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Classification</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase whitespace-nowrap">Start Date</th>
              <th onClick={() => handleSort('lease_end_date')} className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase whitespace-nowrap cursor-pointer select-none hover:bg-slate-200 transition-colors">
                <span className="inline-flex items-center gap-1">End Date <SortIcon col="lease_end_date" /></span>
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase whitespace-nowrap">Term (mo)</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase whitespace-nowrap">Monthly Payment</th>
              <th onClick={() => handleSort('days_remaining')} className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase whitespace-nowrap cursor-pointer select-none hover:bg-slate-200 transition-colors">
                <span className="inline-flex items-center gap-1 justify-end">Days Remaining <SortIcon col="days_remaining" /></span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-bold text-slate-700 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">No leases found</td></tr>
            )}
            {sorted.map((lease) => {
              const status = getRowStatus(lease.daysRemaining);
              const expired = isExpired(lease.daysRemaining);
              const rowBg = expired
                ? 'bg-slate-50'
                : status === 'critical'
                  ? 'bg-red-50'
                  : status === 'warning'
                    ? 'bg-amber-50'
                    : 'bg-white';
              return (
                <tr key={lease.id} className={`${rowBg} transition-colors`}>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-slate-900">{lease.lease_name}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{lease.lessor_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${lease.lease_classification === 'finance' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                      {lease.lease_classification}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                    {formatExpirationDate(lease.lease_start_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap font-medium">
                    {formatExpirationDate(lease.lease_end_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right">{lease.lease_term_months}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium whitespace-nowrap">
                    {formatExpirationCurrency(lease.payment_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {expired ? (
                      <span className="text-sm font-bold text-slate-500">Expired</span>
                    ) : (
                      <span className={`text-sm font-bold ${status === 'critical' ? 'text-red-700' : status === 'warning' ? 'text-amber-700' : 'text-slate-900'}`}>
                        {lease.daysRemaining}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {expired ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold">
                        <XCircle className="w-3 h-3" /> Expired
                      </span>
                    ) : status === 'critical' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-200 text-red-700 text-xs font-semibold">
                        <AlertTriangle className="w-3 h-3" /> Critical
                      </span>
                    ) : status === 'warning' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-200 text-amber-700 text-xs font-semibold">
                        <AlertTriangle className="w-3 h-3" /> Warning
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
