import { describe, it, expect, vi } from 'vitest';
import {
  generateInitialRecognitionTransactions,
  saveTransactions,
  getTransactionsByLease,
  getAllTransactions,
  type LeaseTransaction,
} from './transactionGenerator';
import type { Lease } from '../types/lease';
import { chainableMock } from './testSupabaseMock';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => chainableMock()),
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

describe('generateInitialRecognitionTransactions — edge cases', () => {
  it('generates prepaid entry when prepaid_lease_payments > 0', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ prepaid_lease_payments: 3000, rou_asset: 35871.02 }), 'user-1'
    );
    const prepaidEntry = txns.find(t => t.account_credited === 'Prepaid Rent (Cash)');
    expect(prepaidEntry).toBeDefined();
    expect(prepaidEntry!.amount).toBe(3000);
  });

  it('does not generate IDC entry when initial_direct_costs is 0', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    const idcEntry = txns.find(t => t.account_credited === 'Cash / Accounts Payable');
    expect(idcEntry).toBeUndefined();
  });

  it('does not generate incentive entry when lease_incentives is 0', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    const incentiveEntry = txns.find(t => t.account_debited === 'Cash / Lease Incentive Receivable');
    expect(incentiveEntry).toBeUndefined();
  });

  it('does not generate prepaid entry when prepaid_lease_payments is 0', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    const prepaidEntry = txns.find(t => t.account_credited === 'Prepaid Rent (Cash)');
    expect(prepaidEntry).toBeUndefined();
  });

  it('generates ROU adjustment entry when rou_asset does not match computed value', async () => {
    // computedRou = liability + idc + prepaid - incentives = 32871 + 0 + 0 - 0 = 32871
    // rou_asset = 33000, diff = 129 → adjustment entry
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ rou_asset: 33000, lease_liability: 32871 }), 'user-1'
    );
    const adjEntry = txns.find(t => t.description.includes('ROU asset adjustment'));
    expect(adjEntry).toBeDefined();
    expect(adjEntry!.amount).toBeCloseTo(129, 0);
    // diff > 0: Dr ROU, Cr Lease Liability
    expect(adjEntry!.account_debited).toBe('Right-of-Use Asset');
    expect(adjEntry!.account_credited).toBe('Lease Liability');
  });

  it('generates negative ROU adjustment when rou_asset < computed', async () => {
    // computedRou = 32871, rou_asset = 32000, diff = -871
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ rou_asset: 32000, lease_liability: 32871 }), 'user-1'
    );
    const adjEntry = txns.find(t => t.description.includes('ROU asset adjustment'));
    expect(adjEntry).toBeDefined();
    expect(adjEntry!.account_debited).toBe('Lease Expense');
    expect(adjEntry!.account_credited).toBe('Right-of-Use Asset');
    expect(adjEntry!.amount).toBeCloseTo(871, 0);
  });

  it('does not generate adjustment when rou_asset matches computed value', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ rou_asset: 32871.02, lease_liability: 32871.02 }), 'user-1'
    );
    const adjEntry = txns.find(t => t.description.includes('ROU asset adjustment'));
    expect(adjEntry).toBeUndefined();
  });

  it('includes organization_id on every transaction when lease has one', async () => {
    const txns = await generateInitialRecognitionTransactions(makeLease(), 'user-1');
    for (const t of txns) {
      expect(t.organization_id).toBe('org-1');
    }
  });

  it('handles null organization_id gracefully', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ organization_id: undefined }), 'user-1'
    );
    expect(txns.length).toBeGreaterThanOrEqual(1);
  });

  it('all transactions share the same transaction_date (stripped of time)', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({ lease_start_date: '2026-06-15T08:30:00.000Z' }), 'user-1'
    );
    for (const t of txns) {
      expect(t.transaction_date).toBe('2026-06-15');
    }
  });

  it('handles all cost components combined (IDC + incentives + prepaid + RVG)', async () => {
    const txns = await generateInitialRecognitionTransactions(
      makeLease({
        initial_direct_costs: 2000,
        lease_incentives: 1000,
        prepaid_lease_payments: 500,
        residual_value_guarantee: 3000,
        lease_liability: 35000,
        rou_asset: 36500, // 35000 + 2000 + 500 - 1000 = 36500
      }),
      'user-1'
    );
    // Should have: base liability, IDC, incentive, prepaid (no adjustment, no RVG entry)
    expect(txns.length).toBe(4);
    expect(txns.find(t => t.amount === 35000)).toBeDefined();
    expect(txns.find(t => t.amount === 2000)).toBeDefined();
    expect(txns.find(t => t.amount === 1000)).toBeDefined();
    expect(txns.find(t => t.amount === 500)).toBeDefined();
  });
});

