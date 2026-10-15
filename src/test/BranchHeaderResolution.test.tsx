import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useTransactionSummary } from '../hooks/useTransactionSummary';
import type { Transaction } from '../components/transactions/types';
import { DebitsByAccountTable } from '../components/transactions/DebitsByAccountTable';
import { CreditsByAccountTable } from '../components/transactions/CreditsByAccountTable';

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    lease_id: 'lease-1',
    transaction_date: '2026-01-15',
    transaction_type: 'initial_recognition',
    account_debited: 'Right-of-Use Asset',
    account_credited: 'Lease Liability',
    debit_amount: 1000,
    credit_amount: 1000,
    description: 'test',
    reference_number: '',
    period: '2026-01',
    is_reversed: false,
    created_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('useTransactionSummary — branch label resolution', () => {
  it('shows branch name + code as label', () => {
    const txns = [makeTxn({ branch_id: 'b1', branch_name: 'Brooklyn', branch_code: '003' })];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches).toHaveLength(1);
    expect(result.current.activeBranches[0].label).toBe('Brooklyn (003)');
  });

  it('shows "No branch" for null branch_id', () => {
    const txns = [makeTxn({ branch_id: null, branch_name: null, branch_code: null })];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches).toHaveLength(1);
    expect(result.current.activeBranches[0].label).toBe('No branch');
    expect(result.current.activeBranches[0].id).toBe('unassigned');
  });

  it('never falls back to a raw UUID for missing branch_name', () => {
    const txns = [makeTxn({ branch_id: '4c34d53e-a7bf-4278-b938-f7cae76cb7ae', branch_name: null, branch_code: null })];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches[0].label).not.toContain('4c34d53e');
    expect(result.current.activeBranches[0].label).toBe('No branch');
  });

  it('shows branch name without code when code is null', () => {
    const txns = [makeTxn({ branch_id: 'b2', branch_name: 'Fresno', branch_code: null })];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches[0].label).toBe('Fresno');
  });

  it('sorts branches by branch_code', () => {
    const txns = [
      makeTxn({ id: 't1', branch_id: 'b3', branch_name: 'Brooklyn', branch_code: '003' }),
      makeTxn({ id: 't2', branch_id: 'b1', branch_name: 'Fresno', branch_code: '001' }),
      makeTxn({ id: 't3', branch_id: 'b2', branch_name: 'Stockton', branch_code: '002' }),
    ];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches.map((b) => b.branch_name)).toEqual(['Fresno', 'Stockton', 'Brooklyn']);
  });

  it('places "No branch" (null code) last in sort order', () => {
    const txns = [
      makeTxn({ id: 't1', branch_id: 'b3', branch_name: 'Brooklyn', branch_code: '003' }),
      makeTxn({ id: 't2', branch_id: null, branch_name: null, branch_code: null }),
      makeTxn({ id: 't3', branch_id: 'b1', branch_name: 'Fresno', branch_code: '001' }),
    ];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.activeBranches.map((b) => b.label)).toEqual(['Fresno (001)', 'Brooklyn (003)', 'No branch']);
  });

  it('builds the debit matrix keyed by branch id, not by UUID label', () => {
    const txns = [makeTxn({ branch_id: 'b1', branch_name: 'Fresno', branch_code: '001' })];
    const { result } = renderHook(() => useTransactionSummary(txns));
    expect(result.current.debitByAccountAndBranch['Right-of-Use Asset']['b1']).toBe(1000);
  });
});

describe('DebitsByAccountTable — header rendering', () => {
  it('renders branch label as column header, not raw UUID', () => {
    const branches = [
      { id: 'b1', branch_name: 'Brooklyn', branch_code: '003', label: 'Brooklyn (003)' },
      { id: 'b2', branch_name: 'Stockton', branch_code: '002', label: 'Stockton (002)' },
    ];
    render(
      <DebitsByAccountTable
        debitAccountSummary={[{ account: 'ROU Asset', total: 500, count: 1 }]}
        activeBranches={branches}
        debitByAccountAndBranch={{ 'ROU Asset': { b1: 300, b2: 200 } }}
        totalDebits={500}
        debitAcctPage={1}
        setDebitAcctPage={() => {}}
        acctPageSize={10}
        onOpenBreakdown={() => {}}
      />,
    );
    expect(screen.getByText('Brooklyn (003)')).toBeInTheDocument();
    expect(screen.getByText('Stockton (002)')).toBeInTheDocument();
    expect(screen.queryByText('b1')).not.toBeInTheDocument();
    expect(screen.queryByText('b2')).not.toBeInTheDocument();
  });

  it('shows — for zero amounts and currency for non-zero', () => {
    const branches = [
      { id: 'b1', branch_name: 'Fresno', branch_code: '001', label: 'Fresno (001)' },
      { id: 'b2', branch_name: 'Stockton', branch_code: '002', label: 'Stockton (002)' },
    ];
    render(
      <DebitsByAccountTable
        debitAccountSummary={[
          { account: 'ROU Asset', total: 250, count: 1 },
          { account: 'Cash', total: 0, count: 0 },
        ]}
        activeBranches={branches}
        debitByAccountAndBranch={{ 'ROU Asset': { b1: 250, b2: 0 }, Cash: { b1: 0, b2: 0 } }}
        totalDebits={250}
        debitAcctPage={1}
        setDebitAcctPage={() => {}}
        acctPageSize={10}
        onOpenBreakdown={() => {}}
      />,
    );
    const cells = screen.getAllByText('$250.00');
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('CreditsByAccountTable — header rendering', () => {
  it('renders branch label as column header, not raw UUID', () => {
    const branches = [
      { id: 'b1', branch_name: 'Manhattan', branch_code: '004', label: 'Manhattan (004)' },
    ];
    render(
      <CreditsByAccountTable
        creditAccountSummary={[{ account: 'Lease Liability', total: 1000, count: 1 }]}
        activeBranches={branches}
        creditByAccountAndBranch={{ 'Lease Liability': { b1: 1000 } }}
        totalCredits={1000}
        creditAcctPage={1}
        setCreditAcctPage={() => {}}
        acctPageSize={10}
        onOpenBreakdown={() => {}}
      />,
    );
    expect(screen.getByText('Manhattan (004)')).toBeInTheDocument();
    expect(screen.queryByText('b1')).not.toBeInTheDocument();
  });
});
