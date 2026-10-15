import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import type { Transaction, TransactionFormData } from '../components/transactions/types';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { useTransactionMutations } from './useTransactionMutations';

type Fake = ReturnType<typeof createFakeSupabase>;
type Builder = Record<string, (...a: unknown[]) => unknown>;

/**
 * The shared fake returns `data: null` from delete().select(); real PostgREST returns the deleted rows.
 * Extend the client so delete().eq('id', x).select('id') yields the rows that matched.
 */
function withDeleteReturning(fake: Fake, tables: Tables) {
  return {
    ...fake,
    from: (table: string) => {
      const q = fake.from(table) as unknown as Builder;
      const origDelete = q.delete.bind(q);
      q.delete = () => {
        origDelete();
        const ids: unknown[] = [];
        const origEq = q.eq.bind(q);
        q.eq = (c: unknown, v: unknown) => { if (c === 'id') ids.push(v); return origEq(c, v); };
        q.select = () => ({
          then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
            const matched = (tables[table] ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id }));
            return (q as unknown as PromiseLike<{ error: unknown }>).then((res) => (res.error ? res : { ...res, data: matched })).then(ok, fail);
          },
        });
        return q;
      };
      return q;
    },
  };
}

const evt = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent & { preventDefault: ReturnType<typeof vi.fn> };

const FORM: TransactionFormData = {
  lease_id: 'L1', transaction_date: '2026-03-15', transaction_type: 'adjustment',
  account_debited: 'Interest Expense', account_credited: 'Cash', debit_amount: '100.10', credit_amount: '100.10',
  description: 'Manual adj', reference_number: 'ADJ-1', period: '',
};

const TX: Transaction = {
  id: 'tx-1', lease_id: 'L1', transaction_date: '2026-03-15', transaction_type: 'adjustment',
  account_debited: 'Interest Expense', account_credited: 'Cash', debit_amount: 100, credit_amount: 100,
  description: 'Manual adj', reference_number: 'ADJ-1', period: '2026-03', is_reversed: false, created_at: '',
  month_end_document_id: null,
};

let tables: Tables;
let fake: Fake;
let confirmDialog: Mock<(o: { message: string; title?: string; destructive?: boolean }) => Promise<boolean>>;
let refreshData: Mock<() => void>;
let resetForm: Mock<() => void>;
let setShowAddModal: Mock<(v: boolean) => void>;
let setSelectedTransaction: Mock<(t: Transaction | null) => void>;

function install(opts: Partial<Parameters<typeof createFakeSupabase>[1]> = {}) {
  fake = createFakeSupabase(tables, { userId: 'u1', ...opts });
  h.client = withDeleteReturning(fake, tables) as unknown as Record<string, unknown>;
}

function setup() {
  return renderHook(() => useTransactionMutations({
    confirmDialog, refreshData, resetForm, setShowAddModal, setSelectedTransaction,
  }));
}

beforeEach(() => {
  tables = {
    transactions: [{ id: 'tx-1', lease_id: 'L1', organization_id: 'org-a', is_reversed: false } as Row],
    lease_transactions: [{ id: 'lt-1', lease_id: 'L1', organization_id: 'org-a' } as Row],
  };
  install();
  confirmDialog = vi.fn<(o: { message: string; title?: string; destructive?: boolean }) => Promise<boolean>>().mockResolvedValue(true);
  refreshData = vi.fn<() => void>();
  resetForm = vi.fn<() => void>();
  setShowAddModal = vi.fn<(v: boolean) => void>();
  setSelectedTransaction = vi.fn<(t: Transaction | null) => void>();
});

