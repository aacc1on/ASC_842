import { Percent, Info, ShieldCheck, Calendar } from 'lucide-react';
import { useCompanyElections } from '../../hooks/useCompanyPolicyData';
import { todayYmd } from '../../utils/leaseLifecycle';
import { LoadError } from '../LoadError';
import { determineDiscountRate, DISCOUNT_RATE_METHOD_LABELS, type DiscountRateContext, NO_DISCOUNT_RATE_CONTEXT } from '../../utils/discountRate';
import { getApplicablePolicy } from '../../utils/policyElections';
import type { ShortTermElectionContext } from '../../hooks/useShortTermElectionContext';
import type { LeaseFormData } from './types';
import type { FixedAssetType } from '../../types/lease';

interface DiscountRateSectionProps {
  formData: LeaseFormData;
  onFieldChange: <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => void;
  companyId: string;
  fixedAssetTypes: FixedAssetType[];
  readOnly?: boolean;
  discountRateCtx?: DiscountRateContext;
  shortTermCtx?: ShortTermElectionContext;
}

const inputClass = 'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';
const readOnlyInputClass = 'w-full px-4 py-2.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed';

export function DiscountRateSection({
  formData, onFieldChange, companyId, fixedAssetTypes, readOnly, discountRateCtx = NO_DISCOUNT_RATE_CONTEXT, shortTermCtx,
}: DiscountRateSectionProps) {
  const { data: elections, error: electionsError, retry: retryElections } = useCompanyElections(companyId);
  const assetTypeId = formData.fixed_asset_type_id;
  const policyAsOf = formData.lease_start_date || todayYmd();
  const policyFor = (type: 'RISK_FREE_RATE' | 'SHORT_TERM_LEASE' | 'COMBINE_LEASE_NONLEASE') =>
    companyId && assetTypeId ? getApplicablePolicy(elections, companyId, assetTypeId, type, policyAsOf) : null;
  const rfrPolicy = policyFor('RISK_FREE_RATE');
  const policyVersion = rfrPolicy?.policy_version ?? null;
  const policyEffectiveDate = rfrPolicy?.effective_from ?? null;
  const stlElected = policyFor('SHORT_TERM_LEASE')?.election_value ?? null;
  const combineElected = policyFor('COMBINE_LEASE_NONLEASE')?.election_value ?? null;

  const { riskFreeElectionApproved: rfrApproved, entityEligibleForRiskFree: entityEligible } = discountRateCtx;

  const selected = determineDiscountRate({
    implicitRate: formData.implicit_rate !== '' ? Number(formData.implicit_rate) || null : null,
    implicitRateReadilyDeterminable: formData.implicit_rate_readily_determinable,
    riskFreeRate: formData.risk_free_rate !== '' ? Number(formData.risk_free_rate) || null : null,
    incrementalBorrowingRate: Number(formData.incremental_borrowing_rate) || 0,
    riskFreeElectionApproved: rfrApproved,
    entityEligibleForRiskFree: entityEligible,
  });

  const showRiskFreeFields = rfrApproved && entityEligible;
  const assetTypeName = fixedAssetTypes.find((t) => t.id === formData.fixed_asset_type_id)?.type_name ?? '—';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Percent className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-bold text-slate-900">Discount Rate</h3>
      </div>

      {electionsError && <LoadError message={electionsError} onRetry={retryElections} />}

      {readOnly && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
          Discount rate changes after posting must be processed as a lease modification.
        </div>
      )}

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
            className={readOnly ? readOnlyInputClass : inputClass}
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1.5">
            <input
              type="checkbox"
              checked={formData.implicit_rate_readily_determinable}
              onChange={(e) => onFieldChange('implicit_rate_readily_determinable', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              disabled={readOnly}
            />
            Rate implicit in the lease is readily determinable
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={formData.implicit_rate}
            onChange={(e) => onFieldChange('implicit_rate', e.target.value)}
            placeholder="Implicit rate (%)"
            className={readOnly ? readOnlyInputClass : inputClass}
            readOnly={readOnly}
            disabled={!formData.implicit_rate_readily_determinable && !readOnly}
          />
        </div>
      </div>

      {showRiskFreeFields && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Risk-Free Rate (%)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={formData.risk_free_rate}
              onChange={(e) => onFieldChange('risk_free_rate', e.target.value)}
              placeholder="e.g. 4"
              className={readOnly ? readOnlyInputClass : inputClass}
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className={labelClass}>Rate Source</label>
            <input
              type="text"
              value={formData.risk_free_rate_source}
              onChange={(e) => onFieldChange('risk_free_rate_source', e.target.value)}
              placeholder="e.g. US Treasury"
              className={readOnly ? readOnlyInputClass : inputClass}
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-500" />
                Rate Date
              </span>
            </label>
            <input
              type="date"
              value={formData.risk_free_rate_date}
              onChange={(e) => onFieldChange('risk_free_rate_date', e.target.value)}
              className={readOnly ? readOnlyInputClass : inputClass}
              readOnly={readOnly}
            />
          </div>
        </div>
      )}

      {/* Method line */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2">
        <Info className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="text-sm font-semibold text-slate-700" title="ASC 842 discount rate hierarchy: 1) rate implicit in the lease if readily determinable; 2) risk-free rate if elected and eligible; 3) incremental borrowing rate.">
          Discount Rate Method: {DISCOUNT_RATE_METHOD_LABELS[selected.method]} — {selected.rate.toFixed(2)}%
        </span>
      </div>

      {/* Accounting Policy Applied card */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <h4 className="text-sm font-bold text-slate-900">Accounting Policy Applied</h4>
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Asset Class</dt>
            <dd className="font-semibold text-slate-700">{assetTypeName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Short-Term Election</dt>
            <dd className="font-semibold text-slate-700">
              {shortTermCtx?.shortTermElectionApproved
                ? 'Elected'
                : stlElected === false
                  ? 'Not Elected'
                  : stlElected === true
                    ? 'Elected'
                    : 'Not configured'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Combine Lease/Nonlease</dt>
            <dd className="font-semibold text-slate-700">
              {combineElected === null ? 'Not configured' : combineElected ? 'Combined' : 'Separate'}
              
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Discount Rate Policy</dt>
            <dd className="font-semibold text-slate-700">
              {rfrApproved ? 'Risk-Free Rate' : 'Incremental Borrowing Rate'}
            </dd>
          </div>
          {policyVersion != null && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Policy Version</dt>
              <dd className="font-semibold text-slate-700">v{policyVersion}</dd>
            </div>
          )}
          {policyEffectiveDate != null && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Effective Date</dt>
              <dd className="font-semibold text-slate-700">{policyEffectiveDate}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
