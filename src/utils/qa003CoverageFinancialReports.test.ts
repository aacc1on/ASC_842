import { describe, it, expect, vi } from 'vitest';
import {
  generateBalanceSheet,
  computeMaturityAnalysis,
  generateProfitLoss,
  generateCashFlow,
  generateProfitLossAndCashFlow,
  computeLeaseCostDisclosure,
  fetchRemainingLiabilityFromSchedule,
  computeLeaseBalancesByType,
} from './financialReports';
import type { Lease } from '../types/lease';
import { chainableMock } from './testSupabaseMock';

const balanceSource = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('../lib/supabase', async () => {
  const { balancesFromScheduleRows: oracle } = await import('./testSupabaseMock');
  return {
    supabase: {
      from: () => chainableMock(),
      rpc: (_fn: string, args: { p_as_of: string; p_lease_ids: string[] }) =>
        Promise.resolve({ data: oracle(balanceSource.rows, args.p_lease_ids, args.p_as_of), error: null }),
    },
  };
});

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01T00:00:00.000Z',
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
  } as Lease;
}

/**
 * Mock that returns schedule data for amortization_schedules queries
 * and ledger data for lease_transactions queries.
 */
function postedMonthEndRows(scheduleData: unknown[]) {
  return (scheduleData as { lease_id?: string; period_date?: string }[])
    .filter((r) => r.lease_id && r.period_date)
    .map((r) => ({ lease_id: r.lease_id, transaction_date: r.period_date, month_end_document_id: 'me-doc' }));
}

