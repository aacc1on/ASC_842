import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  calculateTermMonths,
  calculateSubmittedLeaseMetrics,
  runClassification,
  getBasePaymentAmount,
  getSelectedDiscountRate,
  financeClassificationIssues,
  calculateNoncancellableTermMonths,
  FINANCE_INPUTS_REQUIRED_MESSAGE,
  NO_FINANCE_CRITERIA_MESSAGE,
  type ClassificationCheck,
} from '../components/lease-form/leaseFormCalculations';
import { isDuplicateNameError, DUPLICATE_NAME_MESSAGE, toUserMessage } from '../utils/errors';
import { reportCriticalError } from '../utils/errorReporter';
import { qualifiesForShortTermExemption } from '../utils/shortTermLease';
import { determineComponentPolicy, measurementPaymentPerPeriod, type ComponentPolicy } from '../utils/leaseComponents';
import {
  buildAmortizationRows,
  buildDescriptiveLeasePayload,
  buildLeasePayload,
  buildPaymentScheduleRows,
  buildRecognitionRows,
  computeSubmittedShortTermCost,
  num,
  toLeaseSaveErrorMessage,
  tranchesToRows,
} from '../utils/leaseSaveRows';
import { useLeaseFormLookupActions } from './useLeaseFormLookupActions';
import type { UseLeaseFormActionsArgs, UseLeaseFormActionsResult } from './leaseFormActionTypes';
import { currentOrgId } from '../utils/currentOrg';

export type { BranchOption, UseLeaseFormActionsArgs, UseLeaseFormActionsResult } from './leaseFormActionTypes';
export { POSTED_LEASE_MESSAGE, buildDescriptiveLeasePayload, toLeaseSaveErrorMessage } from '../utils/leaseSaveRows';

