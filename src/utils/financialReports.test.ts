import { describe, it, expect, vi } from 'vitest';
import { generateBalanceSheet, generateProfitLoss, generateCashFlow, generateProfitLossAndCashFlow } from './financialReports';
import type { Lease } from '../types/lease';
import { chainableMock } from './testSupabaseMock';

// Default mock: returns empty data for all queries.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => chainableMock(),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

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
    lease_classification: 'finance',
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
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('generateBalanceSheet', () => {
  it('returns well-formed structure for a single active lease', async () => {
    const bs = await generateBalanceSheet([makeLease()], new Date(2026, 6, 1));
    expect(bs).toHaveProperty('assets');
    expect(bs).toHaveProperty('liabilities');
    expect(bs).toHaveProperty('equity');
    expect(bs.assets).toHaveProperty('currentRouAsset');
    expect(bs.assets).toHaveProperty('accumulatedDepreciation');
    expect(bs.assets).toHaveProperty('netRouAsset');
    expect(bs.liabilities).toHaveProperty('currentPortion');
    expect(bs.liabilities).toHaveProperty('longTermPortion');
    expect(bs.liabilities).toHaveProperty('totalLiability');
  });

  it('cancelled leases are excluded', async () => {
    const bs = await generateBalanceSheet([makeLease({ status: 'cancelled' })], new Date(2026, 6, 1));
    expect(bs.assets.currentRouAsset).toBe(0);
    expect(bs.liabilities.totalLiability).toBe(0);
  });

  it('accounting equation: netRouAsset - totalLiability = retainedEarnings', async () => {
    const bs = await generateBalanceSheet([makeLease()], new Date(2026, 6, 1));
    expect(bs.equity.retainedEarnings).toBeCloseTo(
      bs.assets.netRouAsset - bs.liabilities.totalLiability, 2
    );
  });
});

describe('generateProfitLoss', () => {
  it('returns well-formed structure', async () => {
    const pl = await generateProfitLoss([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl).toHaveProperty('operatingExpenses');
    expect(pl).toHaveProperty('financingCosts');
    expect(pl).toHaveProperty('totalExpenses');
    expect(pl).toHaveProperty('netIncome');
    expect(pl).toHaveProperty('gainLossOnTermination');
  });

  it('totalExpenses = operating + financing', async () => {
    const pl = await generateProfitLoss([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.totalExpenses).toBeCloseTo(
      pl.operatingExpenses.total + pl.financingCosts.interestExpense, 2
    );
  });
});

describe('generateCashFlow', () => {
  it('returns well-formed structure', async () => {
    const cf = await generateCashFlow([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(cf).toHaveProperty('operatingActivities');
    expect(cf).toHaveProperty('financingActivities');
    expect(cf).toHaveProperty('netCashFlow');
  });

  it('netCashFlow = operating + financing', async () => {
    const cf = await generateCashFlow([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(cf.netCashFlow).toBeCloseTo(
      cf.operatingActivities.total + cf.financingActivities.total, 2
    );
  });
});

describe('generateProfitLossAndCashFlow', () => {
  it('returns both PL and CF structures', async () => {
    const { pl, cf } = await generateProfitLossAndCashFlow(
      [makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl).toHaveProperty('totalExpenses');
    expect(cf).toHaveProperty('netCashFlow');
  });

  it('PL totalExpenses = operating + financing', async () => {
    const { pl } = await generateProfitLossAndCashFlow(
      [makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl.totalExpenses).toBeCloseTo(
      pl.operatingExpenses.total + pl.financingCosts.interestExpense, 2
    );
  });

  it('CF netCashFlow = operating + financing', async () => {
    const { cf } = await generateProfitLossAndCashFlow(
      [makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(cf.netCashFlow).toBeCloseTo(
      cf.operatingActivities.total + cf.financingActivities.total, 2
    );
  });
});

/**
 * Custom supabase mock that can return specific data for the lease_transactions table.
 * When from('lease_transactions') is called, returns the configured termModData.
 * Otherwise falls back to the empty chainableMock.
 */
function makeMockWithTermModData(termModData: unknown[]) {
  const empty = chainableMock();
  const chainableWithData = {
    ...empty,
    in: () => chainableWithData,
    gte: () => chainableWithData,
    lte: () => chainableWithData,
    select: () => chainableWithData,
    eq: () => chainableWithData,
    not: () => chainableWithData,
    order: () => chainableWithData,
    range: () => Promise.resolve({ data: termModData, error: null }),
    limit: () => Promise.resolve({ data: [] }),
    single: () => Promise.resolve({ data: null }),
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: termModData }),
  };

  const fromSpy = vi.fn((table: string) => {
    if (table === 'lease_transactions') return chainableWithData;
    return empty;
  });

  return { from: fromSpy };
}

describe('Termination/modification entries in financial reports', () => {
  it('P&L shows 500 loss for an operating lease terminated with 500 penalty', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      {
        lease_id: 'lease-1',
        transaction_date: '2026-06-15',
        transaction_type: 'termination',
        account_debited: 'Loss on Lease Termination',
        account_credited: 'Cash',
        amount: 500,
      },
    ]).from;

    const lease = makeLease({ lease_classification: 'operating' });
    const pl = await generateProfitLoss([lease], new Date(2026, 0, 1), new Date(2026, 11, 31));

    expect(pl.gainLossOnTermination.loss).toBe(500);
    expect(pl.gainLossOnTermination.net).toBe(-500);
  });

  it('Cash flow shows 500 cash out for the termination penalty', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      {
        lease_id: 'lease-1',
        transaction_date: '2026-06-15',
        transaction_type: 'termination',
        account_debited: 'Loss on Lease Termination',
        account_credited: 'Cash',
        amount: 500,
      },
    ]).from;

    const lease = makeLease({ lease_classification: 'operating' });
    const cf = await generateCashFlow([lease], new Date(2026, 0, 1), new Date(2026, 11, 31));

    expect(cf.operatingActivities.terminationCashPaid).toBe(500);
  });

  it('P&L shows gain on lease modification from lease_transactions', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      {
        lease_id: 'lease-1',
        transaction_date: '2026-06-01',
        transaction_type: 'modification',
        account_debited: 'Lease Liability',
        account_credited: 'Gain on Lease Modification',
        amount: 1000,
      },
    ]).from;

    const lease = makeLease({ lease_classification: 'operating' });
    const pl = await generateProfitLoss([lease], new Date(2026, 0, 1), new Date(2026, 11, 31));

    expect(pl.gainLossOnTermination.gain).toBe(1000);
  });
});
