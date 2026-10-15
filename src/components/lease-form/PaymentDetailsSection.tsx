import { DollarSign, Calendar, Percent, Layers, Calculator, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';
import type { LeaseFormData, PaymentTrancheRow } from './types';
import { VariablePaymentsEditor } from './VariablePaymentsEditor';
import type { ComponentPolicy } from '../../utils/leaseComponents';

interface PaymentDetailsSectionProps {
  formData: LeaseFormData;
  useVariablePayments: boolean;
  paymentTranches: PaymentTrancheRow[];
  termMonths: number;
  coverage: { total: number; covered: number };
  isFullyCovered: boolean;
  hasGaps: boolean;
  onFieldChange: <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => void;
  onToggleVariablePayments: (next: boolean) => void;
  onAddTranche: () => void;
  onRemoveTranche: (id: string) => void;
  onUpdateTranche: (id: string, field: keyof PaymentTrancheRow, value: string | number) => void;
  componentPolicy: ComponentPolicy;
  componentWarning: string | null;
  onAllocateComponents: (total: number, leaseStandalone: number, nonleaseStandalone: number) => void;
}

const inputClass =
  'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';
const readOnlyClass = 'w-full px-4 py-2.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 cursor-not-allowed';

const num = (v: string | number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const POLICY_BADGE: Record<ComponentPolicy, { label: string; bg: string; text: string }> = {
  combined: { label: 'Combined', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  separate: { label: 'Separate', bg: 'bg-amber-100', text: 'text-amber-700' },
  not_applicable: { label: 'Not applicable', bg: 'bg-slate-100', text: 'text-slate-500' },
};

export function PaymentDetailsSection({
  formData,
  useVariablePayments,
  paymentTranches,
  termMonths,
  coverage,
  isFullyCovered,
  hasGaps,
  onFieldChange,
  onToggleVariablePayments,
  onAddTranche,
  onRemoveTranche,
  onUpdateTranche,
  componentPolicy,
  componentWarning,
  onAllocateComponents,
}: PaymentDetailsSectionProps) {
  const [showAllocator, setShowAllocator] = useState(false);
  const [allocTotal, setAllocTotal] = useState('');
  const [allocLeaseSP, setAllocLeaseSP] = useState('');
  const [allocNonleaseSP, setAllocNonleaseSP] = useState('');

  const leaseComp = num(formData.lease_component_amount) || num(formData.payment_amount);
  const nonleaseComp = num(formData.nonlease_component_amount);
  const totalPerPeriod = leaseComp + nonleaseComp;
  const paymentPeriods = termMonths > 0 ? termMonths : 0;
  const totalContractConsideration = totalPerPeriod * paymentPeriods;

  const badge = POLICY_BADGE[componentPolicy];

  const handleAllocate = () => {
    const total = num(allocTotal);
    const leaseSP = num(allocLeaseSP);
    const nonleaseSP = num(allocNonleaseSP);
    if (total <= 0) return;
    onAllocateComponents(total, leaseSP, nonleaseSP);
    setShowAllocator(false);
    setAllocTotal('');
    setAllocLeaseSP('');
    setAllocNonleaseSP('');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-bold text-slate-900">Payment Details</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Lease Component Amount (per period)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.lease_component_amount || formData.payment_amount}
            onChange={(e) => {
              onFieldChange('lease_component_amount', e.target.value);
              onFieldChange('payment_amount', e.target.value);
            }}
            placeholder="0.00"
            className={inputClass}
            disabled={useVariablePayments}
          />
        </div>
        <div>
          <label className={labelClass}>Nonlease Component Amount (per period)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.nonlease_component_amount}
            onChange={(e) => onFieldChange('nonlease_component_amount', e.target.value)}
            placeholder="0.00 (e.g. maintenance, CAM, services)"
            className={inputClass}
          />
        </div>
      </div>

      {/* Read-only totals + policy badge */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Total Per Period</label>
          <input
            type="text"
            value={`$${totalPerPeriod.toFixed(2)}`}
            readOnly
            className={readOnlyClass}
          />
        </div>
        <div>
          <label className={labelClass}>Total Contract Consideration</label>
          <input
            type="text"
            value={`$${totalContractConsideration.toFixed(2)}`}
            readOnly
            className={readOnlyClass}
          />
        </div>
        <div>
          <label className={labelClass}>Policy Applied</label>
          <div className={`px-4 py-2.5 rounded-lg ${badge.bg} ${badge.text} text-sm font-bold flex items-center gap-1.5`}>
            <ShieldCheck className="w-4 h-4" />
            {badge.label}
            {componentPolicy === 'combined' && (
              <span className="text-xs font-normal ml-1">Lease/nonlease practical expedient applied</span>
            )}
          </div>
        </div>
      </div>

      {componentWarning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <span className="text-sm text-amber-700">{componentWarning}</span>
        </div>
      )}

      {/* Standalone price allocator */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAllocator(!showAllocator)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          <Calculator className="w-4 h-4" />
          Allocate by standalone selling price
        </button>
        {showAllocator && (
          <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Total consideration / period</label>
                <input type="number" min={0} step="0.01" value={allocTotal} onChange={(e) => setAllocTotal(e.target.value)} placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Standalone price — lease</label>
                <input type="number" min={0} step="0.01" value={allocLeaseSP} onChange={(e) => setAllocLeaseSP(e.target.value)} placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Standalone price — nonlease</label>
                <input type="number" min={0} step="0.01" value={allocNonleaseSP} onChange={(e) => setAllocNonleaseSP(e.target.value)} placeholder="0.00" className={inputClass} />
              </div>
            </div>
            <button type="button" onClick={handleAllocate} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg">
              Allocate
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Payment Frequency</label>
          <select
            value={formData.payment_frequency}
            onChange={(e) => onFieldChange('payment_frequency', e.target.value)}
            className={inputClass}
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi_annually">Semi-Annually</option>
            <option value="annually">Annually</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-500" />
              Payment Timing
            </span>
          </label>
          <select
            value={formData.payment_timing}
            onChange={(e) => onFieldChange('payment_timing', e.target.value as LeaseFormData['payment_timing'])}
            className={inputClass}
          >
            <option value="beginning">Beginning of period (advance)</option>
            <option value="end">End of period (arrears)</option>
          </select>
        </div>
      </div>

      {/* Payment Date each month */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-500" />
              Payment Date (day of month)
            </span>
          </label>
          <select
            value={String(formData.payment_day_of_month ?? '')}
            onChange={(e) => onFieldChange('payment_day_of_month', e.target.value)}
            className={inputClass}
          >
            <option value="">No specific day</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <Percent className="w-4 h-4 text-slate-500" />
              Incremental Borrowing Rate (%)
            </span>
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.incremental_borrowing_rate}
            onChange={(e) => onFieldChange('incremental_borrowing_rate', e.target.value)}
            placeholder="e.g. 6"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Residual Value Guarantee (max)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.residual_value_guarantee}
            onChange={(e) => onFieldChange('residual_value_guarantee', e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              Amount Probable Under Guarantee
              <span className="text-slate-500 font-normal cursor-help" title="ASC 842-10-30-5(f): Only the amount probable of being owed is included in the lease liability, not the full guarantee maximum.">
                <Info className="w-3.5 h-3.5" />
              </span>
            </span>
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.rvg_probable_amount}
            onChange={(e) => onFieldChange('rvg_probable_amount', e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Asset Economic Life (months)</label>
          <input
            type="number"
            min={0}
            step="1"
            value={formData.asset_economic_life_months}
            onChange={(e) => onFieldChange('asset_economic_life_months', e.target.value)}
            placeholder="e.g. 120"
            className={inputClass}
          />
        </div>
      </div>

      <div className="pt-2 border-t border-slate-200">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useVariablePayments}
            onChange={(e) => onToggleVariablePayments(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-slate-500" />
            Variable payments (define payment tranches by month range)
          </span>
        </label>
      </div>

      {useVariablePayments && (
        <VariablePaymentsEditor
          paymentTranches={paymentTranches}
          termMonths={termMonths}
          coverage={coverage}
          isFullyCovered={isFullyCovered}
          hasGaps={hasGaps}
          onAddTranche={onAddTranche}
          onRemoveTranche={onRemoveTranche}
          onUpdateTranche={onUpdateTranche}
        />
      )}
    </div>
  );
}
