import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transaction } from '../components/transactions/types';

// vi.mock is hoisted. We create a stable chain inside the factory and
// expose it so tests can configure return values.
const mockChain = {
  eq: vi.fn(),
  select: vi.fn(),
};

vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn(() => ({
    delete: vi.fn(() => mockChain),
  }));
  const mockSupabase = {
    from: mockFrom,
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'user-1' } } }),
      ),
    },
  };
  return { supabase: mockSupabase };
});

import { supabase } from '../lib/supabase';
import { useTransactionMutations } from '../hooks/useTransactionMutations';
import { renderHook, act } from '@testing-library/react';

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    user_id: 'user-1',
    lease_id: 'lease-1',
    transaction_date: '2023-01-04',
    transaction_type: 'initial_recognition',
    description: 'Initial lease liability recognized for lease: Vehicle 14',
    reference_number: 'REC-001',
    account_debited: 'Right-of-Use Asset',
    account_credited: 'Lease Liability',
    debit_amount: 0,
    credit_amount: 13127.48,
    amount: 13127.48,
    period: '2023-01',
    is_reversed: false,
    month_end_document_id: null,
    ...overrides,
  } as unknown as Transaction;
}

const noop = () => {};
const confirmYes = () => Promise.resolve(true);

function renderMutationsHook() {
  return renderHook(() =>
    useTransactionMutations({
      confirmDialog: confirmYes,
      refreshData: noop,
      resetForm: noop,
      setShowAddModal: noop,
      setSelectedTransaction: noop,
    }),
  );
}

const fromSpy = supabase as unknown as { from: ReturnType<typeof vi.fn> };

describe('handleDeleteTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default chain behavior after clearAllMocks
    mockChain.eq.mockReturnValue(mockChain);
  });

  it('deletes successfully when the database returns the deleted row id', async () => {
    mockChain.select.mockResolvedValue({ data: [{ id: 'txn-1' }], error: null });

    const { result } = renderMutationsHook();

    await act(async () => {
      await result.current.handleDeleteTransaction(makeTxn());
    });

    expect(result.current.successMessage).toBe('Transaction deleted.');
    expect(result.current.errorMessage).toBe('');
  });

  it('shows a clear reason when RLS blocks the delete (0 rows returned, no error)', async () => {
    mockChain.select.mockResolvedValue({ data: [], error: null });

    const { result } = renderMutationsHook();

    await act(async () => {
      await result.current.handleDeleteTransaction(makeTxn());
    });

    expect(result.current.errorMessage).toContain('could not be deleted');
    expect(result.current.successMessage).toBe('');
  });

  it('shows a clear reason when a database trigger blocks the delete', async () => {
    mockChain.select.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'Cannot modify lease transactions in a locked accounting period',
      },
    });

    const { result } = renderMutationsHook();

    await act(async () => {
      await result.current.handleDeleteTransaction(makeTxn());
    });

    // The trigger message is user-safe (matches SAFE_MESSAGE_PATTERNS in errors.ts)
    expect(result.current.errorMessage).toContain('accounting period');
    expect(result.current.successMessage).toBe('');
  });

  it('routes initial_recognition to lease_transactions table', async () => {
    mockChain.select.mockResolvedValue({ data: [{ id: 'txn-1' }], error: null });

    const { result } = renderMutationsHook();

    await act(async () => {
      await result.current.handleDeleteTransaction(
        makeTxn({ transaction_type: 'initial_recognition' }),
      );
    });

    expect(fromSpy.from).toHaveBeenCalledWith('lease_transactions');
  });

  it('routes non-lease transaction types to transactions table', async () => {
    mockChain.select.mockResolvedValue({ data: [{ id: 'txn-1' }], error: null });

    const { result } = renderMutationsHook();

    await act(async () => {
      await result.current.handleDeleteTransaction(
        makeTxn({ transaction_type: 'interest' }),
      );
    });

    expect(fromSpy.from).toHaveBeenCalledWith('transactions');
  });
});
