import { AlertTriangle, HelpCircle } from 'lucide-react';
import type { LeaseFormData } from './types';
import {
  calculateTermMonths,
  financeClassificationIssues,
  FINANCE_INPUTS_REQUIRED_MESSAGE,
  NO_FINANCE_CRITERIA_MESSAGE,
  type ClassificationCheck,
} from './leaseFormCalculations';

const num = (v: string | number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

interface ClassificationSectionProps {
  formData: LeaseFormData;
  showClassificationWizard: boolean;
  onFieldChange: <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => void;
  onToggleWizard: (show: boolean) => void;
  onAutoCalculateFairValue: () => void;
  onRunClassification: () => void;
  check: Pick<ClassificationCheck, 'tests' | 'presentValue'>;
}

export function ClassificationSection({
  formData,
  showClassificationWizard,
  onFieldChange,
  onToggleWizard,
  onAutoCalculateFairValue,
  onRunClassification,
  check,
}: ClassificationSectionProps) {
  const leaseTerm = calculateTermMonths(formData);
  const assetFV = num(formData.asset_market_value);
  const fvPct = assetFV > 0 && check.presentValue > 0 ? (check.presentValue / assetFV) * 100 : null;
  const issues = financeClassificationIssues(formData, check);
  const econLifeMonths = num(formData.asset_economic_life_months);
  const econPct = econLifeMonths > 0 ? (leaseTerm / econLifeMonths) * 100 : null;
  const fvMet = fvPct !== null && fvPct >= 90;
  const econMet = econPct !== null && econPct >= 75;

  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-900">Classification</h3>
        <button
          type="button"
          onClick={() => onToggleWizard(!showClassificationWizard)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
        >
          <HelpCircle className="w-4 h-4" />
          Classification Wizard
        </button>
      </div>

      {showClassificationWizard && (
        <div className="space-y-4 mb-4 bg-white rounded-lg p-4 border border-slate-300">
          <p className="text-sm text-slate-600 font-medium">
            Answer these questions to determine if this is an operating or finance lease per ASC 842:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-slate-700">Lease Fair Value</label>
                <button
                  type="button"
                  onClick={onAutoCalculateFairValue}
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                >
                  Auto-Calculate
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-4 top-2 text-slate-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.asset_fair_value}
                  onChange={(e) => onFieldChange('asset_fair_value', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">Leave at 0 to skip the fair value test, or enter the asset's independent market value</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Asset Fair Value{formData.lease_classification === 'finance' && <span className="text-orange-600"> *</span>}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-2 text-slate-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.asset_market_value}
                  onChange={(e) => onFieldChange('asset_market_value', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Asset Economic Life (Months){formData.lease_classification === 'finance' && <span className="text-orange-600"> *</span>}
              </label>
              <input
                type="number"
                min={0}
                step="1"
                value={formData.asset_economic_life_months}
                onChange={(e) => onFieldChange('asset_economic_life_months', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                placeholder="120"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={fvPct !== null ? fvMet : false}
                readOnly
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-default"
              />
              <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                Is PV of Lease Payments &ge; 90% of Asset Fair Value?
                {fvPct !== null ? (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${fvMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {fvPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Enter asset fair value and payments</span>
                )}
                {check.presentValue > 0 && (
                  <span className="text-xs text-slate-500 tabular-nums">
                    PV ${check.presentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={econPct !== null ? econMet : false}
                readOnly
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-default"
              />
              <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                Is Lease Term &ge; 75% of Asset Economic Life?
                {econPct !== null ? (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${econMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {econPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Enter lease term &amp; economic life</span>
                )}
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.transfer_ownership}
                onChange={(e) => onFieldChange('transfer_ownership', e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Lease transfers ownership to lessee at end of term
              </span>
            </label>

            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.purchase_option}
                  onChange={(e) => onFieldChange('purchase_option', e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-700">Lessee has purchase option</span>
              </label>

              {formData.purchase_option && (
                <div className="ml-8 space-y-3">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Purchase Option Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1.5 text-slate-500 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.purchase_option_price}
                      onChange={(e) => onFieldChange('purchase_option_price', e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.purchase_option_reasonably_certain}
                      onChange={(e) => onFieldChange('purchase_option_reasonably_certain', e.target.checked)}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                      Reasonably certain to exercise
                      <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                    </span>
                  </label>
                  {formData.purchase_option_reasonably_certain && (
                    <p className="text-xs text-blue-600">When reasonably certain, the purchase price is included in the lease liability and the lease is classified as finance.</p>
                  )}
                </div>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.specialized_asset}
                onChange={(e) => onFieldChange('specialized_asset', e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Asset is specialized with no alternative use to lessor
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Prepaid Lease Payments</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.prepaid_lease_payments}
                  onChange={(e) => onFieldChange('prepaid_lease_payments', e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="0.00"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Paid at or before commencement; increases ROU asset</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Renewal Months (Reasonably Certain)</label>
              <input
                type="number"
                step="1"
                value={formData.renewal_months_reasonably_certain}
                onChange={(e) => onFieldChange('renewal_months_reasonably_certain', e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Renewal Payment Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.renewal_payment_amount}
                  onChange={(e) => onFieldChange('renewal_payment_amount', e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="Defaults to base payment"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Termination Option Month</label>
              <input
                type="number"
                step="1"
                value={formData.termination_option_month}
                onChange={(e) => onFieldChange('termination_option_month', e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g. 24"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Termination Penalty Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.termination_penalty_amount}
                  onChange={(e) => onFieldChange('termination_penalty_amount', e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="0.00"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.termination_option_reasonably_certain}
                onChange={(e) => onFieldChange('termination_option_reasonably_certain', e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Termination option reasonably certain to be exercised</span>
            </label>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              <strong>Noncancellable term:</strong> {leaseTerm} months
              {Number(formData.renewal_months_reasonably_certain) > 0 && (
                <span> + {formData.renewal_months_reasonably_certain} renewal = <strong>{leaseTerm} months accounting lease term</strong></span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onRunClassification}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition text-sm"
          >
            Determine Classification
          </button>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Lease Classification</label>
        <select
          value={formData.lease_classification}
          onChange={(e) => {
            onFieldChange('lease_classification', e.target.value as LeaseFormData['lease_classification']);
            onFieldChange('auto_classified', false);
          }}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="operating">Operating Lease</option>
          <option value="finance">Finance Lease</option>
        </select>
        {formData.auto_classified && (
          <p className="text-xs text-green-600 mt-1">Auto-classified using ASC 842 criteria</p>
        )}
        {issues.missingInputs && (
          <div className="mt-3 flex gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p>{FINANCE_INPUTS_REQUIRED_MESSAGE}</p>
              {!showClassificationWizard && (
                <button
                  type="button"
                  onClick={() => onToggleWizard(true)}
                  className="mt-1 text-xs font-semibold text-orange-700 underline hover:text-orange-900"
                >
                  Enter fair value and useful life
                </button>
              )}
            </div>
          </div>
        )}
        {issues.noneMet && (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 space-y-2">
            <div className="flex gap-3">
              <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
              <p className="text-sm text-orange-800">{NO_FINANCE_CRITERIA_MESSAGE}</p>
            </div>
            <label className="block text-xs font-semibold text-orange-900" htmlFor="classification-override-reason">
              Override reason (required to keep Finance)
            </label>
            <textarea
              id="classification-override-reason"
              rows={2}
              value={formData.classification_override_reason}
              onChange={(e) => onFieldChange('classification_override_reason', e.target.value)}
              className="w-full px-3 py-2 border border-orange-200 bg-white rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
              placeholder="Explain why this lease is classified as Finance"
            />
          </div>
        )}
      </div>
    </div>
  );
}