function makeMockWithScheduleData(scheduleData: unknown[], ledgerData: unknown[] = [], monthEndPosted = true) {
  balanceSource.rows = scheduleData;
  const empty = chainableMock();
  const scheduleChain = {
    ...empty,
    select: () => scheduleChain,
    eq: () => scheduleChain,
    in: () => scheduleChain,
    gte: () => scheduleChain,
    lte: () => scheduleChain,
    not: () => scheduleChain,
    order: () => scheduleChain,
    range: () => Promise.resolve({ data: scheduleData, error: null }),
    limit: () => Promise.resolve({ data: scheduleData, error: null }),
    single: () => Promise.resolve({ data: scheduleData[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: scheduleData[0] ?? null, error: null }),
  };
  const ledgerChain = {
    ...empty,
    select: () => ledgerChain,
    eq: () => ledgerChain,
    in: () => ledgerChain,
    gte: () => ledgerChain,
    lte: () => ledgerChain,
    not: () => ledgerChain,
    order: () => ledgerChain,
    range: () => Promise.resolve({ data: ledgerData, error: null }),
    limit: () => Promise.resolve({ data: ledgerData, error: null }),
  };
  const monthEndRows = monthEndPosted ? postedMonthEndRows(scheduleData) : [];
  const transactionsChain = {
    ...ledgerChain,
    select: () => transactionsChain,
    eq: () => transactionsChain,
    in: () => transactionsChain,
    gte: () => transactionsChain,
    lte: () => transactionsChain,
    not: () => transactionsChain,
    order: () => transactionsChain,
    range: () => Promise.resolve({ data: [...ledgerData, ...monthEndRows], error: null }),
  };
  const fromSpy = vi.fn((table: string) => {
    if (table === 'amortization_schedules') return scheduleChain;
    if (table === 'lease_transactions') return ledgerChain;
    if (table === 'transactions') return transactionsChain;
    return empty;
  });
  return { from: fromSpy };
}

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

const baseScheduleRow = {
  lease_id: 'lease-1',
  period_date: '2026-03-01',
  rou_asset_balance: 28000,
  ending_liability: 30000,
  depreciation_expense: 800,
  interest_expense: 150,
  payment_amount: 1000,
  principal_reduction: 850,
  short_term_lease_cost: 0,
};

// Appends a far-future period per lease so the lease is still running on the report date.
function stillRunning<T extends { lease_id: string }>(rows: T[]): T[] {
  const ids = [...new Set(rows.map((r) => r.lease_id))];
  const all = [...rows, ...ids.map((id) => ({ ...rows.find((r) => r.lease_id === id)!, period_date: '2028-12-01' }))];
  return ids.flatMap((id) => all.filter((r) => r.lease_id === id).map((r, i) => ({ ...r, period_number: i + 1 })));
}

const baseLedgerRow = {
  lease_id: 'lease-1',
  transaction_date: '2026-01-01',
  transaction_type: 'initial_recognition',
  account_debited: 'Right-of-Use Asset',
  account_credited: 'Lease Liability',
  amount: 32871.02,
};

describe('generateBalanceSheet — additional branches', () => {
  it('handles multiple active leases with schedule and ledger data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([
        { ...baseScheduleRow, lease_id: 'l1', rou_asset_balance: 28000, ending_liability: 29000 },
        { ...baseScheduleRow, lease_id: 'l2', rou_asset_balance: 18000, ending_liability: 19000 },
      ]),
      [
        { ...baseLedgerRow, lease_id: 'l1', amount: 30000 },
        { ...baseLedgerRow, lease_id: 'l2', amount: 20000 },
      ]
    ).from;
    const leases = [
      makeLease({ id: 'l1', rou_asset: 30000, lease_liability: 30000 }),
      makeLease({ id: 'l2', rou_asset: 20000, lease_liability: 20000 }),
    ];
    const bs = await generateBalanceSheet(leases, new Date(2026, 6, 1));
    expect(bs.assets.currentRouAsset).toBeGreaterThan(0);
    expect(bs.liabilities.totalLiability).toBeGreaterThan(0);
  });

  it('handles empty lease list', async () => {
    const bs = await generateBalanceSheet([], new Date(2026, 6, 1));
    expect(bs.assets.currentRouAsset).toBe(0);
    expect(bs.liabilities.totalLiability).toBe(0);
  });

  it('handles operating lease classification', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [baseScheduleRow],
      [baseLedgerRow]
    ).from;
    const bs = await generateBalanceSheet(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 6, 1)
    );
    expect(bs).toHaveProperty('assets');
    expect(bs).toHaveProperty('liabilities');
  });

  it('handles lease with future start date (not yet commenced)', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [], []
    ).from;
    const bs = await generateBalanceSheet(
      [makeLease({ lease_start_date: '2027-01-01T00:00:00.000Z', status: 'active' })],
      new Date(2026, 6, 1)
    );
    expect(bs).toHaveProperty('assets');
  });

  it('handles lease with prepaid payments in balance sheet', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([{ ...baseScheduleRow, rou_asset_balance: 33000, ending_liability: 32871 }]),
      [{ ...baseLedgerRow, amount: 37871 }]
    ).from;
    const bs = await generateBalanceSheet(
      [makeLease({ prepaid_lease_payments: 5000, rou_asset: 37871, lease_liability: 32871 })],
      new Date(2026, 6, 1)
    );
    expect(bs.assets.currentRouAsset).toBeGreaterThan(0);
  });
});

