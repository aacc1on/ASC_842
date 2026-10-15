import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Lease } from '../types/lease';
import { useLeaseFormState } from './useLeaseFormState';

afterEach(() => {
  vi.useRealTimers();
});

describe('useLeaseFormState', () => {
  it('new lease defaults: today start, +12 months end, safe enum defaults', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    const { result } = renderHook(() => useLeaseFormState());
    const f = result.current.formData;
    expect(f.lease_start_date).toBe('2026-03-15');
    expect(f.lease_end_date).toBe('2027-03-15');
    expect(f.lease_name).toBe('');
    expect(f.lessor_type).toBe('corporate');
    expect(f.payment_frequency).toBe('monthly');
    expect(f.payment_timing).toBe('beginning');
    expect(f.lease_classification).toBe('operating');
    expect(f.accounting_treatment).toBe('recognized');
    expect(f.discount_rate_method).toBe('ibr');
    expect(f.status).toBe('active');
    expect(result.current.useVariablePayments).toBe(false);
    expect(result.current.paymentTranches).toEqual([]);
    expect(result.current.classificationResult).toBeNull();
    expect(result.current.showClassificationWizard).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.leaseNameError).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('populates from an existing lease', () => {
    const lease = {
      id: 'l1',
      lease_name: 'HQ',
      lessor_name: 'Landlord',
      lessor_type: 'individual',
      lease_start_date: '2025-01-01',
      lease_end_date: '2029-12-31',
      payment_amount: 2500,
      lease_component_amount: 2000,
      payment_frequency: 'quarterly',
      lease_classification: 'finance',
      payment_timing: 'end',
      transfer_ownership: true,
      classification_override_reason: 'Reason',
      status: 'terminated',
      renewal_months_reasonably_certain: 24,
    } as unknown as Lease;
    const { result } = renderHook(() => useLeaseFormState(lease));
    const f = result.current.formData;
    expect(f.lease_name).toBe('HQ');
    expect(f.lessor_type).toBe('individual');
    expect(f.lease_end_date).toBe('2029-12-31');
    expect(f.payment_frequency).toBe('quarterly');
    expect(f.lease_classification).toBe('finance');
    expect(f.payment_timing).toBe('end');
    expect(f.transfer_ownership).toBe(true);
    expect(f.lease_component_amount).toBe(2000);
    expect(f.classification_override_reason).toBe('Reason');
    expect(f.status).toBe('terminated');
    expect(f.renewal_months_reasonably_certain).toBe(24);
  });

  it('fills defaults for missing fields on an existing lease and falls back to payment_amount for the lease component', () => {
    const { result } = renderHook(() => useLeaseFormState({ id: 'l2', payment_amount: 900 } as unknown as Lease));
    const f = result.current.formData;
    expect(f.lease_name).toBe('');
    expect(f.lessor_type).toBe('corporate');
    expect(f.lease_start_date).toBe('');
    expect(f.lease_component_amount).toBe(900);
    expect(f.discount_rate_method).toBe('ibr');
    expect(f.component_policy).toBe('not_applicable');
    expect(f.renewal_months_reasonably_certain).toBe(0);
    expect(f.termination_penalty_amount).toBe(0);
    expect(f.prepaid_lease_payments).toBe(0);
    expect(f.status).toBe('active');
  });

  it('lease component defaults to empty when neither amount is set', () => {
    const { result } = renderHook(() => useLeaseFormState({ id: 'l3' } as unknown as Lease));
    expect(result.current.formData.lease_component_amount).toBe('');
  });

  it('setters update state and initial data is not rebuilt on rerender', () => {
    const { result, rerender } = renderHook(({ l }) => useLeaseFormState(l), {
      initialProps: { l: undefined as Lease | undefined },
    });
    act(() => {
      result.current.setFormData((p) => ({ ...p, lease_name: 'Typed' }));
      result.current.setError('Oops');
      result.current.setLeaseNameError('Dup');
      result.current.setLoading(true);
      result.current.setUseVariablePayments(true);
      result.current.setShowClassificationWizard(true);
      result.current.setPaymentTranches([{ id: 't', fromMonth: 1, toMonth: 2, paymentAmount: 3 }]);
    });
    rerender({ l: { id: 'x', lease_name: 'Other' } as unknown as Lease });
    expect(result.current.formData.lease_name).toBe('Typed');
    expect(result.current.error).toBe('Oops');
    expect(result.current.leaseNameError).toBe('Dup');
    expect(result.current.loading).toBe(true);
    expect(result.current.useVariablePayments).toBe(true);
    expect(result.current.showClassificationWizard).toBe(true);
    expect(result.current.paymentTranches).toHaveLength(1);
  });
});
