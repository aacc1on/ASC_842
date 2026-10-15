import { type Lease, type LeaseReport } from '../../../types/lease';
import { Table as TableIcon, LayoutGrid } from 'lucide-react';

import { type PortfolioViewState } from '../../../utils/reports/portfolio';
import { PortfolioKanban } from './PortfolioKanban';
import { PortfolioLeaseTable } from './PortfolioLeaseTable';
import { PortfolioStats } from './PortfolioStats';

export function PortfolioOverview({ report, leases, view, onViewChange }: { report: LeaseReport; leases: Lease[]; view: PortfolioViewState; onViewChange: (v: PortfolioViewState) => void }) {
  return (
    <>
        <PortfolioStats report={report} />

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Lease Details by Classification</h3>
              <p className="text-sm text-slate-500 mt-0.5">{leases.length.toLocaleString()} leases</p>
            </div>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden shadow-sm">
              <button
                onClick={() => onViewChange({ ...view, mode: 'table' })}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold transition-colors ${view.mode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                title="Table view"
              >
                <TableIcon className="w-4 h-4" />
                Table
              </button>
              <button
                onClick={() => onViewChange({ ...view, mode: 'kanban' })}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold transition-colors ${view.mode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                title="Kanban view by lease type"
              >
                <LayoutGrid className="w-4 h-4" />
                Kanban
              </button>
            </div>
          </div>


          {view.mode === 'table' ? (
            <PortfolioLeaseTable leases={leases} view={view} onViewChange={onViewChange} />
          ) : (
            <PortfolioKanban leases={leases} />
          )}
        </div>
    </>
  );
}
