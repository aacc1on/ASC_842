import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Calculator, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLeaseFormData } from '../hooks/useLeaseFormData';
import { useLeaseFormState } from '../hooks/useLeaseFormState';
import { useLeaseFormActions } from '../hooks/useLeaseFormActions';
import { LoadError } from './LoadError';
import { useDiscountRateContext } from '../hooks/useDiscountRateContext';
import { useShortTermElectionContext } from '../hooks/useShortTermElectionContext';
import { determineComponentPolicy, allocateByStandalonePrice } from '../utils/leaseComponents';
import { useCombineElectionContext } from '../hooks/useCombineElectionContext';
import {
  calculateAssetFairValue,
  calculateTermMonths,
  getScheduleCoverage,
} from './lease-form/leaseFormCalculations';
import type { LeaseFormData, PaymentTrancheRow } from './lease-form/types';
import { BasicInfoSection } from './lease-form/BasicInfoSection';
import { PaymentDetailsSection } from './lease-form/PaymentDetailsSection';
import { AdditionalCostsSection } from './lease-form/AdditionalCostsSection';
import { ClassificationSection } from './lease-form/ClassificationSection';
import { DiscountRateSection } from './lease-form/DiscountRateSection';
import { PostedLockBanner } from './lease-form/PostedLockBanner';
import { qualifiesForShortTermExemption } from '../utils/shortTermLease';
import type { LeaseFormProps } from './lease-form/types';

