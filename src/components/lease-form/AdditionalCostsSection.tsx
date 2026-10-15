import { Coins, Gift } from 'lucide-react';
import type { LeaseFormData } from './types';

interface AdditionalCostsSectionProps {
  formData: LeaseFormData;
  onFieldChange: <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => void;
}

const inputClass =
  'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';

export function AdditionalCostsSection({ formData, onFieldChange }: AdditionalCostsSectionProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Coins className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-bold text-slate-900">Additional Costs</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Initial Direct Costs</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.initial_direct_costs}
            onChange={(e) => onFieldChange('initial_direct_costs', e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-1">Added to the ROU asset.</p>
        </div>
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-slate-500" />
              Lease Incentives
            </span>
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.lease_incentives}
            onChange={(e) => onFieldChange('lease_incentives', e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-1">Deducted from the ROU asset.</p>
        </div>
      </div>
    </div>
  );
}
