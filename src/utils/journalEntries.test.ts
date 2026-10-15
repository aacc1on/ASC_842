import { describe, it, expect } from 'vitest';
import {
  generateOperatingLeaseJournalEntry,
  generateFinanceLeaseJournalEntry,
  generateInitialRecognitionEntry,
  generateModificationRemeasurementEntry,
  type JournalEntryRecord,
} from './journalEntries';
import type { AmortizationSchedule, Lease } from '../types/lease';

function makeSchedule(overrides: Partial<AmortizationSchedule> = {}): AmortizationSchedule {
  return {
    id: 'sch-1',
    lease_id: 'lease-1',
    period_number: 1,
    period_date: '2026-01-31',
    beginning_liability: 32871.02,
    payment_amount: 1000,
    interest_expense: 164.36,
    principal_reduction: 835.64,
    ending_liability: 32035.38,
    rou_asset_balance: 31957.94,
    depreciation_expense: 913.08,
    created_at: '2026-01-01',
    ...overrides,
  };
}

function makeOperatingSchedule(overrides: Partial<AmortizationSchedule> = {}): AmortizationSchedule {
  return makeSchedule({
    depreciation_expense: 835.64,
    rou_asset_balance: 32035.38,
    ...overrides,
  });
}

function checkBalanced(entries: JournalEntryRecord[]): boolean {
  const debits = entries.reduce((s, e) => s + e.debit_amount, 0);
  const credits = entries.reduce((s, e) => s + e.credit_amount, 0);
  return Math.abs(debits - credits) < 0.001;
}

describe('(9) Journal entries — total debits equal total credits', () => {
  it('operating lease entry is balanced', () => {
    const entries = generateOperatingLeaseJournalEntry(makeOperatingSchedule());
    expect(entries.length).toBeGreaterThan(0);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('finance lease entry is balanced', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule());
    expect(entries.length).toBeGreaterThan(0);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('initial recognition entry is balanced', () => {
    const entries = generateInitialRecognitionEntry('lease-1', 32871.02, 32871.02, '2026-01-01', 'operating');
    expect(entries.length).toBeGreaterThan(0);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('initial recognition with IDC and incentives is balanced', () => {
    const fakeLease = {
      initial_direct_costs: 5000,
      lease_incentives: 2000,
    } as unknown as Lease;
    const entries = generateInitialRecognitionEntry('lease-1', 35871.02, 32871.02, '2026-01-01', 'finance', fakeLease);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('credits prepaid lease payments so recognition with prepaid rent and IDC balances', () => {
    const lease = { initial_direct_costs: 1500, lease_incentives: 0, prepaid_lease_payments: 5000 } as unknown as Lease;
    const entries = generateInitialRecognitionEntry('bmw', 29635.99, 23135.99, '2026-10-01', 'finance', lease);
    const prepaid = entries.find((e) => e.account_name === 'Prepaid Rent (Cash)');
    expect(prepaid?.credit_amount).toBe(5000);
    expect(entries.some((e) => e.description === 'ROU asset adjustment')).toBe(false);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('debits incentives received and balances with prepaid, IDC and incentives together', () => {
    const lease = { initial_direct_costs: 1000, lease_incentives: 3000, prepaid_lease_payments: 2000 } as unknown as Lease;
    const entries = generateInitialRecognitionEntry('l', 20000, 20000, '2026-01-01', 'operating', lease);
    expect(entries.find((e) => e.account_name === 'Cash / Lease Incentive Receivable')?.debit_amount).toBe(3000);
    expect(entries.some((e) => e.description === 'ROU asset adjustment')).toBe(false);
    expect(checkBalanced(entries)).toBe(true);
  });

  it('adds an ROU adjustment line when the ROU differs from its components', () => {
    const lease = { initial_direct_costs: 0, lease_incentives: 0, prepaid_lease_payments: 0 } as unknown as Lease;
    for (const rou of [10100, 9900]) {
      const entries = generateInitialRecognitionEntry('l', rou, 10000, '2026-01-01', 'finance', lease);
      expect(entries.some((e) => e.description === 'ROU asset adjustment')).toBe(true);
      expect(checkBalanced(entries)).toBe(true);
    }
  });

  it('modification remeasurement (liability increase) is balanced', () => {
    const entries = generateModificationRemeasurementEntry(
      'lease-1', '2026-06-01', 32871.02, 35000, 32871.02, 35000, 'Term extension', 'finance'
    );
    expect(checkBalanced(entries)).toBe(true);
  });

  it('modification remeasurement (liability decrease) is balanced', () => {
    const entries = generateModificationRemeasurementEntry(
      'lease-1', '2026-06-01', 35000, 32871.02, 35000, 32871.02, 'Term reduction', 'finance'
    );
    expect(checkBalanced(entries)).toBe(true);
  });

  it('modification with ROU/liability mismatch is balanced', () => {
    const entries = generateModificationRemeasurementEntry(
      'lease-1', '2026-06-01', 32871.02, 36000, 32871.02, 35000, 'Payment increase', 'finance'
    );
    expect(checkBalanced(entries)).toBe(true);
  });

  it('operating lease entry has correct accounts (Operating Lease Expense, Lease Liability, ROU Asset, Cash)', () => {
    const entries = generateOperatingLeaseJournalEntry(makeOperatingSchedule());
    const accounts = entries.map(e => e.account_name);
    expect(accounts).toContain('Operating Lease Expense');
    expect(accounts).toContain('Lease Liability');
    expect(accounts).toContain('ROU Asset');
    expect(accounts).toContain('Cash');
  });

  it('operating lease entry does NOT record Depreciation Expense or Interest Expense', () => {
    const entries = generateOperatingLeaseJournalEntry(makeOperatingSchedule());
    const accounts = entries.map(e => e.account_name);
    expect(accounts).not.toContain('Depreciation Expense');
    expect(accounts).not.toContain('Interest Expense');
  });

  it('operating lease expense debit = straight-line cost (interest + ROU reduction = $1,000.00)', () => {
    const entries = generateOperatingLeaseJournalEntry(makeOperatingSchedule());
    const expenseEntry = entries.find(e => e.account_name === 'Operating Lease Expense');
    expect(expenseEntry).toBeDefined();
    expect(expenseEntry!.debit_amount).toBe(1000);
  });

  it('finance lease entry has interest and depreciation entries', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule());
    const types = entries.map(e => e.entry_type);
    expect(types).toContain('Finance Lease Interest');
    expect(types).toContain('Finance Lease Payment');
    expect(types).toContain('Finance Lease Depreciation');
  });
});
