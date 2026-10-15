import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Lease } from '../types/lease';
import type { ContractModificationRow } from '../components/contract-mods/contractModHelpers';
import { useContractModForm } from './useContractModForm';

const lease = {
  id: 'l1', payment_amount: 1500, lease_term_months: 36, discount_rate: 5, incremental_borrowing_rate: 7,
} as unknown as Lease;

function mod(over: Partial<ContractModificationRow> = {}): ContractModificationRow {
  return {
    id: 'm1',
    lease_id: 'l1',
    modification_date: '2026-03-15T10:00:00Z',
    modification_type: 'payment_change',
    reason: 'renegotiated',
    old_monthly_payment: 1000,
    new_monthly_payment: 1200,
    old_lease_term: 24,
    new_lease_term: 36,
    old_discount_rate: 4,
    new_discount_rate: 4.5,
    notes: 'hello',
    separate_contract: true,
    fair_value_at_modification: 9000,
    remaining_economic_life_months: 48,
    reassessed_classification: 'finance',
    status: 'draft',
    ...over,
  };
}

describe('useContractModForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('has sensible initial state', () => {
    const { result } = renderHook(() => useContractModForm());
    const r = result.current;
    expect(r.activeTab).toBe('modifications');
    expect([r.showModificationModal, r.showCancellationModal, r.showViewModal, r.submitting]).toEqual([false, false, false, false]);
    expect([r.selectedModification, r.editingModification]).toEqual([null, null]);
    expect([r.searchQuery, r.successMessage, r.errorMessage]).toEqual(['', '', '']);
    expect([r.modPage, r.canPage, r.modPageSize, r.canPageSize]).toEqual([1, 1, 10, 10]);
    expect(r.modificationForm).toMatchObject({ lease_id: '', modification_type: 'term_extension', separate_contract: false, new_classification: 'operating' });
    expect(r.cancellationForm).toMatchObject({ lease_id: '', early_termination: false, termination_penalty: 0 });
  });

  it('exposes working setters', () => {
    const { result } = renderHook(() => useContractModForm());
    act(() => {
      result.current.setActiveTab('cancellations');
      result.current.setShowCancellationModal(true);
      result.current.setSearchQuery('hq');
      result.current.setSubmitting(true);
      result.current.setSuccessMessage('ok');
      result.current.setErrorMessage('bad');
      result.current.setModPage(3);
      result.current.setCanPage(2);
      result.current.setModPageSize(25);
      result.current.setCanPageSize(50);
    });
    const r = result.current;
    expect(r.activeTab).toBe('cancellations');
    expect(r.showCancellationModal).toBe(true);
    expect([r.searchQuery, r.submitting, r.successMessage, r.errorMessage]).toEqual(['hq', true, 'ok', 'bad']);
    expect([r.modPage, r.canPage, r.modPageSize, r.canPageSize]).toEqual([3, 2, 25, 50]);
  });

  it('reset helpers restore empty forms dated today', () => {
    const { result } = renderHook(() => useContractModForm());
    act(() => {
      result.current.setModificationForm((f) => ({ ...f, lease_id: 'l1', reason: 'x', modification_date: '2020-01-01' }));
      result.current.setCancellationForm((f) => ({ ...f, lease_id: 'l1', termination_penalty: 99, cancellation_date: '2020-01-01' }));
    });
    expect(result.current.modificationForm.lease_id).toBe('l1');
    act(() => {
      result.current.resetModificationForm();
      result.current.resetCancellationForm();
    });
    expect(result.current.modificationForm).toMatchObject({ lease_id: '', reason: '', modification_date: '2026-05-20' });
    expect(result.current.cancellationForm).toMatchObject({ lease_id: '', termination_penalty: 0, cancellation_date: '2026-05-20' });
  });

  it('populateModificationFormForEdit copies the row, strips the time and opens the modal', () => {
    const { result } = renderHook(() => useContractModForm());
    const m = mod();
    act(() => result.current.populateModificationFormForEdit(m, [lease]));
    expect(result.current.editingModification).toBe(m);
    expect(result.current.showModificationModal).toBe(true);
    expect(result.current.modificationForm).toEqual({
      id: 'm1', lease_id: 'l1', modification_date: '2026-03-15', modification_type: 'payment_change', reason: 'renegotiated',
      old_monthly_payment: 1000, new_monthly_payment: 1200, old_lease_term: 24, new_lease_term: 36,
      old_discount_rate: 4, new_discount_rate: 4.5, notes: 'hello', separate_contract: true,
      new_fair_value: 9000, new_economic_life_months: 48, new_classification: 'finance',
    });
  });

  it('falls back to lease terms and defaults when the row lacks values', () => {
    const { result } = renderHook(() => useContractModForm());
    const sparse = {
      id: 'm2', lease_id: 'l1', modification_type: 'other', reason: '', status: 'draft',
      modification_date: undefined, old_monthly_payment: undefined, new_monthly_payment: undefined,
      old_lease_term: undefined, new_lease_term: undefined,
    } as unknown as ContractModificationRow;
    act(() => result.current.populateModificationFormForEdit(sparse, [lease]));
    expect(result.current.modificationForm).toMatchObject({
      modification_date: '2026-05-20',
      old_monthly_payment: 1500, new_monthly_payment: 0, old_lease_term: 36, new_lease_term: 0,
      old_discount_rate: 5, new_discount_rate: 0, notes: '', separate_contract: false,
      new_fair_value: null, new_economic_life_months: null, new_classification: 'operating',
    });

    act(() => result.current.populateModificationFormForEdit(sparse, [{ ...lease, discount_rate: undefined } as unknown as Lease]));
    expect(result.current.modificationForm.old_discount_rate).toBe(7);

    act(() => result.current.populateModificationFormForEdit(sparse));
    expect(result.current.modificationForm).toMatchObject({ old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0 });
  });

  it('keeps an explicit 0 fair value and economic life from the saved row', () => {
    const { result } = renderHook(() => useContractModForm());
    const row = { ...mod(), separate_contract: false, fair_value_at_modification: 0, remaining_economic_life_months: 0 } as ContractModificationRow;
    act(() => result.current.populateModificationFormForEdit(row, [lease]));
    expect(result.current.modificationForm).toMatchObject({ new_fair_value: 0, new_economic_life_months: 0 });
  });

  it('openViewModal selects the row and shows the view modal', () => {
    const { result } = renderHook(() => useContractModForm());
    const m = mod();
    act(() => result.current.openViewModal(m));
    expect(result.current.selectedModification).toBe(m);
    expect(result.current.showViewModal).toBe(true);
    act(() => {
      result.current.setShowViewModal(false);
      result.current.setSelectedModification(null);
      result.current.setEditingModification(m);
      result.current.setShowModificationModal(true);
    });
    expect(result.current.showViewModal).toBe(false);
    expect(result.current.selectedModification).toBeNull();
    expect(result.current.editingModification).toBe(m);
    expect(result.current.showModificationModal).toBe(true);
  });
});