/** Lease form mutations: create/update submit, the classification wizard and loading an existing variable schedule. */
export function useLeaseFormActions(args: UseLeaseFormActionsArgs): UseLeaseFormActionsResult {
  const {
    lease,
    userId,
    formCompanyId,
    formData,
    setFormData,
    useVariablePayments,
    setUseVariablePayments,
    paymentTranches,
    setPaymentTranches,
    setClassificationResult,
    setShowClassificationWizard,
    setError,
    setLeaseNameError,
    setLoading,
    onSuccess,
    discountRateCtx,
    shortTermCtx,
    combineCtx,
    postedThrough,
  } = args;

  const loadExistingPaymentSchedule = useCallback(async (leaseId: string) => {
    let data: { id: string; from_month: number; to_month: number; payment_amount: number }[] | null;
    try {
      const orgId = await currentOrgId();
      const res = await supabase
        .from('lease_payment_schedules')
        .select('id, from_month, to_month, payment_amount')
        .eq('organization_id', orgId)
        .eq('lease_id', leaseId)
        .order('from_month', { ascending: true });
      if (res.error) throw res.error;
      data = res.data;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load the payment schedule for this lease.'));
      return;
    }
    if (!data || data.length === 0) return;

    setUseVariablePayments(true);
    setPaymentTranches(tranchesToRows(data));
  }, [setPaymentTranches, setUseVariablePayments, setError]);

  const classifyCurrent = useCallback((): ClassificationCheck => {
    const clsNonleaseAmt = num(formData.nonlease_component_amount);
    const clsLeaseComp = num(formData.lease_component_amount) || num(formData.payment_amount);
    const clsPolicyResult = determineComponentPolicy({
      nonleaseAmount: clsNonleaseAmt,
      companyId: formCompanyId,
      fixedAssetTypeId: formData.fixed_asset_type_id,
      leaseStartDate: formData.lease_start_date,
      elections: combineCtx.combineElections,
    });
    const clsMeasurementPayment = measurementPaymentPerPeriod(clsLeaseComp, clsNonleaseAmt, clsPolicyResult.policy);
    const clsMeasurementTranches = useVariablePayments && paymentTranches.length > 0
      ? paymentTranches.map((t) => ({
          ...t,
          paymentAmount: clsPolicyResult.policy === 'combined'
            ? num(t.paymentAmount) + clsNonleaseAmt
            : num(t.paymentAmount),
        }))
      : paymentTranches;
    const clsFormData = { ...formData, payment_amount: clsMeasurementPayment };
    return runClassification(clsFormData, useVariablePayments, clsMeasurementTranches, discountRateCtx);
  }, [formData, useVariablePayments, paymentTranches, discountRateCtx, combineCtx.combineElections, formCompanyId]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      if (!formCompanyId) {
        setError('Please select a company.');
        return;
      }
      if (!formData.fixed_asset_type_id) {
        setError('Select an asset class (Fixed Asset Type) before saving.');
        return;
      }
      if (!formData.lease_name.trim()) {
        setError('Lease name is required.');
        return;
      }
      setLeaseNameError('');
      if (!formData.lessor_name.trim()) {
        setError('Lessor name is required.');
        return;
      }

      if (lease && postedThrough) {
        setLoading(true);
        try {
          const { error: rpcError } = await supabase.rpc('save_lease', {
            p_lease: buildDescriptiveLeasePayload(lease.id, formData),
            p_payment_schedule: [],
            p_amortization: [],
            p_recognition: [],
          });
          if (rpcError) throw rpcError;
          onSuccess();
        } catch (err) {
          reportCriticalError(supabase, 'save_lease', err);
          setError(isDuplicateNameError(err) ? DUPLICATE_NAME_MESSAGE : toLeaseSaveErrorMessage(err));
        } finally {
          setLoading(false);
        }
        return;
      }
      if (!formData.lease_start_date || !formData.lease_end_date) {
        setError('Lease start and end dates are required.');
        return;
      }
      if (new Date(formData.lease_end_date) < new Date(formData.lease_start_date)) {
        setError('Lease end date must be after the start date.');
        return;
      }

      const termMonths = calculateTermMonths(formData);
      if (termMonths <= 0) {
        setError('Lease term must be greater than zero.');
        return;
      }

      const noncancellable = calculateNoncancellableTermMonths(formData);
      const [sdY, sdM, sdD] = String(formData.lease_start_date).split('T')[0].split('-').map(Number);
      const startDate = new Date(sdY, (sdM || 1) - 1, sdD || 1);
      const accountingEndDate = new Date(startDate.getFullYear(), startDate.getMonth() + termMonths, startDate.getDate());
      const accountingEndDateStr = `${accountingEndDate.getFullYear()}-${String(accountingEndDate.getMonth() + 1).padStart(2, '0')}-${String(accountingEndDate.getDate()).padStart(2, '0')}`;
      const overrideEndDate =
        termMonths !== noncancellable || formData.termination_option_reasonably_certain
          ? accountingEndDateStr
          : formData.lease_end_date;

      const stlQual = qualifiesForShortTermExemption({
        leaseTermMonths: termMonths,
        purchaseOption: formData.purchase_option,
        purchaseOptionReasonablyCertain: formData.purchase_option_reasonably_certain,
        companyId: formCompanyId,
        fixedAssetTypeId: formData.fixed_asset_type_id,
        leaseStartDate: formData.lease_start_date,
        shortTermElections: shortTermCtx.shortTermElections,
      });

      const isShortTermExempt = stlQual.applied;

      const nonleaseAmount = num(formData.nonlease_component_amount);
      const leaseComponentAmount = num(formData.lease_component_amount) || num(formData.payment_amount);
      const componentPolicyResult = determineComponentPolicy({
        nonleaseAmount,
        companyId: formCompanyId,
        fixedAssetTypeId: formData.fixed_asset_type_id,
        leaseStartDate: formData.lease_start_date,
        elections: combineCtx.combineElections,
      });
      const componentPolicy: ComponentPolicy = componentPolicyResult.policy;
      const measurementPayment = measurementPaymentPerPeriod(leaseComponentAmount, nonleaseAmount, componentPolicy);
      if (measurementPayment <= 0 && !isShortTermExempt) {
        setError('Payment amount must be greater than zero for a recognized lease.');
        return;
      }

      const financeIssues = isShortTermExempt
        ? { missingInputs: false, noneMet: false }
        : financeClassificationIssues(formData, classifyCurrent());
      if (financeIssues.missingInputs) {
        setError(FINANCE_INPUTS_REQUIRED_MESSAGE);
        return;
      }
      const overrideReason = formData.classification_override_reason.trim();
      if (financeIssues.noneMet && !overrideReason) {
        setError(`${NO_FINANCE_CRITERIA_MESSAGE} Enter an override reason to keep Finance.`);
        return;
      }

      if (!lease) {
        let orgId: string;
        try {
          orgId = await currentOrgId();
        } catch (err) {
          setError(toLeaseSaveErrorMessage(err));
          return;
        }
        const { data: existing } = await supabase
          .from('leases')
          .select('id')
          .eq('organization_id', orgId)
          .eq('company_id', formCompanyId)
          .ilike('lease_name', formData.lease_name.trim())
          .eq('status', 'active')
          .limit(1);
        if (existing && existing.length > 0) {
          setLeaseNameError(DUPLICATE_NAME_MESSAGE);
          return;
        }
      }

      setLoading(true);

      try {
        const selectedRate = getSelectedDiscountRate(formData, discountRateCtx);
        const measurementFormData = { ...formData, payment_amount: measurementPayment };

        const measurementTranches = useVariablePayments && paymentTranches.length > 0
          ? paymentTranches.map((t) => ({
              ...t,
              paymentAmount: componentPolicy === 'combined'
                ? num(t.paymentAmount) + nonleaseAmount
                : num(t.paymentAmount),
            }))
          : paymentTranches;

        const metrics = isShortTermExempt
          ? { leaseLiability: 0, rouAsset: 0, presentValueOfPayments: 0 }
          : calculateSubmittedLeaseMetrics(measurementFormData, useVariablePayments, measurementTranches, discountRateCtx);

        const shortTermCost = isShortTermExempt
          ? computeSubmittedShortTermCost(formData, termMonths, measurementPayment, useVariablePayments, measurementTranches)
          : 0;

        const leasePayload = buildLeasePayload({
          userId,
          formCompanyId,
          formData,
          discountRateCtx,
          overrideEndDate,
          termMonths,
          measurementPayment,
          selectedRate,
          isShortTermExempt,
          shortTermPolicyElectionId: stlQual.policyElectionId,
          leaseComponentAmount,
          nonleaseAmount,
          componentPolicy,
          componentPolicyElectionId: componentPolicyResult.policyElectionId,
          metrics,
        });

        // For edits, include the lease id so the server function updates
        if (lease) {
          leasePayload.id = lease.id;
        }

        // Compute all child rows in TypeScript
        const effectiveTranches = useVariablePayments ? measurementTranches : paymentTranches;
        const paymentScheduleRows = buildPaymentScheduleRows(useVariablePayments, effectiveTranches);
        const amortizationRows = buildAmortizationRows({
          formData,
          useVariablePayments,
          discountRateCtx,
          isShortTermExempt,
          shortTermCost,
          measurementPayment,
          effectiveTranches,
        });
        const recognitionRows = buildRecognitionRows(
          formData,
          formData.lease_name.trim(),
          metrics.leaseLiability,
          metrics.rouAsset,
          isShortTermExempt,
        );

        // Single atomic RPC call — the server function handles insert/update,
        // payment schedule, amortization, recognition transactions, and
        // is_complete in one transaction. Any error rolls everything back.
        const { data: rpcResult, error: rpcError } = await supabase.rpc('save_lease', {
          p_lease: leasePayload,
          p_payment_schedule: paymentScheduleRows,
          p_amortization: amortizationRows,
          p_recognition: recognitionRows,
        });

        if (rpcError) throw rpcError;
        if (!rpcResult) throw new Error('Failed to save lease: no result returned from server.');

        const nextOverride = financeIssues.noneMet ? overrideReason : '';
        if (nextOverride !== (lease?.classification_override_reason ?? '')) {
          const { error: overrideError } = await supabase.rpc('set_classification_override', {
            p_lease_id: rpcResult as string,
            p_reason: nextOverride,
          });
          if (overrideError) throw overrideError;
        }

        onSuccess();
      } catch (err) {
        reportCriticalError(supabase, 'save_lease', err);
        if (isDuplicateNameError(err)) {
          setLeaseNameError(DUPLICATE_NAME_MESSAGE);
        } else {
          setError(toLeaseSaveErrorMessage(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [
      lease,
      postedThrough,
      userId,
      formCompanyId,
      formData,
      useVariablePayments,
      paymentTranches,
      setError,
      setLeaseNameError,
      setLoading,
      onSuccess,
      classifyCurrent,
      discountRateCtx,
      shortTermCtx,
      combineCtx,
    ]
  );

  const { handleCreateBranch, handleCreateFixedAssetType } = useLeaseFormLookupActions(args);

  const runClassificationWizard = useCallback(() => {
    const termMonths = calculateTermMonths(formData);
    if (termMonths <= 0) {
      setError('Please set valid lease start and end dates first');
      return;
    }
    const classificationPayment = getBasePaymentAmount(useVariablePayments, paymentTranches, formData);
    if (!classificationPayment || !formData.incremental_borrowing_rate) {
      setError('Please enter payment amount and borrowing rate first');
      return;
    }

    setError('');
    const result = classifyCurrent();
    setClassificationResult(result);
    setFormData((prev) => ({
      ...prev,
      lease_classification: result.classification,
      auto_classified: true,
    }));
    setShowClassificationWizard(false);
  }, [formData, useVariablePayments, paymentTranches, classifyCurrent, setClassificationResult, setFormData, setShowClassificationWizard, setError]);

  return {
    handleSubmit,
    handleCreateBranch,
    handleCreateFixedAssetType,
    runClassificationWizard,
    classifyCurrent,
    loadExistingPaymentSchedule,
  };
}