describe('saveTransactions', () => {
  it('returns true for empty array (no-op)', async () => {
    const result = await saveTransactions([]);
    expect(result).toBe(true);
  });

  it('returns true on successful insert', async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn(() => ({
      insert: () => Promise.resolve({ error: null }),
    }));

    const txns: LeaseTransaction[] = [{
      lease_id: 'l1',
      transaction_date: '2026-01-01',
      transaction_type: 'initial_recognition',
      description: 'test',
      account_debited: 'A',
      account_credited: 'B',
      amount: 100,
    }];
    const result = await saveTransactions(txns);
    expect(result).toBe(true);
  });

  it('returns false on insert error', async () => {
    const { supabase } = await import('../lib/supabase');
    (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn(() => ({
      insert: () => Promise.resolve({ error: { message: 'insert failed' } }),
    }));

    const result = await saveTransactions([{
      lease_id: 'l1',
      transaction_date: '2026-01-01',
      transaction_type: 'initial_recognition',
      description: 'test',
      account_debited: 'A',
      account_credited: 'B',
      amount: 100,
    }]);
    expect(result).toBe(false);
  });
});

type PageResponse = { data: unknown[] | null; error: { message: string } | null };

function mockPagedQuery(pages: PageResponse[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  let page = 0;
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order']) {
    builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    return Promise.resolve(pages[Math.min(page++, pages.length - 1)]);
  };
  return { from: vi.fn(() => builder), calls };
}

async function useMock(pages: PageResponse[]) {
  const mock = mockPagedQuery(pages);
  const { supabase } = await import('../lib/supabase');
  (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = mock.from;
  return mock;
}

const txn = (i: number): LeaseTransaction => ({
  lease_id: 'l1', transaction_date: '2026-01-01', transaction_type: 'initial_recognition',
  description: `t${i}`, account_debited: 'A', account_credited: 'B', amount: i * 100,
});

describe('getTransactionsByLease', () => {
  it('returns data on success, ordered with an id tiebreak', async () => {
    const mock = await useMock([{ data: [txn(1), txn(2)], error: null }]);
    const result = await getTransactionsByLease('l1');
    expect(result).toHaveLength(2);
    expect(result[0].amount).toBe(100);
    expect(mock.calls).toContainEqual({ method: 'order', args: ['id', { ascending: true }] });
  });

  it('returns empty array on error', async () => {
    await useMock([{ data: null, error: { message: 'fail' } }]);
    expect(await getTransactionsByLease('l1')).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    await useMock([{ data: null, error: null }]);
    expect(await getTransactionsByLease('l1')).toEqual([]);
  });
});

describe('getAllTransactions', () => {
  it('returns data in a single page when there are fewer than 1,000 rows', async () => {
    const mock = await useMock([{ data: Array.from({ length: 5 }, (_, i) => txn(i)), error: null }]);
    expect(await getAllTransactions()).toHaveLength(5);
    expect(mock.calls.filter((c) => c.method === 'range')).toHaveLength(1);
  });

  it('reads past the 1,000-row limit', async () => {
    const mock = await useMock([
      { data: Array.from({ length: 1000 }, (_, i) => txn(i)), error: null },
      { data: Array.from({ length: 1000 }, (_, i) => txn(i)), error: null },
      { data: Array.from({ length: 3 }, (_, i) => txn(i)), error: null },
    ]);
    expect(await getAllTransactions()).toHaveLength(2003);
    expect(mock.calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('fails loudly on error instead of returning a partial list', async () => {
    await useMock([{ data: null, error: { message: 'fail' } }]);
    await expect(getAllTransactions()).rejects.toThrow('fail');
  });

  it('stops when data is empty', async () => {
    await useMock([{ data: [], error: null }]);
    expect(await getAllTransactions()).toEqual([]);
  });

  it('passes date filters to the query', async () => {
    const mock = await useMock([{ data: [txn(1)], error: null }]);
    const result = await getAllTransactions(new Date(2026, 2, 1), new Date(2026, 8, 30));
    expect(result).toHaveLength(1);
    expect(mock.calls).toContainEqual({ method: 'gte', args: ['transaction_date', '2026-03-01'] });
    expect(mock.calls).toContainEqual({ method: 'lte', args: ['transaction_date', '2026-09-30'] });
  });
});