describe('handleSubmit', () => {
  it.each([
    [{ lease_id: '' }, 'Please select a lease.'],
    [{ debit_amount: 'abc' }, 'Debit and credit amounts must be valid numbers.'],
    [{ debit_amount: '', credit_amount: '0' }, 'Either debit or credit amount must be greater than zero.'],
    [{ debit_amount: '100', credit_amount: '99.99' }, 'Debit and credit amounts must be equal so the entry balances.'],
  ])('rejects invalid input %o', async (patch, msg) => {
    const { result } = setup();
    const e = evt();
    await act(() => result.current.handleSubmit(e, { ...FORM, ...patch }));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.errorMessage).toBe(msg);
    expect(fake.writes).toEqual([]);
    expect(result.current.submitting).toBe(false);
  });

  it('inserts a balanced entry, derives the period from the date and closes the form', async () => {
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(result.current.errorMessage).toBe('');
    expect(result.current.successMessage).toBe('Transaction saved successfully.');
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ op: 'insert', table: 'transactions' });
    const row = (fake.writes[0] as { rows: Row[] }).rows[0];
    expect(row).toMatchObject({ user_id: 'u1', lease_id: 'L1', debit_amount: 100.1, credit_amount: 100.1, period: '2026-03' });
    expect(resetForm).toHaveBeenCalledTimes(1);
    expect(setShowAddModal).toHaveBeenCalledWith(false);
    expect(refreshData).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(false);
  });

  it('keeps an explicit period and allows an empty date', async () => {
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), { ...FORM, period: '2026-02' }));
    expect((fake.writes[0] as { rows: Row[] }).rows[0].period).toBe('2026-02');
    await act(() => result.current.handleSubmit(evt(), { ...FORM, transaction_date: '' }));
    expect((fake.writes[1] as { rows: Row[] }).rows[0].period).toBe('');
  });

  it('requires a signed-in user', async () => {
    install({ signedOut: true });
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(result.current.errorMessage).toBe('You must be signed in.');
    expect(fake.writes).toEqual([]);
    expect(result.current.submitting).toBe(false);
  });

  it('surfaces closed-period guard messages from the database', async () => {
    install({ failures: { write: { transactions: 'Cannot post to a closed accounting period (2026-03).' } } });
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(result.current.errorMessage).toBe('Cannot post to a closed accounting period (2026-03).');
    expect(result.current.successMessage).toBe('');
    expect(refreshData).not.toHaveBeenCalled();
    expect(resetForm).not.toHaveBeenCalled();
  });

  it('hides internal database errors behind the fallback', async () => {
    install({ failures: { write: { transactions: 'new row violates row-level security policy' } } });
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(result.current.errorMessage).toBe('Failed to save transaction.');
  });

  it('handles a thrown exception', async () => {
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('internal stack trace')) } };
    const { result } = setup();
    await act(() => result.current.handleSubmit(evt(), FORM));
    expect(result.current.errorMessage).toBe('Failed to save transaction.');
    expect(result.current.submitting).toBe(false);
  });

  it('exposes message setters', () => {
    const { result } = setup();
    act(() => { result.current.setErrorMessage('x'); result.current.setSuccessMessage('y'); });
    expect(result.current.errorMessage).toBe('x');
    expect(result.current.successMessage).toBe('y');
  });
});

