import { describe, it, expect } from 'vitest';
import { generateFinanceLeaseJournalEntry, type JournalEntryRecord } from './journalEntries';
import type { AmortizationSchedule } from '../types/lease';

function makeSchedule(overrides: Partial<AmortizationSchedule> = {}): AmortizationSchedule {
  return {
    period_number: 1,
    period_date: '2026-01-01',
    beginning_liability: 10000,
    payment_amount: 1000,
    interest_expense: 50,
    principal_reduction: 950,
    ending_liability: 9050,
    rou_asset_balance: 9500,
    depreciation_expense: 500,
    ...overrides,
  };
}

function checkBalanced(entries: JournalEntryRecord[]): boolean {
  const debits = entries.reduce((s, e) => s + e.debit_amount, 0);
  const credits = entries.reduce((s, e) => s + e.credit_amount, 0);
  return Math.abs(debits - credits) < 0.001;
}

describe('QA-004: Finance journal entries balanced in non-payment months', () => {
  it('balanced when payment > 0 (normal month)', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule({ payment_amount: 1000 }));
    expect(checkBalanced(entries)).toBe(true);
  });

  it('balanced when payment = 0 (non-payment month for quarterly lease)', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule({ payment_amount: 0, principal_reduction: 0 }));
    expect(checkBalanced(entries)).toBe(true);
  });

  it('does not book Cash entry when payment = 0', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule({ payment_amount: 0, principal_reduction: 0 }));
    const accounts = entries.map(e => e.account_name);
    expect(accounts).not.toContain('Cash');
  });

  it('still books interest accrual when payment = 0', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule({ payment_amount: 0, principal_reduction: 0 }));
    const interestEntries = entries.filter(e => e.entry_type === 'Finance Lease Interest');
    expect(interestEntries.length).toBe(2); // Dr Interest Expense + Cr Lease Liability
    const interestDebit = interestEntries.find(e => e.debit_amount > 0);
    expect(interestDebit).toBeDefined();
    expect(interestDebit!.debit_amount).toBe(50);
  });

  it('still books depreciation when payment = 0', () => {
    const entries = generateFinanceLeaseJournalEntry(makeSchedule({ payment_amount: 0, principal_reduction: 0 }));
    const depEntries = entries.filter(e => e.entry_type === 'Finance Lease Depreciation');
    expect(depEntries.length).toBe(2);
  });

  it('balanced across a simulated quarterly schedule (pay months 3,6,9,12)', () => {
    const schedules: AmortizationSchedule[] = [
      makeSchedule({ period_number: 1, payment_amount: 0, interest_expense: 50, principal_reduction: 0 }),
      makeSchedule({ period_number: 2, payment_amount: 0, interest_expense: 48, principal_reduction: 0 }),
      makeSchedule({ period_number: 3, payment_amount: 3000, interest_expense: 46, principal_reduction: 2954 }),
      makeSchedule({ period_number: 4, payment_amount: 0, interest_expense: 44, principal_reduction: 0 }),
      makeSchedule({ period_number: 5, payment_amount: 0, interest_expense: 42, principal_reduction: 0 }),
      makeSchedule({ period_number: 6, payment_amount: 3000, interest_expense: 40, principal_reduction: 2960 }),
    ];
    for (const s of schedules) {
      const entries = generateFinanceLeaseJournalEntry(s);
      expect(checkBalanced(entries)).toBe(true);
    }
  });

  it('balanced across a simulated semi-annual schedule (pay months 6,12)', () => {
    const schedules: AmortizationSchedule[] = [
      makeSchedule({ period_number: 1, payment_amount: 0, interest_expense: 50, principal_reduction: 0 }),
      makeSchedule({ period_number: 6, payment_amount: 6000, interest_expense: 30, principal_reduction: 5970 }),
      makeSchedule({ period_number: 12, payment_amount: 6000, interest_expense: 10, principal_reduction: 5990 }),
    ];
    for (const s of schedules) {
      const entries = generateFinanceLeaseJournalEntry(s);
      expect(checkBalanced(entries)).toBe(true);
    }
  });

  it('balanced across a simulated annual schedule (pay month 12 only)', () => {
    const schedules: AmortizationSchedule[] = [
      makeSchedule({ period_number: 1, payment_amount: 0, interest_expense: 50, principal_reduction: 0 }),
      makeSchedule({ period_number: 6, payment_amount: 0, interest_expense: 25, principal_reduction: 0 }),
      makeSchedule({ period_number: 12, payment_amount: 12000, interest_expense: 5, principal_reduction: 11995 }),
    ];
    for (const s of schedules) {
      const entries = generateFinanceLeaseJournalEntry(s);
      expect(checkBalanced(entries)).toBe(true);
    }
  });

  it('liability roll-forward from entries equals schedule ending liability', () => {
    // Month 1: begin 10000, interest 50, payment 1000, principal 950 → end 9050
    const s1 = makeSchedule({ period_number: 1, beginning_liability: 10000, payment_amount: 1000, interest_expense: 50, principal_reduction: 950, ending_liability: 9050 });
    const entries1 = generateFinanceLeaseJournalEntry(s1);

    // Sum all credits to Lease Liability minus debits to Lease Liability
    const liabChange = entries1.reduce((s, e) => {
      if (e.account_name === 'Lease Liability') return s + e.credit_amount - e.debit_amount;
      return s;
    }, 0);

    // Liability should increase by interest and decrease by principal+interest payment
    // Net change = interest - (principal + interest) = -principal = -950
    expect(liabChange).toBeCloseTo(-950, 2);
    expect(10000 + liabChange).toBeCloseTo(9050, 2);
  });
});