describe('generateProfitLoss — additional branches', () => {
  it('handles empty lease list', async () => {
    const pl = await generateProfitLoss([], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.totalExpenses).toBe(0);
    expect(pl.netIncome).toBe(0);
  });

  it('handles operating lease classification with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 900, interest_expense: 150, payment_amount: 1000 }],
      []
    ).from;
    const pl = await generateProfitLoss(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl).toHaveProperty('operatingExpenses');
    expect(pl.operatingExpenses.leaseExpense).toBeGreaterThan(0);
  });

  it('handles finance lease with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 800, interest_expense: 150, payment_amount: 1000 }],
      []
    ).from;
    const pl = await generateProfitLoss(
      [makeLease({ lease_classification: 'finance' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl.operatingExpenses.depreciationExpense).toBeGreaterThan(0);
    expect(pl.financingCosts.interestExpense).toBeGreaterThan(0);
  });

  it('handles multiple leases with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [
        { ...baseScheduleRow, lease_id: 'l1', depreciation_expense: 800, interest_expense: 150 },
        { ...baseScheduleRow, lease_id: 'l2', depreciation_expense: 600, interest_expense: 100 },
      ],
      []
    ).from;
    const leases = [
      makeLease({ id: 'l1' }),
      makeLease({ id: 'l2', payment_amount: 2000 }),
    ];
    const pl = await generateProfitLoss(leases, new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.totalExpenses).toBeGreaterThan(0);
  });

  it('handles lease outside the reporting period (no schedule data)', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [], []
    ).from;
    const pl = await generateProfitLoss(
      [makeLease({ lease_start_date: '2027-01-01T00:00:00.000Z' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl).toHaveProperty('totalExpenses');
  });

  it('gainLossOnTermination defaults to zero when no termination transactions', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 800, interest_expense: 150 }],
      []
    ).from;
    const pl = await generateProfitLoss([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.gainLossOnTermination.net).toBe(0);
  });

  it('handles both gain and loss in the same period', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      { lease_id: 'lease-1', transaction_date: '2026-03-01', transaction_type: 'termination', account_debited: 'Loss on Lease Termination', account_credited: 'Cash', amount: 300 },
      { lease_id: 'lease-1', transaction_date: '2026-06-01', transaction_type: 'modification', account_debited: 'Lease Liability', account_credited: 'Gain on Lease Modification', amount: 700 },
    ]).from;
    const pl = await generateProfitLoss([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.gainLossOnTermination.loss).toBe(300);
    expect(pl.gainLossOnTermination.gain).toBe(700);
    expect(pl.gainLossOnTermination.net).toBe(400);
  });

  it('handles short-term lease exemption classification', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, short_term_lease_cost: 500, payment_amount: 500 }],
      []
    ).from;
    const pl = await generateProfitLoss(
      [makeLease({ accounting_treatment: 'short_term_exemption' } as Partial<Lease>)],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl.operatingExpenses.shortTermLeaseCost).toBeGreaterThan(0);
  });
});

describe('generateCashFlow — additional branches', () => {
  it('handles empty lease list', async () => {
    const cf = await generateCashFlow([], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(cf.netCashFlow).toBeCloseTo(0, 5);
  });

  it('handles operating lease with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, payment_amount: 1000, interest_expense: 150, principal_reduction: 850 }],
      []
    ).from;
    const cf = await generateCashFlow(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(cf.operatingActivities.leasePayments).toBeGreaterThan(0);
  });

  it('handles finance lease with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, payment_amount: 1000, interest_expense: 150, principal_reduction: 850 }],
      []
    ).from;
    const cf = await generateCashFlow(
      [makeLease({ lease_classification: 'finance' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(cf.financingActivities.principalPayments).toBeGreaterThan(0);
    expect(cf.operatingActivities.interestPaid).toBeGreaterThan(0);
  });

  it('handles termination cash inflow (gain)', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      { lease_id: 'lease-1', transaction_date: '2026-06-01', transaction_type: 'termination', account_debited: 'Cash', account_credited: 'Gain on Lease Termination', amount: 500 },
    ]).from;
    const cf = await generateCashFlow([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(cf).toHaveProperty('operatingActivities');
  });

  it('handles modification cash flow entry', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithTermModData([
      { lease_id: 'lease-1', transaction_date: '2026-06-01', transaction_type: 'modification', account_debited: 'Cash', account_credited: 'Lease Liability', amount: 2000 },
    ]).from;
    const cf = await generateCashFlow([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(cf).toHaveProperty('financingActivities');
  });

  it('handles short-term lease exemption in cash flow', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, payment_amount: 500, short_term_lease_cost: 500 }],
      []
    ).from;
    const cf = await generateCashFlow(
      [makeLease({ accounting_treatment: 'short_term_exemption' } as Partial<Lease>)],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(cf.operatingActivities.shortTermLeasePayments).toBeGreaterThan(0);
  });
});

