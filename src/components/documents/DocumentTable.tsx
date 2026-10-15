import { Download, Trash2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Document } from './types';

interface DocumentTableProps {
  paginatedDocuments: Document[];
  filteredDocumentsCount: number;
  searchQuery: string;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  canUploadDocuments: boolean;
  onDownload: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(dateString: string): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const pageSizeOptions = [10, 25, 50];

export function DocumentTable({
  paginatedDocuments,
  filteredDocumentsCount,
  searchQuery,
  currentPage,
  totalPages,
  pageSize,
  canUploadDocuments,
  onDownload,
  onDelete,
  onPageChange,
  onPageSizeChange,
}: DocumentTableProps) {
  if (paginatedDocuments.length === 0) {
    return (
      <div className="text-center py-16 border border-slate-200 rounded-xl bg-slate-50">
        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-700 mb-1">No documents found</h3>
        <p className="text-sm text-slate-500">
          {searchQuery
            ? 'Try a different search term.'
            : canUploadDocuments
              ? 'Upload your first document to get started.'
              : 'No documents have been uploaded yet.'}
        </p>
      </div>
    );
  }

  const fromItem = (currentPage - 1) * pageSize + 1;
  const toItem = Math.min(currentPage * pageSize, filteredDocumentsCount);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Category</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Description</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase">Size</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 uppercase">Uploaded</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-slate-700 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {paginatedDocuments.map((doc, index) => (
              <tr key={doc.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-900 truncate max-w-[16rem]">
                      {doc.file_name}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 uppercase">{doc.file_type || '—'}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                    {doc.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-[18rem] truncate">
                  {doc.description || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right whitespace-nowrap">
                  {formatFileSize(doc.file_size)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                  {formatDate(doc.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => onDownload(doc)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {canUploadDocuments && (
                      <button
                        onClick={() => onDelete(doc)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredDocumentsCount > pageSize && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {fromItem}–{toItem} of {filteredDocumentsCount}
            </span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(parseInt(e.target.value))}
              className="px-2 py-1 border border-slate-300 rounded text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} / page
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600 px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
