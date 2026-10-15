import { useState } from 'react';
import { Building2, Plus, Pencil, Trash2, CheckCircle2, XCircle, X, Mail, Phone, MapPin } from 'lucide-react';
import type { UserRole, UserPermissions } from '../App';
import { useLessors, type Lessor, type LessorFormData } from '../hooks/useLessors';
import { Pagination } from './Pagination';

interface LessorViewProps {
  userRole: UserRole;
  permissions: UserPermissions;
}

const LESSOR_TYPES: Record<string, string> = {
  corporate: 'Corporate',
  individual: 'Individual',
  government: 'Government',
  financial_institution: 'Financial Institution',
  other: 'Other',
};

const inputClass = 'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';

export function LessorView({ userRole, permissions }: LessorViewProps) {
  const { lessors, loading, error, saving, saveLessor, toggleActive, deleteLessor, EMPTY_FORM } = useLessors();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Lessor | null>(null);
  const [form, setForm] = useState<LessorFormData>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<Lessor | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const canEdit = permissions.create_edit_leases && (userRole === 'admin' || userRole === 'manage');

  const totalPages = Math.ceil(lessors.length / pageSize);
  const paginatedLessors = lessors.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (lessor: Lessor) => {
    setEditing(lessor);
    setForm({
      lessor_name: lessor.lessor_name,
      lessor_type: lessor.lessor_type,
      contact_email: lessor.contact_email ?? '',
      contact_phone: lessor.contact_phone ?? '',
      address: lessor.address ?? '',
      is_active: lessor.is_active,
      notes: lessor.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.lessor_name.trim()) return;
    const ok = await saveLessor(form, editing?.id);
    if (ok) setShowModal(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 border border-blue-100 rounded-2xl p-5 flex items-start gap-4 mb-6">
        <div className="bg-blue-600 text-white p-3 rounded-xl shadow-sm">
          <Building2 className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">Lessors</h2>
          <p className="text-sm text-slate-600 mt-1">
            Manage your lessor master data. Track contact details and set lessors active or inactive.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add Lessor
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : lessors.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No lessors yet</p>
          <p className="text-sm text-slate-500 mt-1">
            {canEdit ? 'Click "Add Lessor" to create your first lessor record.' : 'Ask an admin to add lessors.'}
          </p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedLessors.map((lessor) => (
            <div
              key={lessor.id}
              className={`bg-white border rounded-2xl p-5 shadow-sm transition hover:shadow-md ${
                lessor.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-900 truncate">{lessor.lessor_name}</h3>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {LESSOR_TYPES[lessor.lessor_type] ?? lessor.lessor_type}
                  </span>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  lessor.is_active
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-200 text-slate-500'
                }`}>
                  {lessor.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {lessor.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-1.5 text-sm text-slate-600">
                {lessor.contact_email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{lessor.contact_email}</span>
                  </div>
                )}
                {lessor.contact_phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{lessor.contact_phone}</span>
                  </div>
                )}
                {lessor.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{lessor.address}</span>
                  </div>
                )}
              </div>

              {lessor.notes && (
                <p className="text-xs text-slate-500 mt-3 italic line-clamp-2">{lessor.notes}</p>
              )}

              {canEdit && (
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => openEdit(lessor)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(lessor.id, !lessor.is_active)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                      lessor.is_active
                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {lessor.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(lessor)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {lessors.length > pageSize && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={lessors.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[12, 24, 48, 96]}
          />
        )}
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-blue-900 text-white flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Lessor</div>
                <h3 className="text-lg font-bold mt-0.5">{editing ? 'Edit Lessor' : 'Add Lessor'}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className={labelClass}>Lessor Name *</label>
                <input
                  type="text"
                  value={form.lessor_name}
                  onChange={(e) => setForm({ ...form, lessor_name: e.target.value })}
                  placeholder="e.g. ABC Properties LLC"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>Lessor Type</label>
                <select
                  value={form.lessor_type}
                  onChange={(e) => setForm({ ...form, lessor_type: e.target.value })}
                  className={inputClass}
                >
                  <option value="corporate">Corporate</option>
                  <option value="individual">Individual</option>
                  <option value="government">Government</option>
                  <option value="financial_institution">Financial Institution</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Contact Email</label>
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                    placeholder="email@example.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Contact Phone</label>
                  <input
                    type="text"
                    value={form.contact_phone}
                    onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                    placeholder="+1 (555) 000-0000"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Street, City, State, ZIP"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Optional notes..."
                  className={inputClass}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Active
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.lessor_name.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Lessor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 p-2 rounded-lg">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Delete Lessor?</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to delete <strong>{confirmDelete.lessor_name}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={async () => {
                  await deleteLessor(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
