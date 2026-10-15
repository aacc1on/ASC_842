import { useState } from 'react';
import { Lease } from '../types/lease';
import { X, Download, Calendar } from 'lucide-react';
import { Pagination } from './Pagination';
import { useAmortizationSchedule } from '../hooks/useAmortizationSchedule';
import { LoadError } from './LoadError';

interface AmortizationViewProps {
  lease: Lease;
  onClose: () => void;
}

export function AmortizationView({ lease, onClose }: AmortizationViewProps) {
  const { data: schedule, loading, error, retry } = useAmortizationSchedule(lease.id);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
  };

  const exportToCSV = () => {
    const headers = [
      'Period',
      'Date',
      'Beginning Liability',
      'Payment',
      'Interest',
      'Principal',
      'Ending Liability',
      'ROU Asset',
      'Depreciation',
    ];

    const rows = schedule.map((row) => [
      row.period_number,
      row.period_date,
      row.beginning_liability,
      row.payment_amount,
      row.interest_expense,
      row.principal_reduction,
      row.ending_liability,
      row.rou_asset_balance,
      row.depreciation_expense,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lease.lease_name}-amortization.csv`;
    a.click();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{lease.lease_name}</h2>
              <p className="text-blue-100 text-sm">Amortization Schedule</p>
              {lease.accounting_treatment === 'short_term_exemption' && (
                <span className="mt-1 inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400 text-amber-900">
                  Short-Term Lease — Recognition Exemption Applied
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-semibold">Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Classification</p>
              <p className="text-lg font-bold text-slate-900 capitalize">
                {lease.lease_classification}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Term</p>
              <p className="text-lg font-bold text-slate-900">{lease.lease_term_months} months</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-slate-500 mb-1">ROU Asset (Initial)</p>
              <p className="text-lg font-bold text-slate-900">
                {formatCurrency(lease.rou_asset || 0)}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Lease Liability (PV)</p>
              <p className="text-lg font-bold text-slate-900">
                {formatCurrency(lease.lease_liability || 0)}
              </p>
            </div>
          </div>
          {((lease.initial_direct_costs || 0) > 0 ||
            (lease.lease_incentives || 0) > 0 ||
            (lease.residual_value_guarantee || 0) > 0) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(lease.initial_direct_costs || 0) > 0 && (
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg">
                  <p className="text-xs text-blue-600 font-semibold mb-1">Initial Direct Costs</p>
                  <p className="text-base font-bold text-blue-900">
                    {formatCurrency(lease.initial_direct_costs || 0)}
                  </p>
                  <p className="text-xs text-blue-500 mt-0.5">Added to ROU Asset</p>
                </div>
              )}
              {(lease.lease_incentives || 0) > 0 && (
                <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg">
                  <p className="text-xs text-amber-600 font-semibold mb-1">Lease Incentives</p>
                  <p className="text-base font-bold text-amber-900">
                    {formatCurrency(lease.lease_incentives || 0)}
                  </p>
                  <p className="text-xs text-amber-500 mt-0.5">Deducted from ROU Asset</p>
                </div>
              )}
              {(lease.residual_value_guarantee || 0) > 0 && (
                <div className="bg-rose-50 border border-rose-100 p-3 rounded-lg">
                  <p className="text-xs text-rose-600 font-semibold mb-1">Residual Value Guarantee</p>
                  <p className="text-base font-bold text-rose-900">
                    {formatCurrency(lease.residual_value_guarantee || 0)}
                  </p>
                  <p className="text-xs text-rose-500 mt-0.5">Paid in final period</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {error ? (
            <LoadError message={error} onRetry={retry} />
          ) : loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-slate-500 mt-4">Loading schedule...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Period
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Beg. Liability
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Payment
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Interest
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Principal
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        End. Liability
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        ROU Asset
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">
                        Depreciation
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {schedule.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row, index) => (
                      <tr
                        key={row.id}
                        className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                      >
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                          {row.period_number}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {formatDate(row.period_date)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                          {formatCurrency(row.beginning_liability)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                          {formatCurrency(row.payment_amount)}
                        </td>
                        <td className="px-4 py-3 text-sm text-red-600 text-right font-medium">
                          {formatCurrency(row.interest_expense)}
                        </td>
                        <td className="px-4 py-3 text-sm text-emerald-600 text-right font-medium">
                          {formatCurrency(row.principal_reduction)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 text-right font-semibold">
                          {formatCurrency(row.ending_liability)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 text-right font-medium">
                          {formatCurrency(row.rou_asset_balance)}
                        </td>
                        <td className="px-4 py-3 text-sm text-orange-600 text-right font-medium">
                          {formatCurrency(row.depreciation_expense)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(schedule.length / pageSize)}
                totalItems={schedule.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                pageSizeOptions={[12, 25, 50, 100]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