export function LeaseForm({ onClose, onSuccess, lease, userId, selectedCompanyId, canCreateBranch = true }: LeaseFormProps) {
  const [formCompanyId, setFormCompanyId] = useState<string>(
    lease?.company_id || selectedCompanyId || ''
  );

  // Inline branch / asset type creation form state (kept local to the orchestrator
  // because it's used by both the selectors and the actions hook).
  const [showNewBranchForm, setShowNewBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');

  const [showNewAssetTypeForm, setShowNewAssetTypeForm] = useState(false);
  const [newAssetTypeName, setNewAssetTypeName] = useState('');
  const [newAssetTypeCode, setNewAssetTypeCode] = useState('');

  const [postedThrough, setPostedThrough] = useState<string | null>(null);
  useEffect(() => {
    if (!lease) return;
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_lease_posted_through', { p_lease_id: lease.id });
      if (cancelled) return;
      setPostedThrough(!rpcError && typeof data === 'string' ? data : null);
    })();
    return () => { cancelled = true; };
  }, [lease]);
  const accountingLocked = !!postedThrough;

  const {
    branches,
    fixedAssetTypes,
    companies,
    lessors,
    setBranches,
    setFixedAssetTypes,
    error: referenceDataError,
    retry: retryReferenceData,
  } = useLeaseFormData(formCompanyId);

  const {
    formData,
    setFormData,
    useVariablePayments,
    setUseVariablePayments,
    paymentTranches,
    setPaymentTranches,
    classificationResult,
    setClassificationResult,
    showClassificationWizard,
    setShowClassificationWizard,
    error,
    setError,
    leaseNameError,
    setLeaseNameError,
    loading,
    setLoading,
  } = useLeaseFormState(lease);

  const discountRateCtx = useDiscountRateContext(
    formCompanyId,
    formData.fixed_asset_type_id,
    formData.lease_start_date,
  );

  const shortTermCtx = useShortTermElectionContext(
    formCompanyId,
    formData.fixed_asset_type_id,
    formData.lease_start_date,
  );
  const combineCtx = useCombineElectionContext(formCompanyId, formData.fixed_asset_type_id, formData.lease_start_date);
  const loadFailure = referenceDataError
    ? { error: referenceDataError, retry: retryReferenceData }
    : [discountRateCtx, shortTermCtx, combineCtx].find((c) => c.error) ?? null;
  const componentPolicyResult = determineComponentPolicy({
    nonleaseAmount: Number(formData.nonlease_component_amount) || 0,
    companyId: formCompanyId,
    fixedAssetTypeId: formData.fixed_asset_type_id,
    leaseStartDate: formData.lease_start_date,
    elections: combineCtx.combineElections,
  });

  const {
    handleSubmit,
    handleCreateBranch,
    handleCreateFixedAssetType,
    runClassificationWizard,
    classifyCurrent,
    loadExistingPaymentSchedule,
  } = useLeaseFormActions({
    lease,
    userId,
    formCompanyId,
    formData,
    setFormData,
    useVariablePayments,
    setUseVariablePayments,
    paymentTranches,
    setPaymentTranches,
    classificationResult,
    setClassificationResult,
    setShowClassificationWizard,
    error,
    setError,
    leaseNameError,
    setLeaseNameError,
    loading,
    setLoading,
    branches,
    setBranches,
    fixedAssetTypes,
    setFixedAssetTypes,
    newBranchName,
    setNewBranchName,
    newBranchCode,
    setNewBranchCode,
    setShowNewBranchForm,
    newAssetTypeName,
    setNewAssetTypeName,
    newAssetTypeCode,
    setNewAssetTypeCode,
    setShowNewAssetTypeForm,
    onSuccess,
    discountRateCtx,
    shortTermCtx,
    combineCtx,
    postedThrough,
  });

  useEffect(() => {
    if (lease) {
      loadExistingPaymentSchedule(lease.id);
    }
  }, [lease, loadExistingPaymentSchedule]);

  const setField = useCallback(
    <K extends keyof LeaseFormData>(field: K, value: LeaseFormData[K]) => {
      setFormData(prev => ({ ...prev, [field]: value }));
    },
    [setFormData]
  );

  const addTranche = useCallback(() => {
    const leaseTermMonths = calculateTermMonths(formData);
    const last = paymentTranches[paymentTranches.length - 1];
    const nextFrom = last ? last.toMonth + 1 : 1;
    const nextTo = leaseTermMonths > 0 ? Math.min(nextFrom + 11, leaseTermMonths) : nextFrom + 11;
    setPaymentTranches([
      ...paymentTranches,
      { id: crypto.randomUUID(), fromMonth: nextFrom, toMonth: nextTo, paymentAmount: '' },
    ]);
  }, [formData, paymentTranches, setPaymentTranches]);

  const removeTranche = useCallback((id: string) => {
    setPaymentTranches(paymentTranches.filter(t => t.id !== id));
  }, [paymentTranches, setPaymentTranches]);

  const updateTranche = useCallback((id: string, field: keyof PaymentTrancheRow, value: string | number) => {
    setPaymentTranches(paymentTranches.map(t =>
      t.id === id ? { ...t, [field]: value } : t
    ));
  }, [paymentTranches, setPaymentTranches]);

  const handleToggleVariablePayments = useCallback((next: boolean) => {
    setUseVariablePayments(next);
    if (next && formData.payment_amount) {
      const termMonths = calculateTermMonths(formData);
      setPaymentTranches([{
        id: crypto.randomUUID(),
        fromMonth: 1,
        toMonth: termMonths > 0 ? termMonths : 12,
        paymentAmount: formData.payment_amount,
      }]);
    }
  }, [formData, setUseVariablePayments, setPaymentTranches]);

  const handleAutoCalculateFairValue = useCallback(() => {
    const calculatedValue = calculateAssetFairValue(formData, useVariablePayments, paymentTranches, discountRateCtx);
    setField('asset_fair_value', calculatedValue.toFixed(2));
  }, [formData, useVariablePayments, paymentTranches, setField, discountRateCtx]);

  const classificationCheck = useMemo(() => classifyCurrent(), [classifyCurrent]);

  const termMonths = calculateTermMonths(formData);
  const coverage = getScheduleCoverage(useVariablePayments, paymentTranches, formData);
  const isFullyCovered = useVariablePayments && coverage.total > 0 && coverage.covered >= coverage.total;
  const hasGaps = useVariablePayments && coverage.total > 0 && coverage.covered < coverage.total;

  const stlQual = qualifiesForShortTermExemption({
    leaseTermMonths: termMonths,
    purchaseOption: formData.purchase_option,
    purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
    companyId: formCompanyId,
    fixedAssetTypeId: formData.fixed_asset_type_id,
    leaseStartDate: formData.lease_start_date,
    shortTermElections: shortTermCtx.shortTermElections,
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Calculator className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              {lease ? 'Edit Lease' : 'New Lease'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close lease form" className="text-slate-500 hover:text-slate-600 transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {loadFailure?.error && <LoadError message={loadFailure.error} onRetry={loadFailure.retry} className="mb-6" />}

          {postedThrough && <PostedLockBanner postedThrough={postedThrough} />}

          {stlQual.applied && (
            <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-emerald-900 mb-1">
                    Short-Term Lease — Recognition Exemption Applied
                  </h3>
                  <p className="text-sm text-emerald-800">{stlQual.reason}</p>
                </div>
              </div>
            </div>
          )}

          {classificationResult && (
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 mb-2">
                    Classification Result: {classificationResult.classification === 'finance' ? 'Finance Lease' : 'Operating Lease'}
                  </h3>
                  <ul className="space-y-1 text-sm text-blue-800">
                    {classificationResult.reasons.map((reason, idx) => (
                      <li key={idx}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6">
            <BasicInfoSection
              companies={companies}
              formCompanyId={formCompanyId}
              onCompanyChange={setFormCompanyId}
              branches={branches}
              onBranchChange={(id) => setField('branch_id', id)}
              showNewBranchForm={showNewBranchForm}
              newBranchName={newBranchName}
              newBranchCode={newBranchCode}
              onShowNewBranchForm={canCreateBranch ? setShowNewBranchForm : () => {}}
              onNewBranchNameChange={setNewBranchName}
              onNewBranchCodeChange={setNewBranchCode}
              onCancelNewBranch={() => { setShowNewBranchForm(false); setNewBranchName(''); setNewBranchCode(''); }}
              onCreateBranch={handleCreateBranch}
              canCreateBranch={canCreateBranch}
              fixedAssetTypes={fixedAssetTypes}
              onAssetTypeChange={(id) => setField('fixed_asset_type_id', id)}
              showNewAssetTypeForm={showNewAssetTypeForm}
              newAssetTypeName={newAssetTypeName}
              newAssetTypeCode={newAssetTypeCode}
              onShowNewAssetTypeForm={setShowNewAssetTypeForm}
              onNewAssetTypeNameChange={setNewAssetTypeName}
              onNewAssetTypeCodeChange={setNewAssetTypeCode}
              onCancelNewAssetType={() => { setShowNewAssetTypeForm(false); setNewAssetTypeName(''); setNewAssetTypeCode(''); }}
              onCreateAssetType={handleCreateFixedAssetType}
              formData={formData}
              onFieldChange={setField}
              lessors={lessors}
              leaseNameError={leaseNameError}
              accountingLocked={accountingLocked}
            />

            <fieldset disabled={accountingLocked} className="accounting-locked space-y-6 min-w-0">

            <PaymentDetailsSection
              formData={formData}
              useVariablePayments={useVariablePayments}
              paymentTranches={paymentTranches}
              termMonths={termMonths}
              coverage={coverage}
              isFullyCovered={isFullyCovered}
              hasGaps={hasGaps}
              onFieldChange={setField}
              onToggleVariablePayments={handleToggleVariablePayments}
              onAddTranche={addTranche}
              onRemoveTranche={removeTranche}
              onUpdateTranche={updateTranche}
              componentPolicy={componentPolicyResult.policy}
              componentWarning={componentPolicyResult.warning}
              onAllocateComponents={(total, leaseSP, nonleaseSP) => {
                const { leaseComponent, nonleaseComponent } = allocateByStandalonePrice(total, leaseSP, nonleaseSP);
                setFormData(prev => ({ ...prev, lease_component_amount: leaseComponent.toString(), nonlease_component_amount: nonleaseComponent.toString(), payment_amount: leaseComponent.toString() }));
              }}
            />

            <DiscountRateSection
              formData={formData}
              onFieldChange={setField}
              companyId={formCompanyId}
              fixedAssetTypes={fixedAssetTypes}
              readOnly={accountingLocked}
              discountRateCtx={discountRateCtx}
              shortTermCtx={shortTermCtx}
            />

            <AdditionalCostsSection
              formData={formData}
              onFieldChange={setField}
            />

            <ClassificationSection
              formData={formData}
              showClassificationWizard={showClassificationWizard}
              onFieldChange={setField}
              onToggleWizard={setShowClassificationWizard}
              onAutoCalculateFairValue={handleAutoCalculateFairValue}
              onRunClassification={runClassificationWizard}
              check={classificationCheck}
            />
            </fieldset>
          </div>

          <div className="flex gap-3 mt-8 pt-6 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : lease ? 'Update Lease' : 'Create Lease'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
