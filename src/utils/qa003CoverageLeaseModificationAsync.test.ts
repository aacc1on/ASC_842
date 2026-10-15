import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyImpairment,
  applyModification,
  applyCancellation,
  getCarryingAmountsAtDate,
} from './leaseModification';
import type { Lease } from '../types/lease';

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

// A single chainable that handles all methods: select/eq/gt/in/order/range/limit/single/insert/update/delete
// Each returns either the chainable (for chaining) or a Promise (for terminal await).
function makeChainable(opts: {
  data?: unknown[];
  error?: unknown;
  singleData?: unknown;
  count?: number;
} = {}) {
  const data = opts.data ?? [];
  const error = opts.error ?? null;
  const singleData = opts.singleData ?? (data.length > 0 ? data[0] : null);
  const count = opts.count ?? data.length;

  const chain: Record<string, unknown> = {};

  const chainable = () => chain;
  chain.select = chainable;
  chain.eq = chainable;
  chain.gt = chainable;
  chain.gte = chainable;
  chain.lt = chainable;
  chain.lte = chainable;
  chain.in = chainable;
  chain.not = chainable;
  chain.order = chainable;
  chain.range = () => Promise.resolve({ data, error });
  chain.limit = () => Promise.resolve({ data, error });
  chain.single = () => Promise.resolve({ data: singleData, error });
  chain.maybeSingle = () => Promise.resolve({ data: singleData, error });
  chain.insert = () => Promise.resolve({ error });
  chain.update = chainable;
  chain.delete = chainable;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error, count });

  return chain;
}

// hasPostedMonthEnd: select('id', {count, head}).eq(org).eq(lease).not().gte() → { count }
function postedCountQuery(count: number) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.gte = () => Promise.resolve({ count });
  return chain;
}

function setMock(tableData: Record<string, { data?: unknown[]; singleData?: unknown; error?: unknown }> = {}) {
  return async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'transactions') {
        return postedCountQuery(0);
      }
      if (table in tableData) {
        const config = tableData[table];
        return makeChainable({
          data: config.data,
          singleData: config.singleData,
          error: config.error,
        });
      }
      return makeChainable();
    }) as ReturnType<typeof vi.fn>;
  };
}

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
    lease_end_date: '2028-12-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    discount_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'beginning',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Lease;
}

const scheduleRows = [
  { period_number: 1, period_date: '2026-02-01', rou_asset_balance: 32000, ending_liability: 31000 },
  { period_number: 2, period_date: '2026-03-01', rou_asset_balance: 30000, ending_liability: 29500 },
  { period_number: 3, period_date: '2026-04-01', rou_asset_balance: 28000, ending_liability: 28000 },
  { period_number: 4, period_date: '2026-05-01', rou_asset_balance: 26000, ending_liability: 26500 },
  { period_number: 5, period_date: '2026-06-01', rou_asset_balance: 24000, ending_liability: 25000 },
];

const fullScheduleRows = [
  ...scheduleRows,
  {
    period_number: 6, period_date: '2026-07-01', beginning_liability: 25000,
    payment_amount: 1000, interest_expense: 125, principal_reduction: 875,
    ending_liability: 24125, rou_asset_balance: 22000, depreciation_expense: 2000,
  },
  {
    period_number: 7, period_date: '2026-08-01', beginning_liability: 24125,
    payment_amount: 1000, interest_expense: 120.63, principal_reduction: 879.37,
    ending_liability: 23245.63, rou_asset_balance: 20000, depreciation_expense: 2000,
  },
];

function setMonthEndBlocked(blocked: boolean) {
  return async () => {
    const { supabase } = await import('../lib/supabase');
    const baseMock = (table: string) => {
      if (table === 'transactions') {
        return postedCountQuery(blocked ? 5 : 0);
      }
      return makeChainable();
    };
    // Override only the transactions behavior, keep other table data
    const existingFrom = (supabase as unknown as { from: (table: string) => unknown }).from;
    const newFrom = vi.fn((table: string) => {
      if (table === 'transactions') return baseMock(table);
      return existingFrom(table);
    });
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = newFrom;
  };
}

