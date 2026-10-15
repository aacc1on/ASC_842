import { describe, it, expect } from 'vitest';
import { generateMonthEndTransactions, validateMonthEndPeriod, summarizeMonthEndTransactions } from '../utils/monthEndTransactions';
import { buildStoredSchedulesForLeases } from '../utils/testScheduleHelper';
import type { Lease } from '../types/lease';

const baseLease: Lease = {
  id: 'lease-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  lease_name: 'Test Lease',
  lease_description: '',
  lessor_name: 'Lessor Co',
  lease_start_date: '2026-01-01',
  lease_end_date: '2026-12-31',
  lease_term_months: 12,
  payment_amount: 1000,
  payment_frequency: 'monthly',
  incremental_borrowing_rate: 5,
  lease_classification: 'operating',
  initial_direct_costs: 0,
  lease_incentives: 0,
  rou_asset: 11710,
  lease_liability: 11710,
  status: 'active',
  created_at: '',
  updated_at: '',
  payment_timing: 'beginning',
  payment_day_of_month: null,
  transfer_ownership: false,
  purchase_option: false,
  purchase_option_price: 0,
  asset_fair_value: 0,
  asset_economic_life_months: 0,
  specialized_asset: false,
  residual_value_guarantee: 0,
  auto_classified: false,
  lessor_type: 'corporate',
  branch_id: null,
  asset_market_value: 0,
  fixed_asset_type_id: null,
  company_id: null,
};

describe('Month-end transactions', () => {
  it('generateMonthEndTransactions produces balanced debit/credit entries', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2026-03', stored);
    expect(txns.length).toBeGreaterThan(0);

    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(Math.abs(totalDebits - totalCredits)).toBeLessThan(0.01);
  });

  it('produces entries for the correct period', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2026-03', stored);
    expect(txns.every(t => t.period === '2026-03')).toBe(true);
  });

  it('skips inactive leases', () => {
    const inactive = { ...baseLease, status: 'terminated' as const };
    const stored = buildStoredSchedulesForLeases([inactive]);
    const txns = generateMonthEndTransactions([inactive], '2026-03', stored);
    expect(txns).toHaveLength(0);
  });

  it('skips periods before lease start', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2025-12', stored);
    expect(txns).toHaveLength(0);
  });

  it('skips periods after lease end', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2027-06', stored);
    expect(txns).toHaveLength(0);
  });

  it('finance lease produces interest, payment, and amortization entries', () => {
    const financeLease = { ...baseLease, lease_classification: 'finance' as const };
    const stored = buildStoredSchedulesForLeases([financeLease]);
    const txns = generateMonthEndTransactions([financeLease], '2026-03', stored);
    const types = txns.map(t => t.transaction_type);
    expect(types).toContain('interest');
    expect(types).toContain('payment');
    expect(types).toContain('amortization');
  });

  it('operating lease produces operating_lease_expense and payment entries', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2026-03', stored);
    const types = txns.map(t => t.transaction_type);
    expect(types).toContain('operating_lease_expense');
    expect(types).toContain('payment');
  });

  it('each transaction has equal debit and credit amounts', () => {
    const stored = buildStoredSchedulesForLeases([baseLease]);
    const txns = generateMonthEndTransactions([baseLease], '2026-03', stored);
    for (const t of txns) {
      expect(t.debit_amount).toBe(t.credit_amount);
    }
  });
});

describe('Month-end validation', () => {
  it('validates a correct YYYY-MM period', () => {
    expect(validateMonthEndPeriod('2026-03').valid).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(validateMonthEndPeriod('2026-3').valid).toBe(false);
    expect(validateMonthEndPeriod('invalid').valid).toBe(false);
  });

  it('rejects month out of range', () => {
    expect(validateMonthEndPeriod('2026-13').valid).toBe(false);
  });

  it('rejects year out of range', () => {
    expect(validateMonthEndPeriod('1999-03').valid).toBe(false);
  });
});

describe('Month-end summary', () => {
  it('summarizeMonthEndTransactions computes totals correctly', () => {
    const financeLease = { ...baseLease, lease_classification: 'finance' as const };
    const stored = buildStoredSchedulesForLeases([financeLease]);
    const txns = generateMonthEndTransactions([financeLease], '2026-03', stored);
    const summary = summarizeMonthEndTransactions(txns);

    expect(summary.totalTransactions).toBe(txns.length);
    expect(summary.totalLeases).toBe(1);
    expect(summary.totalDebits).toBeCloseTo(summary.totalCredits, 2);
  });
});
