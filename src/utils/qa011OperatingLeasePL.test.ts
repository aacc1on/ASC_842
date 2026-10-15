import { describe, it, expect, vi } from 'vitest';
import { generateProfitLoss } from './financialReports';
import type { Lease } from '../types/lease';
import { chainableMock } from './testSupabaseMock';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => chainableMock(),
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
    lease_end_date: '2027-12-31',
    lease_term_months: 24,
    payment_amount: 2500,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 5,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 56882.50,
    lease_liability: 56882.50,
    status: 'active',
    payment_timing: 'end',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 60000,
    asset_market_value: 60000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classated: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Lease;
}

/**
 * Custom mock that returns schedule data for amortization_schedules queries.
 */
function makeMockWithScheduleData(scheduleData: unknown[]) {
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
    range: () => Promise.resolve({ data: scheduleData }),
    limit: () => Promise.resolve({ data: scheduleData }),
    single: () => Promise.resolve({ data: null }),
    maybeSingle: () => Promise.resolve({ data: null }),
  };

  const monthEndRows = (scheduleData as { lease_id: string; period_date: string }[]).map((r) => ({
    lease_id: r.lease_id,
    transaction_date: r.period_date,
    month_end_document_id: 'me-doc',
  }));
  const monthEndChain = {
    ...chainableWithData,
    in: () => monthEndChain,
    lte: () => monthEndChain,
    select: () => monthEndChain,
    not: () => monthEndChain,
    range: () => Promise.resolve({ data: monthEndRows }),
  };

  const fromSpy = vi.fn((table: string) => {
    if (table === 'amortization_schedules') return chainableWithData;
    if (table === 'transactions') return monthEndChain;
    return empty;
  });

  return { from: fromSpy };
}

describe('QA-011: P&L uses interest+depreciation for operating leases, not payment_amount', () => {
  it('24-month operating lease paying 2000/yr1 and 3000/yr2 shows year-1 cost = interest+dep, not payment', async () => {
    const supabaseMod = await import('../lib/supabase');

    // Build 12 schedule rows for year 1 with payment_amount=2000 but
    // interest_expense + depreciation_expense = 2500 (the straight-line
    // single lease cost).
    const year1Rows = Array.from({ length: 12 }, (_, i) => ({
      lease_id: 'lease-1',
      period_date: `2026-${String(i + 1).padStart(2, '0')}-01`,
      depreciation_expense: 2000,
      interest_expense: 500,
      payment_amount: 2000,
      principal_reduction: 0,
      short_term_lease_cost: 0,
    }));

    (supabaseMod.supabase as unknown as { from: unknown }).from = makeMockWithScheduleData(year1Rows).from;

    const lease = makeLease({
      lease_classification: 'operating',
      payment_amount: 2000,
      lease_term_months: 24,
    });

    const pl = await generateProfitLoss(
      [lease],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    // Year 1: 12 rows × (2000 + 500) = 30000, not 12 × 2000 = 24000
    expect(pl.operatingExpenses.leaseExpense).toBe(30000);
    expect(pl.operatingExpenses.leaseExpense).not.toBe(24000);
  });
});
