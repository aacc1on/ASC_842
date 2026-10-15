import { Plus, X } from 'lucide-react';
import type { Branch } from './types';

interface BranchSelectorProps {
  branches: Branch[];
  selectedBranchId: string;
  showNewBranchForm: boolean;
  newBranchName: string;
  newBranchCode: string;
  onBranchChange: (id: string) => void;
  onShowNewForm: (show: boolean) => void;
  onNewBranchNameChange: (name: string) => void;
  onNewBranchCodeChange: (code: string) => void;
  onCancelNew: () => void;
  onCreate: () => void;
}

export function BranchSelector({
  branches,
  selectedBranchId,
  showNewBranchForm,
  newBranchName,
  newBranchCode,
  onBranchChange,
  onShowNewForm,
  onNewBranchNameChange,
  onNewBranchCodeChange,
  onCancelNew,
  onCreate,
}: BranchSelectorProps) {
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-semibold text-slate-700 mb-2">Branch</label>
      {!showNewBranchForm ? (
        <div className="flex gap-2">
          <select
            value={selectedBranchId}
            onChange={(e) => onBranchChange(e.target.value)}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">No Branch</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name} {branch.branch_code ? `(${branch.branch_code})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onShowNewForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>
      ) : (
        <div className="space-y-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-green-900">Create New Branch</h4>
            <button
              type="button"
              onClick={onCancelNew}
              className="text-green-600 hover:text-green-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-green-900 mb-1">Branch Name *</label>
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => onNewBranchNameChange(e.target.value)}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
                placeholder="Main Office"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-green-900 mb-1">Branch Code</label>
              <input
                type="text"
                value={newBranchCode}
                onChange={(e) => onNewBranchCodeChange(e.target.value)}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
                placeholder="HQ-001"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition text-sm"
          >
            Create Branch
          </button>
        </div>
      )}
    </div>
  );
}
