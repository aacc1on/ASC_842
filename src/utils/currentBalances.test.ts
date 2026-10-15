import { describe, it, expect, vi } from 'vitest';
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
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

const rpc = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { batchCalculateCurrentBalances } from './currentBalances';

describe('batchCalculateCurrentBalances', () => {
  it('returns empty map for empty input without calling the database', async () => {
    rpc.mockClear();
    const result = await batchCalculateCurrentBalances([]);
    expect(result.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the database balance rule for the as-of date', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ lease_id: 'l1', rou: '30000.50', liability: '29000.25', status: 'active', current_portion: '9000', opening_rou: '32871.02' }],
      error: null,
    });
    const result = await batchCalculateCurrentBalances([makeLease({ id: 'l1' })], new Date(2026, 6, 1));
    expect(rpc).toHaveBeenLastCalledWith('get_lease_balances_as_of', { p_as_of: '2026-07-01', p_lease_ids: ['l1'] });
    expect(result.get('l1')).toEqual({ currentRouAsset: 30000.5, currentLiability: 29000.25, balanceStatus: 'active' });
  });

  it('never falls back to stored lease totals when the database returns no row', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const result = await batchCalculateCurrentBalances([makeLease({ id: 'l1' })], new Date(2026, 6, 1));
    expect(result.get('l1')).toEqual({ currentRouAsset: 0, currentLiability: 0, balanceStatus: 'no_schedule' });
  });

  it('passes through not-started status', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ lease_id: 'l1', rou: 0, liability: 0, status: 'not_started', current_portion: 0, opening_rou: 32871.02 }],
      error: null,
    });
    const result = await batchCalculateCurrentBalances([makeLease({ id: 'l1' })], new Date(2025, 0, 1));
    expect(result.get('l1')?.balanceStatus).toBe('not_started');
    expect(result.get('l1')?.currentLiability).toBe(0);
  });

  it('surfaces database errors and malformed responses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(batchCalculateCurrentBalances([makeLease({ id: 'l1' })])).rejects.toThrow('Failed to load lease balances: boom');
    rpc.mockResolvedValueOnce({ data: [{ lease_id: 'l1', status: 'weird' }], error: null });
    await expect(batchCalculateCurrentBalances([makeLease({ id: 'l1' })])).rejects.toThrow('unexpected response');
  });
});
