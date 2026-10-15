import { Plus, Maximize2, LayoutGrid, Table as TableIcon, Columns3 } from 'lucide-react';
import type { SortOption, ViewMode } from './types';

interface SortOptionDef {
  value: SortOption;
  label: string;
}

const SORT_OPTIONS: SortOptionDef[] = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'amount_desc', label: 'Payment (high→low)' },
  { value: 'amount_asc', label: 'Payment (low→high)' },
  { value: 'start_desc', label: 'Start date (newest)' },
  { value: 'start_asc', label: 'Start date (oldest)' },
  { value: 'term_desc', label: 'Term (longest)' },
  { value: 'term_asc', label: 'Term (shortest)' },
];

interface LeaseToolbarProps {
  totalCount: number;
  sortBy: SortOption;
  onSortChange: (value: SortOption) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  canCreateEditLeases: boolean;
  onNewLease: () => void;
  onEnterFullscreen: () => void;
}

const VIEW_MODES: { value: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'cards', label: 'Cards', icon: LayoutGrid },
  { value: 'table', label: 'Table', icon: TableIcon },
  { value: 'kanban', label: 'Kanban', icon: Columns3 },
];

export function LeaseToolbar({
  totalCount,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  canCreateEditLeases,
  onNewLease,
  onEnterFullscreen,
}: LeaseToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-900" id="lease-portfolio-heading">Lease Portfolio</h2>
        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
          {totalCount} {totalCount === 1 ? 'lease' : 'leases'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sort-by" className="sr-only">Sort by</label>
        <select
          id="sort-by"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          aria-label="Sort leases"
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="inline-flex bg-slate-100 rounded-lg p-1">
          {VIEW_MODES.map((mode) => {
            const Icon = mode.icon;
            const active = viewMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => onViewModeChange(mode.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition ${
                  active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
                title={mode.label}
                aria-label={mode.label}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{mode.label}</span>
              </button>
            );
          })}
        </div>

        {viewMode === 'table' && (
          <button
            type="button"
            onClick={onEnterFullscreen}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            title="Fullscreen table"
            aria-label="Enter fullscreen table view"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}

        {canCreateEditLeases && (
          <button
            type="button"
            onClick={onNewLease}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Lease
          </button>
        )}
      </div>
    </div>
  );
}
