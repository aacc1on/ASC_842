import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Pagination } from '../Pagination';
import type { ModificationRow } from './types';

interface ModificationsTableProps {
  modifications: ModificationRow[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onView: (m: ModificationRow) => void;
  onEdit: (m: ModificationRow) => void;
  onDelete: (id: string) => void;
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

export function ModificationsTable({
  modifications,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onView,
  onEdit,
  onDelete,
}: ModificationsTableProps) {
  const totalItems = modifications.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize;
  const rows = modifications.slice(start, start + pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200 text-slate-600">
              <th className="py-3 px-4 font-semibold">Lease</th>
              <th className="py-3 px-4 font-semibold">Date</th>
              <th className="py-3 px-4 font-semibold">Type</th>
              <th className="py-3 px-4 font-semibold">Reason</th>
              <th className="py-3 px-4 font-semibold">New Payment</th>
              <th className="py-3 px-4 font-semibold">New Term</th>
              <th className="py-3 px-4 font-semibold">Status</th>
              <th className="py-3 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  No modifications found.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="py-3 px-4 text-slate-900 font-medium">{m.lease_name ?? '(deleted lease)'}</td>
                  <td className="py-3 px-4 text-slate-600">{m.modification_date?.split('T')[0]}</td>
                  <td className="py-3 px-4 text-slate-600 capitalize">
                    {m.modification_type?.replace(/_/g, ' ')}
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{m.reason}</td>
                  <td className="py-3 px-4 text-slate-600">${Number(m.new_monthly_payment).toLocaleString()}</td>
                  <td className="py-3 px-4 text-slate-600">{m.new_lease_term} mo</td>
                  <td className="py-3 px-4">
                    <span className={statusBadge(m.status)}>{m.status === 'pending_approval' ? 'Pending approval' : m.status}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onView(m)}
                        title="View"
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onEdit(m)}
                        title="Edit"
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!m.accounting_posted && (
                        <button
                          onClick={() => onDelete(m.id)}
                          title="Delete"
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
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