describe('generateProfitLossAndCashFlow — additional branches', () => {
  it('handles empty lease list', async () => {
    const { pl, cf } = await generateProfitLossAndCashFlow([], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.totalExpenses).toBe(0);
    expect(cf.netCashFlow).toBeCloseTo(0, 5);
  });

  it('handles operating lease with schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 900, interest_expense: 150, payment_amount: 1000, principal_reduction: 850 }],
      []
    ).from;
    const { pl, cf } = await generateProfitLossAndCashFlow(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl.operatingExpenses.leaseExpense).toBeGreaterThan(0);
    expect(cf.operatingActivities.leasePayments).toBeGreaterThan(0);
  });

  it('handles mixed finance and operating leases', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [
        { ...baseScheduleRow, lease_id: 'l1', depreciation_expense: 800, interest_expense: 150, payment_amount: 1000, principal_reduction: 850 },
        { ...baseScheduleRow, lease_id: 'l2', depreciation_expense: 900, interest_expense: 100, payment_amount: 1500, principal_reduction: 1400 },
      ],
      []
    ).from;
    const leases = [
      makeLease({ id: 'l1', lease_classification: 'finance' }),
      makeLease({ id: 'l2', lease_classification: 'operating', payment_amount: 1500 }),
    ];
    const { pl, cf } = await generateProfitLossAndCashFlow(leases, new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(pl.totalExpenses).toBeGreaterThan(0);
    expect(cf.netCashFlow).toBeLessThanOrEqual(0);
  });
});

describe('computeLeaseCostDisclosure', () => {
  it('returns well-formed disclosure structure', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 800, interest_expense: 150, payment_amount: 1000, principal_reduction: 850 }],
      []
    ).from;
    const result = await computeLeaseCostDisclosure([makeLease()], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(result).toHaveProperty('operatingLeaseCost');
    expect(result).toHaveProperty('financeLeaseCost');
    expect(result).toHaveProperty('shortTermLeaseCost');
    expect(result).toHaveProperty('variableLeaseCost');
    expect(result).toHaveProperty('totalLeaseCost');
  });

  it('handles empty lease list', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData([], []).from;
    const result = await computeLeaseCostDisclosure([], new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(result.totalLeaseCost).toBe(0);
  });

  it('handles operating lease cost', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 900, interest_expense: 150, payment_amount: 1000 }],
      [{ ...baseLedgerRow, amount: 32871 }]
    ).from;
    const result = await computeLeaseCostDisclosure(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(result.operatingLeaseCost).toBeGreaterThan(0);
  });

  it('handles finance lease cost', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, depreciation_expense: 800, interest_expense: 150, payment_amount: 1000, principal_reduction: 850 }],
      [{ ...baseLedgerRow, amount: 32871 }]
    ).from;
    const result = await computeLeaseCostDisclosure(
      [makeLease({ lease_classification: 'finance' })],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(result.financeLeaseCost).toBeGreaterThan(0);
  });

  it('handles short-term lease exemption', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [{ ...baseScheduleRow, short_term_lease_cost: 500, payment_amount: 500 }],
      []
    ).from;
    const result = await computeLeaseCostDisclosure(
      [makeLease({ accounting_treatment: 'short_term_exemption' } as Partial<Lease>)],
      new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(result.shortTermLeaseCost).toBeGreaterThan(0);
  });
});

describe('fetchRemainingLiabilityFromSchedule', () => {
  it('returns empty Map for empty lease IDs', async () => {
    const result = await fetchRemainingLiabilityFromSchedule([], new Date(2026, 6, 1));
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns the liability as of the date: end-timing payment not yet deducted on the 1st', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([
        { lease_id: 'lease-1', period_date: '2026-06-01', beginning_liability: 25900, payment_amount: 1000, ending_liability: 25000 },
        { lease_id: 'lease-1', period_date: '2026-07-01', beginning_liability: 25000, payment_amount: 1000, ending_liability: 24100 },
      ]),
      []
    ).from;
    const lease = makeLease();
    expect((await fetchRemainingLiabilityFromSchedule([lease], new Date(2026, 6, 1))).get('lease-1')).toBe(25000);
    expect((await fetchRemainingLiabilityFromSchedule([lease], new Date(2026, 6, 31))).get('lease-1')).toBe(24100);
  });

  it('returns empty Map when no schedule data', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData([], []).from;
    const result = await fetchRemainingLiabilityFromSchedule([makeLease()], new Date(2026, 6, 1));
    expect(result.size).toBe(0);
  });
});

