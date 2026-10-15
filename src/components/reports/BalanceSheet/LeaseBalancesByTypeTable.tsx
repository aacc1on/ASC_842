import { type LeaseBalancesByType } from '../../../utils/financialReports';
import { footBalancesByType } from '../../../utils/reports/balanceSheetFooting';

import { formatCurrency } from '../shared/formatters';

type Row = { operating: number; finance: number; total: number };

function BalanceRow({ label, row, kind = 'detail', negative = false }: { label: string; row: Row; kind?: 'detail' | 'subtotal' | 'total'; negative?: boolean }) {
  const fmt = (v: number) => (negative ? `(${formatCurrency(v)})` : formatCurrency(v));
  const rowClass = kind === 'total' ? 'bg-slate-50 border-t-2 border-slate-200' : 'hover:bg-slate-50';
  const labelClass = kind === 'detail' ? 'text-slate-600 pl-9' : kind === 'subtotal' ? 'font-semibold text-slate-700' : 'font-bold text-slate-900';
  const cellClass = kind === 'detail' ? 'text-slate-700' : kind === 'subtotal' ? 'text-slate-800' : 'font-bold text-slate-900';
  const totalClass = kind === 'detail' ? 'font-semibold text-slate-800' : 'font-bold text-slate-900';
  return (
    <tr className={rowClass}>
      <td className={`px-5 py-3 ${labelClass}`}>{label}</td>
      <td className={`px-5 py-3 text-right tabular-nums ${cellClass}`}>{fmt(row.operating)}</td>
      <td className={`px-5 py-3 text-right tabular-nums ${cellClass}`}>{fmt(row.finance)}</td>
      <td className={`px-5 py-3 text-right tabular-nums ${totalClass}`}>{fmt(row.total)}</td>
    </tr>
  );
}

export function LeaseBalancesByTypeTable({
  balancesByType,
  subtitle = 'Operating vs finance lease balances, reconciled to the Balance Sheet.',
}: {
  balancesByType: LeaseBalancesByType;
  subtitle?: string;
}) {
  const t = footBalancesByType(balancesByType);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-base font-bold text-slate-900">Lease Balances by Type (ASC 842-20-45-1)</h3>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase">Balance</th>
              <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase">Operating</th>
              <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase">Finance</th>
              <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <BalanceRow label="ROU Assets (Gross)" row={t.gross} />
            <BalanceRow label="Less: Accumulated amortization" row={t.accumulated} negative />
            {t.impairment.total !== 0 && <BalanceRow label="Less: Accumulated impairment" row={t.impairment} negative />}
            <BalanceRow label="ROU Assets" row={t.rou} kind="subtotal" />
            <BalanceRow label="Current Liabilities" row={t.current} />
            <BalanceRow label="Noncurrent Liabilities" row={t.noncurrent} />
            <BalanceRow label="Total Lease Liabilities" row={t.liability} kind="total" />
          </tbody>
        </table>
      </div>
    </div>
  );
}
