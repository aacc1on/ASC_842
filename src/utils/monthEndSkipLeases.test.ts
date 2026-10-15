import { describe, it, expect } from 'vitest';
import { generateMonthEndTransactionsWithSkips } from './monthEndTransactions';
import { buildStoredSchedulesForLeases } from './testScheduleHelper';
import type { Lease } from '../types/lease';

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2028-12-31',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'end',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Lease;
}

describe('Month-end: lease with no stored schedule is skipped, not thrown', () => {
  it('skips lease with no stored schedule and posts other leases', () => {
    const lease1 = makeLease({ id: 'l1', lease_name: 'Has Schedule' });
    const lease2 = makeLease({ id: 'l2', lease_name: 'No Schedule' });

    // Only provide stored schedule for lease1
    const stored = buildStoredSchedulesForLeases([lease1]);

    const result = generateMonthEndTransactionsWithSkips([lease1, lease2], '2026-01', stored);

    // Lease1 should have transactions
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.transactions.every(t => t.lease_id === 'l1')).toBe(true);

    // Lease2 should be in skipped list
    expect(result.skippedLeases).toHaveLength(1);
    expect(result.skippedLeases[0].lease_id).toBe('l2');
    expect(result.skippedLeases[0].lease_name).toBe('No Schedule');
    expect(result.skippedLeases[0].reason).toContain('No amortization schedule');
  });

  it('does not throw when no stored schedule exists', () => {
    const lease = makeLease();
    expect(() => generateMonthEndTransactionsWithSkips([lease], '2026-01', undefined)).not.toThrow();
  });

  it('returns empty transactions and one skipped lease when all leases lack schedules', () => {
    const lease = makeLease();
    const result = generateMonthEndTransactionsWithSkips([lease], '2026-01', undefined);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedLeases).toHaveLength(1);
  });

  it('backward compatibility: generateMonthEndTransactions still returns array', async () => {
    const { generateMonthEndTransactions } = await import('./monthEndTransactions');
    const lease = makeLease();
    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    expect(Array.isArray(txns)).toBe(true);
    expect(txns.length).toBeGreaterThan(0);
  });
});

describe('Month-end: every active lease overlapping the month is posted exactly once', () => {
  const vehicle14 = makeLease({
    id: 'v14',
    lease_name: 'Vehicle 14',
    lease_start_date: '2023-01-04',
    lease_end_date: '2027-10-07',
    lease_term_months: 58,
    payment_amount: 260,
    payment_timing: 'beginning',
    rou_asset: 13000,
    lease_liability: 13000,
  });

  it('posts a mid-month, beginning-timing lease in period 45 (Sep 2026)', () => {
    const stored = buildStoredSchedulesForLeases([vehicle14]);
    const result = generateMonthEndTransactionsWithSkips([vehicle14], '2026-09', stored);
    expect(result.skippedLeases).toHaveLength(0);
    const types = result.transactions.map((t) => t.transaction_type);
    expect(types.filter((t) => t === 'operating_lease_expense')).toHaveLength(2);
    expect(types.filter((t) => t === 'payment')).toHaveLength(1);
    expect(result.transactions.every((t) => t.period === '2026-09')).toBe(true);
  });

  it('reports a skip instead of silently omitting a lease whose schedule is truncated', () => {
    const stored = buildStoredSchedulesForLeases([vehicle14]);
    stored.set('v14', (stored.get('v14') ?? []).filter((r) => r.period_number < 45));
    const result = generateMonthEndTransactionsWithSkips([vehicle14], '2026-09', stored);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedLeases).toHaveLength(1);
    expect(result.skippedLeases[0].lease_id).toBe('v14');
    expect(result.skippedLeases[0].reason).toContain('period 45');
  });

  it('posts nothing and reports no skip after the schedule has fully run off', () => {
    const stored = buildStoredSchedulesForLeases([vehicle14]);
    const result = generateMonthEndTransactionsWithSkips([vehicle14], '2028-01', stored);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedLeases).toHaveLength(0);
  });

  it('posts a lease listed twice only once', () => {
    const stored = buildStoredSchedulesForLeases([vehicle14]);
    const once = generateMonthEndTransactionsWithSkips([vehicle14], '2026-09', stored).transactions;
    const twice = generateMonthEndTransactionsWithSkips([vehicle14, vehicle14], '2026-09', stored).transactions;
    expect(twice).toHaveLength(once.length);
  });
});