describe('computeLeaseBalancesByType', () => {
  it('returns balances with finance and operating fields', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [
        { lease_id: 'l1', period_date: '2026-06-01', rou_asset_balance: 28000, ending_liability: 29000 },
        { lease_id: 'l2', period_date: '2026-06-01', rou_asset_balance: 18000, ending_liability: 19000 },
      ],
      [
        { lease_id: 'l1', transaction_date: '2026-01-01', transaction_type: 'initial_recognition', account_debited: 'Right-of-Use Asset', account_credited: 'Lease Liability', amount: 30000 },
        { lease_id: 'l2', transaction_date: '2026-01-01', transaction_type: 'initial_recognition', account_debited: 'Right-of-Use Asset', account_credited: 'Lease Liability', amount: 20000 },
      ]
    ).from;
    const leases = [
      makeLease({ id: 'l1', lease_classification: 'finance', rou_asset: 30000, lease_liability: 30000 }),
      makeLease({ id: 'l2', lease_classification: 'operating', rou_asset: 20000, lease_liability: 20000 }),
    ];
    const result = await computeLeaseBalancesByType(leases, new Date(2026, 6, 1));
    expect(result).toHaveProperty('financeRouAsset');
    expect(result).toHaveProperty('operatingRouAsset');
    expect(result).toHaveProperty('totalRouAsset');
    expect(result).toHaveProperty('totalLiability');
  });

  it('handles empty lease list', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData([], []).from;
    const result = await computeLeaseBalancesByType([], new Date(2026, 6, 1));
    expect(result.financeRouAsset).toBe(0);
    expect(result.operatingRouAsset).toBe(0);
    expect(result.totalRouAsset).toBe(0);
  });

  it('handles all finance leases', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([{ lease_id: 'lease-1', period_date: '2026-06-01', rou_asset_balance: 28000, ending_liability: 29000 }]),
      [{ lease_id: 'lease-1', transaction_date: '2026-01-01', transaction_type: 'initial_recognition', account_debited: 'Right-of-Use Asset', account_credited: 'Lease Liability', amount: 32871 }]
    ).from;
    const result = await computeLeaseBalancesByType(
      [makeLease({ lease_classification: 'finance' })],
      new Date(2026, 6, 1)
    );
    expect(result.financeRouAsset).toBeGreaterThan(0);
    expect(result.operatingRouAsset).toBe(0);
  });

  it('handles all operating leases', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([{ lease_id: 'lease-1', period_date: '2026-06-01', rou_asset_balance: 28000, ending_liability: 29000 }]),
      [{ lease_id: 'lease-1', transaction_date: '2026-01-01', transaction_type: 'initial_recognition', account_debited: 'Right-of-Use Asset', account_credited: 'Lease Liability', amount: 32871 }]
    ).from;
    const result = await computeLeaseBalancesByType(
      [makeLease({ lease_classification: 'operating' })],
      new Date(2026, 6, 1)
    );
    expect(result.operatingRouAsset).toBeGreaterThan(0);
    expect(result.financeRouAsset).toBe(0);
  });
});