describe('getCarryingAmountsAtDate', () => {
  it('returns carrying amounts at the last completed period before target date', async () => {
    await setMock({
      amortization_schedules: { data: scheduleRows as unknown[] },
    })();
    const result = await getCarryingAmountsAtDate('lease-1', '2026-05-15');
    expect(result.periodsCompleted).toBe(4);
    expect(result.rouAsset).toBe(26000);
    expect(result.leaseLiability).toBe(26500);
  });

  it('throws when no schedule rows exist', async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn(() => makeChainable({ data: [] }));
    await expect(getCarryingAmountsAtDate('lease-1', '2026-05-15')).rejects.toThrow(
      'No amortization schedule found for this lease'
    );
  });

  it('throws when modification date is before any payment period', async () => {
    await setMock({
      amortization_schedules: { data: scheduleRows as unknown[] },
    })();
    await expect(getCarryingAmountsAtDate('lease-1', '2025-01-01')).rejects.toThrow(
      'Modification date must be after at least one payment period'
    );
  });
});

describe('applyImpairment', () => {
  beforeEach(async () => {
    await setMock({
      lease_impairments: { data: [], singleData: { posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
  });

  it('throws when impairment has already been posted', async () => {
    await setMock({
      lease_impairments: { data: [], singleData: { posted: true } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 5000, 'test reason', 'user-1')
    ).rejects.toThrow('Impairment has already been applied.');
  });

  it('throws when month-end entries are posted after impairment date', async () => {
    await setMock({
      lease_impairments: { data: [], singleData: { posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await setMonthEndBlocked(true)();
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 5000, 'test', 'user-1')
    ).rejects.toThrow('Month-end entries are already posted');
  });

  it('throws when impairment amount is <= 0', async () => {
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 0, 'test', 'user-1')
    ).rejects.toThrow('Impairment amount must be greater than zero.');
  });

  it('throws when impairment amount exceeds carrying ROU', async () => {
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 999999, 'test', 'user-1')
    ).rejects.toThrow('exceeds the carrying ROU asset amount');
  });

  it('throws when no schedule rows exist after carrying date', async () => {
    // At 2026-06-15, all 5 schedule rows are before the target date,
    // so periodsCompleted = 5. The .gt('period_number', 5) query returns
    // no rows — we simulate this by having the mock return data only for
    // the first query (getCarryingAmountsAtDate) and empty for subsequent
    // queries (the .gt() filtered query).
    let callCount = 0;
    const { supabase } = await import('../lib/supabase');
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'transactions') {
        return postedCountQuery(0);
      }
      if (table === 'lease_impairments') {
        return makeChainable({ singleData: { posted: false } });
      }
      if (table === 'amortization_schedules') {
        callCount++;
        // First call: getCarryingAmountsAtDate uses .limit(5000) — return all rows
        // Second call: .gt('period_number', 5) query — return empty
        if (callCount === 1) {
          return makeChainable({ data: scheduleRows as unknown[] });
        }
        return makeChainable({ data: [] });
      }
      return makeChainable();
    });
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 1000, 'test', 'user-1')
    ).rejects.toThrow('No remaining amortization schedule rows found');
  });

  it('successfully applies impairment and returns result', async () => {
    await setMock({
      lease_impairments: { data: [], singleData: { posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const result = await applyImpairment('imp-1', makeLease(), '2026-06-15', 5000, 'test reason', 'user-1');
    expect(result).toHaveProperty('rouBefore');
    expect(result).toHaveProperty('rouAfter');
    expect(result.impairmentAmount).toBe(5000);
    expect(result.rouAfter).toBeLessThan(result.rouBefore);
    expect(result.remainingSchedule.length).toBeGreaterThan(0);
  });

  it('throws on schedule fetch error', async () => {
    await setMock({
      lease_impairments: { data: [], singleData: { posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[], error: { message: 'fetch failed' } },
    })();
    // The error comes from .gt().order() which is not a terminal — it's awaited via .then
    // Actually the schedule fetch uses .eq().gt().order() which returns a thenable
    // Let's check: the code does `const { data: existingRows, error: schedFetchError } = await supabase.from('amortization_schedules').select(...).eq(...).gt(...).order(...)`
    // This is awaited, so .order() returns a thenable. makeChainable's .order() returns the chain, which has .then()
    // The .then resolves with { data, error, count }
    await expect(
      applyImpairment('imp-1', makeLease(), '2026-06-15', 5000, 'test', 'user-1')
    ).rejects.toThrow();
  });
});

describe('applyModification', () => {
  it('throws when modification has already been applied', async () => {
    await setMock({
      contract_modifications: { data: [], singleData: { accounting_posted: true } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await expect(
      applyModification('mod-1', makeLease(), '2026-06-15', 1200, 24, 6, 'user-1')
    ).rejects.toThrow('Modification has already been applied.');
  });

  it('throws when month-end entries are posted after modification date', async () => {
    await setMock({
      contract_modifications: { data: [], singleData: { accounting_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await setMonthEndBlocked(true)();
    await expect(
      applyModification('mod-1', makeLease(), '2026-06-15', 1200, 24, 6, 'user-1')
    ).rejects.toThrow('Month-end entries are already posted');
  });

  it('handles separate contract (no remeasurement)', async () => {
    await setMock({
      contract_modifications: { data: [], singleData: { accounting_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const result = await applyModification(
      'mod-1', makeLease(), '2026-06-15', 1200, 24, 6, 'user-1', true
    );
    expect(result.newRouAsset).toBe(0);
    expect(result.newLiability).toBe(0);
    expect(result.remainingSchedule).toEqual([]);
  });

  it('successfully applies modification and returns result', async () => {
    await setMock({
      contract_modifications: { data: [], singleData: { accounting_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const result = await applyModification(
      'mod-1', makeLease(), '2026-06-15', 1200, 24, 6, 'user-1'
    );
    expect(result).toHaveProperty('newLiability');
    expect(result).toHaveProperty('newRouAsset');
    expect(result).toHaveProperty('remainingSchedule');
    expect(result.remainingSchedule.length).toBeGreaterThan(0);
  });

  it('handles modification with same payment (small liability change)', async () => {
    await setMock({
      contract_modifications: { data: [], singleData: { accounting_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const result = await applyModification(
      'mod-1', makeLease(), '2026-06-15', 1000, 30, 6, 'user-1'
    );
    expect(result).toHaveProperty('newLiability');
  });
});

describe('applyCancellation', () => {
  it('throws when cancellation has already been applied', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: true } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await expect(
      applyCancellation('can-1', makeLease(), '2026-06-15', 1000, 500, 'user-1')
    ).rejects.toThrow('Cancellation has already been applied.');
  });

  it('throws when month-end entries are posted after cancellation date', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    await setMonthEndBlocked(true)();
    await expect(
      applyCancellation('can-1', makeLease(), '2026-06-15', 1000, 500, 'user-1')
    ).rejects.toThrow('Month-end entries are already posted');
  });

  it('handles short-term lease cancellation (only posts expense)', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const lease = makeLease({ accounting_treatment: 'short_term_exemption' });
    const result = await applyCancellation('can-1', lease, '2026-06-15', 1000, 500, 'user-1');
    expect(result.gainLoss).toBe(1500);
    expect(result.isGain).toBe(false);
  });

  it('handles short-term lease cancellation with zero cash', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    const lease = makeLease({ accounting_treatment: 'short_term_exemption' });
    const result = await applyCancellation('can-1', lease, '2026-06-15', 0, 0, 'user-1');
    expect(result.gainLoss).toBe(0);
  });

  it('successfully applies cancellation for recognized lease with gain', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    // At 2026-06-15, carrying = period 5 (rou=24000, liab=25000)
    // gain = 25000 - 24000 - 200 - 100 = 700
    const result = await applyCancellation('can-1', makeLease(), '2026-06-15', 200, 100, 'user-1');
    expect(result.carryingRouAsset).toBe(24000);
    expect(result.carryingLiability).toBe(25000);
  });

  it('successfully applies cancellation with loss', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    // 25000 - 24000 - 1000 - 1000 = -1000 → loss
    const result = await applyCancellation('can-1', makeLease(), '2026-06-15', 1000, 1000, 'user-1');
    expect(result.isGain).toBe(false);
    expect(result.gainLoss).toBe(1000);
  });

  it('handles cancellation with zero penalty and final payment', async () => {
    await setMock({
      contract_cancellations: { data: [], singleData: { derecognition_posted: false } },
      amortization_schedules: { data: fullScheduleRows as unknown[] },
    })();
    // 25000 - 24000 - 0 - 0 = 1000 → gain
    const result = await applyCancellation('can-1', makeLease(), '2026-06-15', 0, 0, 'user-1');
    expect(result.isGain).toBe(true);
    expect(result.gainLoss).toBe(1000);
  });
});
