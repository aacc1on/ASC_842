import { Pagination } from '../Pagination';
import type { ContractCancellation } from './contractModHelpers';

interface CancellationsTableProps {
  cancellations: ContractCancellation[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function statusBadge(status: string) {
  const base = 'inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold';
  switch (status) {
    case 'approved':
      return `${base} bg-green-100 text-green-700`;
    case 'rejected':
      return `${base} bg-red-100 text-red-700`;
    case 'pending_approval':
      return `${base} bg-amber-100 text-amber-700`;
    default:
      return `${base} bg-slate-100 text-slate-700`;
  }
}

export function CancellationsTable({
  cancellations,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: CancellationsTableProps) {
  const totalItems = cancellations.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize;
  const rows = cancellations.slice(start, start + pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200 text-slate-600">
              <th className="py-3 px-4 font-semibold">Lease</th>
              <th className="py-3 px-4 font-semibold">Date</th>
              <th className="py-3 px-4 font-semibold">Reason</th>
              <th className="py-3 px-4 font-semibold">Final Payment</th>
              <th className="py-3 px-4 font-semibold">Status</th>
              <th className="py-3 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-500">
                  No cancellations found.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="py-3 px-4 text-slate-900 font-medium">{c.lease_name ?? '(deleted lease)'}</td>
                  <td className="py-3 px-4 text-slate-600">{c.cancellation_date?.split('T')[0]}</td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{c.cancellation_reason}</td>
                  <td className="py-3 px-4 text-slate-600">
                    ${Number(c.final_payment_amount).toLocaleString()}
                  </td>
                  <td className="py-3 px-4">
                    <span className={statusBadge(c.status)}>{c.status === 'pending_approval' ? 'Pending approval' : c.status}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-xs text-slate-500 px-2">—</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
