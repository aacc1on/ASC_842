import { LayoutGrid, Table2, List, Calendar, Search, Filter } from 'lucide-react';
import type { ViewMode } from './types';

interface TransactionListControlsProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  filterType: string;
  setFilterType: (value: string) => void;
  filterPeriod: string;
  setFilterPeriod: (value: string) => void;
  uniquePeriods: string[];
}

export function TransactionListControls({
  viewMode, setViewMode, searchQuery, setSearchQuery, filterType, setFilterType, filterPeriod, setFilterPeriod, uniquePeriods,
}: TransactionListControlsProps) {
  return (
    <>
    <div className="mb-6 flex items-center justify-between">
      <h2 className="text-xl font-bold text-slate-900">Detailed Transactions</h2>
      <div className="flex gap-2 bg-slate-100 rounded-lg p-1">
        <button
          onClick={() => setViewMode('grid')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-sm transition ${
            viewMode === 'grid'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          Grid
        </button>
        <button
          onClick={() => setViewMode('table')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-sm transition ${
            viewMode === 'table'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Table2 className="w-4 h-4" />
          Table
        </button>
        <button
          onClick={() => setViewMode('kanban')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-sm transition ${
            viewMode === 'kanban'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <List className="w-4 h-4" />
          Kanban
        </button>
        <button
          onClick={() => setViewMode('week')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-sm transition ${
            viewMode === 'week'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" />
          By Week
        </button>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="relative">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
        <input
          type="text"
          placeholder="Search transactions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      <div className="relative">
        <Filter className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none appearance-none"
        >
          <option value="all">All Types</option>
          <option value="payment">Payment</option>
          <option value="interest">Interest</option>
          <option value="amortization">Amortization</option>
          <option value="initial_recognition">Initial Recognition</option>
          <option value="lease_modification">Lease Modification</option>
          <option value="lease_cancellation">Lease Cancellation</option>
          <option value="impairment">Impairment</option>
          <option value="derecognition">Derecognition</option>
        </select>
      </div>

      <div className="relative">
        <Calendar className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
        <select
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
          className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none appearance-none"
        >
          <option value="all">All Periods</option>
          <option value="custom">Custom range...</option>
          {uniquePeriods.map(period => (
            <option key={period} value={period}>{period}</option>
          ))}
        </select>
      </div>
    </div>
    </>
  );
}