describe('handleReverseTransaction', () => {
  it('refuses to reverse a posted month-end transaction', async () => {
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction({ ...TX, month_end_document_id: 'doc-1' }));
    expect(result.current.errorMessage).toMatch(/Cannot reverse a posted month-end transaction/);
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it('does nothing when the user cancels', async () => {
    confirmDialog.mockResolvedValue(false);
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction(TX));
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reverse transaction?', destructive: true }));
    expect(fake.writes).toEqual([]);
  });

  it('inserts a swapped reversing entry and flags the original', async () => {
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction(TX));
    expect(result.current.successMessage).toBe('Transaction reversed successfully.');
    expect(fake.writes[0]).toMatchObject({ op: 'insert', table: 'transactions' });
    expect((fake.writes[0] as { rows: Row[] }).rows[0]).toMatchObject({
      account_debited: 'Cash', account_credited: 'Interest Expense', reference_number: 'REV-ADJ-1',
      description: 'Reversal of: Manual adj', reversal_of: 'tx-1', is_reversed: false, user_id: 'u1',
    });
    expect(fake.writes[1]).toEqual({ op: 'update', table: 'transactions', values: { is_reversed: true }, matched: 1 });
    expect(tables.transactions.find((r) => r.id === 'tx-1')!.is_reversed).toBe(true);
    expect(refreshData).toHaveBeenCalledTimes(1);
  });

  it('uses the reference number when there is no description', async () => {
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction({ ...TX, description: '' }));
    expect(confirmDialog.mock.calls[0][0].message).toContain('"ADJ-1"');
    expect((fake.writes[0] as { rows: Row[] }).rows[0].description).toBe('Reversal of: ADJ-1');
  });

  it('requires a signed-in user', async () => {
    install({ signedOut: true });
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction(TX));
    expect(result.current.errorMessage).toBe('You must be signed in.');
    expect(fake.writes).toEqual([]);
  });

  it('surfaces posted-period guard messages and does not flag the original', async () => {
    install({ failures: { write: { transactions: 'Cannot modify posted entries in a closed month.' } } });
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction(TX));
    expect(result.current.errorMessage).toBe('Cannot modify posted entries in a closed month.');
    expect(tables.transactions[0].is_reversed).toBe(false);
    expect(refreshData).not.toHaveBeenCalled();
  });

  it('handles a thrown exception', async () => {
    h.client = { ...fake, auth: { getUser: () => Promise.reject(new Error('relation "x" does not exist')) } };
    const { result } = setup();
    await act(() => result.current.handleReverseTransaction(TX));
    expect(result.current.errorMessage).toBe('Failed to reverse transaction.');
    expect(result.current.submitting).toBe(false);
  });
});

describe('handleDeleteTransaction', () => {
  it('refuses to delete a posted month-end transaction', async () => {
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction({ ...TX, month_end_document_id: 'doc-1' }));
    expect(result.current.errorMessage).toMatch(/Cannot delete a posted month-end transaction/);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('does nothing when the user cancels', async () => {
    confirmDialog.mockResolvedValue(false);
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction(TX));
    expect(fake.writes).toEqual([]);
    expect(tables.transactions).toHaveLength(1);
  });

  it('deletes a manual transaction from the transactions table', async () => {
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction(TX));
    expect(result.current.successMessage).toBe('Transaction deleted.');
    expect(fake.writes).toEqual([{ op: 'delete', table: 'transactions', matched: 1 }]);
    expect(tables.transactions).toHaveLength(0);
    expect(setSelectedTransaction).toHaveBeenCalledWith(null);
    expect(refreshData).toHaveBeenCalledTimes(1);
  });

  it.each(['initial_recognition', 'modification', 'remeasurement', 'termination'])(
    'routes %s rows to lease_transactions', async (type) => {
      const { result } = setup();
      await act(() => result.current.handleDeleteTransaction({ ...TX, id: 'lt-1', transaction_type: type, description: '' }));
      expect(fake.writes).toEqual([{ op: 'delete', table: 'lease_transactions', matched: 1 }]);
      expect(confirmDialog.mock.calls[0][0].message).toContain('"ADJ-1"');
    },
  );

  it('reports when no row was deleted (already removed / other organization)', async () => {
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction({ ...TX, id: 'tx-of-other-org' }));
    expect(result.current.errorMessage).toMatch(/could not be deleted/);
    expect(refreshData).not.toHaveBeenCalled();
    expect(tables.transactions).toHaveLength(1);
  });

  it('surfaces database guard errors', async () => {
    install({ failures: { write: { transactions: 'Transactions in posted periods cannot be deleted.' } } });
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction(TX));
    expect(result.current.errorMessage).toBe('Transactions in posted periods cannot be deleted.');
    expect(setSelectedTransaction).not.toHaveBeenCalled();
  });

  it('handles a thrown exception', async () => {
    h.client = { ...fake, from: () => { throw new Error('syntax error at or near'); } };
    const { result } = setup();
    await act(() => result.current.handleDeleteTransaction(TX));
    expect(result.current.errorMessage).toBe('Failed to delete transaction.');
    expect(result.current.submitting).toBe(false);
  });
});
