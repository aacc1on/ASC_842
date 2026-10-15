import { Plus, X } from 'lucide-react';
import type { FixedAssetType } from './types';

interface AssetTypeSelectorProps {
  fixedAssetTypes: FixedAssetType[];
  selectedAssetTypeId: string;
  showNewAssetTypeForm: boolean;
  newAssetTypeName: string;
  newAssetTypeCode: string;
  onAssetTypeChange: (id: string) => void;
  onShowNewForm: (show: boolean) => void;
  onNewAssetTypeNameChange: (name: string) => void;
  onNewAssetTypeCodeChange: (code: string) => void;
  onCancelNew: () => void;
  onCreate: () => void;
}

export function AssetTypeSelector({
  fixedAssetTypes,
  selectedAssetTypeId,
  showNewAssetTypeForm,
  newAssetTypeName,
  newAssetTypeCode,
  onAssetTypeChange,
  onShowNewForm,
  onNewAssetTypeNameChange,
  onNewAssetTypeCodeChange,
  onCancelNew,
  onCreate,
}: AssetTypeSelectorProps) {
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-semibold text-slate-700 mb-2">Fixed Asset Type</label>
      {!showNewAssetTypeForm ? (
        <div className="flex gap-2">
          <select
            value={selectedAssetTypeId}
            onChange={(e) => onAssetTypeChange(e.target.value)}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">No Fixed Asset Type</option>
            {fixedAssetTypes.map(t => (
              <option key={t.id} value={t.id}>
                {t.type_name.trim()} {t.type_code ? `(${t.type_code})` : ''}
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
            <h4 className="text-sm font-bold text-green-900">Create New Fixed Asset Type</h4>
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
              <label className="block text-xs font-semibold text-green-900 mb-1">Type Name *</label>
              <input
                type="text"
                value={newAssetTypeName}
                onChange={(e) => onNewAssetTypeNameChange(e.target.value)}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
                placeholder="Vehicle"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-green-900 mb-1">Type Code</label>
              <input
                type="text"
                value={newAssetTypeCode}
                onChange={(e) => onNewAssetTypeCodeChange(e.target.value)}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
                placeholder="VEH"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition text-sm"
          >
            Create Fixed Asset Type
          </button>
        </div>
      )}
    </div>
  );
}
