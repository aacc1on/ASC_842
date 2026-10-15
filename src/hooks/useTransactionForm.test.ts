import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Transaction } from '../components/transactions/types';
import { useTransactionForm } from './useTransactionForm';

afterEach(() => vi.useRealTimers());

describe('useTransactionForm', () => {
  it('starts closed with an empty payment form', () => {
    const { result } = renderHook(() => useTransactionForm());
    expect(result.current.showAddModal).toBe(false);
    expect(result.current.selectedTransaction).toBeNull();
    expect(result.current.formData).toMatchObject({
      lease_id: '', transaction_type: 'payment', account_debited: '', account_credited: '',
      debit_amount: '', credit_amount: '', description: '', reference_number: '', period: '',
    });
    expect(result.current.formData.transaction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('toggles the modal and selected transaction', () => {
    const { result } = renderHook(() => useTransactionForm());
    const t = { id: 't1' } as Transaction;
    act(() => { result.current.setShowAddModal(true); result.current.setSelectedTransaction(t); });
    expect(result.current.showAddModal).toBe(true);
    expect(result.current.selectedTransaction).toBe(t);
    act(() => result.current.setSelectedTransaction(null));
    expect(result.current.selectedTransaction).toBeNull();
  });

  it('resetForm clears edits and stamps today\'s date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T10:00:00Z'));
    const { result } = renderHook(() => useTransactionForm());
    act(() => result.current.setFormData((f) => ({ ...f, lease_id: 'L1', debit_amount: '5', transaction_date: '2020-01-01' })));
    expect(result.current.formData.lease_id).toBe('L1');
    act(() => result.current.resetForm());
    expect(result.current.formData).toMatchObject({ lease_id: '', debit_amount: '', transaction_date: '2026-05-20' });
  });
});