describe('reports compute from schedules as of the report date, posted or not', () => {
  it('P&L and cash flow include completed periods even when month-end is not posted', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [baseScheduleRow], [], false
    ).from;
    const { pl } = await generateProfitLossAndCashFlow(
      [makeLease({ id: 'lease-1' })], new Date(2026, 0, 1), new Date(2026, 11, 31)
    );
    expect(pl.operatingExpenses.depreciationExpense).toBe(800);
    expect(pl.financingCosts.interestExpense).toBe(150);
  });

  it('P&L excludes a period whose month has not ended by the report date', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      [baseScheduleRow], [], false
    ).from;
    const { pl } = await generateProfitLossAndCashFlow(
      [makeLease({ id: 'lease-1' })], new Date(2026, 0, 1), new Date(2026, 2, 15)
    );
    expect(pl.operatingExpenses.depreciationExpense).toBe(0);
  });

  it('balance sheet uses the schedule balance even when month-end is not posted', async () => {
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(
      stillRunning([baseScheduleRow]), [{ ...baseLedgerRow, amount: 32871.02 }], false
    ).from;
    const bs = await generateBalanceSheet(
      [makeLease({ id: 'lease-1', rou_asset: 32871.02, lease_liability: 32871.02 })], new Date(2026, 5, 30)
    );
    expect(bs.assets.netRouAsset).toBe(28000);
    // Gross ROU comes from the schedule at commencement, never from the posted ledger (32,871.02).
    expect(bs.assets.currentRouAsset).toBe(28800);
    expect(bs.assets.accumulatedDepreciation).toBe(800);
    expect(bs.assets.accumulatedAmortizationFinance + bs.assets.accumulatedAmortizationOperating).toBe(800);
    expect(bs.assets.currentRouAsset - bs.assets.accumulatedDepreciation - bs.assets.impairment).toBe(bs.assets.netRouAsset);
    expect(bs.liabilities.totalLiability).toBe(30000);
    expect(bs.liabilities.currentPortion + bs.liabilities.longTermPortion).toBeCloseTo(30000, 2);
  });
});

describe('maturity analysis ties to the balance sheet liability (C / H3)', () => {
  function financeSchedule(leaseId: string) {
    const r = 0.06 / 12;
    let bal = 1000 * (1 - Math.pow(1 + r, -24)) / r;
    let rou = bal;
    const dep = bal / 24;
    return Array.from({ length: 24 }, (_, i) => {
      const begin = Math.round(bal * 100) / 100;
      const interest = Math.round(bal * r * 100) / 100;
      bal = bal + bal * r - 1000;
      rou -= dep;
      const d = new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 10);
      return {
        lease_id: leaseId, period_number: i + 1, period_date: d,
        beginning_liability: begin, interest_expense: interest, payment_amount: 1000,
        principal_reduction: Math.round((1000 - interest) * 100) / 100,
        ending_liability: i === 23 ? 0 : Math.round(bal * 100) / 100,
        depreciation_expense: Math.round(dep * 100) / 100,
        rou_asset_balance: i === 23 ? 0 : Math.round(rou * 100) / 100,
        short_term_lease_cost: 0,
      };
    });
  }

  it('total undiscounted minus imputed interest equals the current liability, bucketed from the report date', async () => {
    const rows = financeSchedule('m1');
    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(rows).from;
    const lease = makeLease({
      id: 'm1', lease_classification: 'finance', payment_timing: 'end', payment_amount: 1000,
      lease_start_date: '2026-01-01', lease_end_date: '2027-12-31', lease_term_months: 24,
    });
    const asOf = new Date(2026, 5, 30);
    const m = await computeMaturityAnalysis([lease], asOf);
    const balances = await computeLeaseBalancesByType([lease], asOf);
    const liab = rows[5].ending_liability;
    expect(m.finance.liabilitySum).toBeCloseTo(liab, 2);
    expect(m.finance.y1).toBe(12000);
    expect(m.finance.y2).toBe(6000);
    expect(m.finance.totalUndiscounted).toBe(18000);
    expect(m.finance.totalUndiscounted - m.finance.imputedInterest).toBeCloseTo(m.finance.liabilitySum, 2);
    expect(balances.financeLiabilityCurrent + balances.financeLiabilityNoncurrent).toBeCloseTo(m.finance.liabilitySum, 2);
    expect(m.operating.totalUndiscounted).toBe(0);
  });
});
