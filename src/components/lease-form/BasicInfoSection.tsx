import { useState } from 'react';
import { Building2, GitBranch, Tag, Plus, User } from 'lucide-react';
import type { Company, FixedAssetType } from '../../types/lease';
import type { LeaseFormData } from './types';
import type { Lessor } from '../../hooks/useLessors';

interface BranchOption {
  id: string;
  branch_name: string;
  branch_code: string | null;
}

interface BasicInfoSectionProps {
  companies: Company[];
  formCompanyId: string;
  onCompanyChange: (id: string) => void;
  branches: BranchOption[];
  onBranchChange: (id: string) => void;
  showNewBranchForm: boolean;
  newBranchName: string;
  newBranchCode: string;
  onShowNewBranchForm: (show: boolean) => void;
  onNewBranchNameChange: (name: string) => void;
  onNewBranchCodeChange: (code: string) => void;
  onCancelNewBranch: () => void;
  onCreateBranch: () => void;
  canCreateBranch?: boolean;
  fixedAssetTypes: FixedAssetType[];
  onAssetTypeChange: (id: string) => void;
  showNewAssetTypeForm: boolean;
  newAssetTypeName: string;
  newAssetTypeCode: string;
  onShowNewAssetTypeForm: (show: boolean) => void;
  onNewAssetTypeNameChange: (name: string) => void;
  onNewAssetTypeCodeChange: (code: string) => void;
  onCancelNewAssetType: () => void;
  onCreateAssetType: () => void;
  formData: LeaseFormData;
  onFieldChange: <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => void;
  lessors: Lessor[];
  leaseNameError?: string;
  accountingLocked?: boolean;
}

const inputClass =
  'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';

export function BasicInfoSection({
  companies,
  formCompanyId,
  onCompanyChange,
  branches,
  onBranchChange,
  showNewBranchForm,
  newBranchName,
  newBranchCode,
  onShowNewBranchForm,
  onNewBranchNameChange,
  onNewBranchCodeChange,
  onCancelNewBranch,
  onCreateBranch,
  canCreateBranch = true,
  fixedAssetTypes,
  onAssetTypeChange,
  showNewAssetTypeForm,
  newAssetTypeName,
  newAssetTypeCode,
  onShowNewAssetTypeForm,
  onNewAssetTypeNameChange,
  onNewAssetTypeCodeChange,
  onCancelNewAssetType,
  onCreateAssetType,
  formData,
  onFieldChange,
  lessors,
  leaseNameError,
  accountingLocked = false,
}: BasicInfoSectionProps) {
  const [showNewLessor, setShowNewLessor] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-bold text-slate-900">Basic Information</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Company</label>
          <select
            value={formCompanyId}
            onChange={(e) => onCompanyChange(e.target.value)}
            disabled={accountingLocked}
            className={inputClass}
          >
            <option value="">Select company...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Branch</label>
          <div className="flex gap-2">
            <select
              value={formData.branch_id}
              onChange={(e) => onBranchChange(e.target.value)}
              className={inputClass}
            >
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                  {b.branch_code ? ` (${b.branch_code})` : ''}
                </option>
              ))}
            </select>
            {canCreateBranch && (
              <button
                type="button"
                onClick={() => onShowNewBranchForm(!showNewBranchForm)}
                className="px-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition flex items-center justify-center"
                title="Add branch"
              >
                <Plus className="w-4 h-4 text-slate-600" />
              </button>
            )}
          </div>
          {canCreateBranch && showNewBranchForm && (
            <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <input
                type="text"
                placeholder="Branch name"
                value={newBranchName}
                onChange={(e) => onNewBranchNameChange(e.target.value)}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Branch code"
                value={newBranchCode}
                onChange={(e) => onNewBranchCodeChange(e.target.value)}
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCreateBranch}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
                >
                  Save Branch
                </button>
                <button
                  type="button"
                  onClick={onCancelNewBranch}
                  className="px-3 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>Fixed Asset Type</label>
        <div className="flex gap-2">
          <select
            value={formData.fixed_asset_type_id}
            onChange={(e) => onAssetTypeChange(e.target.value)}
            disabled={accountingLocked}
            className={inputClass}
          >
            <option value="">Select asset type...</option>
            {fixedAssetTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.type_name}
                {t.type_code ? ` (${t.type_code})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onShowNewAssetTypeForm(!showNewAssetTypeForm)}
            disabled={accountingLocked}
            className="px-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition flex items-center justify-center"
            title="Add asset type"
          >
            <Tag className="w-4 h-4 text-slate-600" />
          </button>
        </div>
        {showNewAssetTypeForm && (
          <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <input
              type="text"
              placeholder="Asset type name"
              value={newAssetTypeName}
              onChange={(e) => onNewAssetTypeNameChange(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Asset type code"
              value={newAssetTypeCode}
              onChange={(e) => onNewAssetTypeCodeChange(e.target.value)}
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCreateAssetType}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
              >
                Save Type
              </button>
              <button
                type="button"
                onClick={onCancelNewAssetType}
                className="px-3 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-100 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Lease Name</label>
        <input
          type="text"
          value={formData.lease_name}
          onChange={(e) => onFieldChange('lease_name', e.target.value)}
          placeholder="e.g. Office Building Lease"
          className={inputClass}
        />
        {leaseNameError && (
          <p className="mt-1.5 text-sm text-red-600">{leaseNameError}</p>
        )}
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={formData.lease_description}
          onChange={(e) => onFieldChange('lease_description', e.target.value)}
          placeholder="Optional description..."
          rows={2}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <User className="w-4 h-4 text-slate-500" />
              Lessor Name
            </span>
          </label>
          {!showNewLessor ? (
            <div className="flex gap-2">
              <select
                value={lessors.some(l => l.lessor_name === formData.lessor_name) ? formData.lessor_name : ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewLessor(true);
                    onFieldChange('lessor_name', '');
                  } else {
                    const selected = lessors.find(l => l.lessor_name === e.target.value);
                    onFieldChange('lessor_name', e.target.value);
                    if (selected) onFieldChange('lessor_type', selected.lessor_type as LeaseFormData['lessor_type']);
                  }
                }}
                className={inputClass}
              >
                <option value="">Select lessor...</option>
                {lessors.map((l) => (
                  <option key={l.id} value={l.lessor_name}>
                    {l.lessor_name}
                  </option>
                ))}
                <option value="__new__">+ Add new lessor...</option>
              </select>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.lessor_name}
                onChange={(e) => onFieldChange('lessor_name', e.target.value)}
                placeholder="Enter lessor name"
                className={inputClass}
                autoFocus
              />
              <button
                type="button"
                onClick={() => { setShowNewLessor(false); onFieldChange('lessor_name', ''); }}
                className="px-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm font-semibold text-slate-600"
                title="Back to list"
              >
                List
              </button>
            </div>
          )}
        </div>
        <div>
          <label className={labelClass}>Lessor Type</label>
          <select
            value={formData.lessor_type}
            onChange={(e) => onFieldChange('lessor_type', e.target.value as LeaseFormData['lessor_type'])}
            className={inputClass}
          >
            <option value="corporate">Corporate</option>
            <option value="individual">Individual</option>
            <option value="government">Government</option>
            <option value="financial_institution">Financial Institution</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Related Party */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Related Party</label>
          <select
            value={formData.related_party ? 'yes' : 'no'}
            onChange={(e) => onFieldChange('related_party', e.target.value === 'yes')}
            className={inputClass}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
        {formData.related_party && (
          <div>
            <label className={labelClass}>Related Party Name</label>
            <input
              type="text"
              value={formData.related_party_name}
              onChange={(e) => onFieldChange('related_party_name', e.target.value)}
              placeholder="Name of the related party"
              className={inputClass}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Start Date</label>
          <input
            type="date"
            value={formData.lease_start_date}
            onChange={(e) => onFieldChange('lease_start_date', e.target.value)}
            disabled={accountingLocked}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>End Date</label>
          <input
            type="date"
            value={formData.lease_end_date}
            onChange={(e) => onFieldChange('lease_end_date', e.target.value)}
            disabled={accountingLocked}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Term (months)</label>
          <input
            type="number"
            min={0}
            value={formData.lease_term_months}
            onChange={(e) => onFieldChange('lease_term_months', e.target.value)}
            disabled={accountingLocked}
            placeholder="Auto from dates"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <GitBranch className="w-3.5 h-3.5" />
        Leave term blank to auto-calculate from the start/end dates.
      </div>
    </div>
  );
}
