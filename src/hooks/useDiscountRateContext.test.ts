import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import type { Row, Tables } from '../test/fixtures/goldenPortfolio';
import { useDiscountRateContext } from './useDiscountRateContext';
import { NO_DISCOUNT_RATE_CONTEXT } from '../utils/discountRate';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
let fromLog: string[];

function rfr(over: Row = {}): Row {
  return {
    id: 'r1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'RISK_FREE_RATE',
    election_value: true, effective_from: '2024-01-01', effective_to: null, status: 'approved',
    policy_version: 1, ...over,
  };
}

beforeEach(() => {
  fromLog = [];
  tables = {
    companies: [
      { id: 'c1', entity_type: 'non_public_business_entity' },
      { id: 'c2', entity_type: 'public_business_entity' },
    ],
    accounting_policy_elections: [
      rfr(),
      rfr({ id: 'r-other-co', company_id: 'c2' }),
      rfr({ id: 'r-pending', policy_version: 5, status: 'pending_approval' }),
    ],
  };
  fake = createFakeSupabase(tables, { userId: 'u1' });
  h.client = { ...fake, from: (t: string) => { fromLog.push(t); return fake.from(t); } };
});

afterEach(() => { vi.useRealTimers(); });

describe('useDiscountRateContext', () => {
  it('returns the empty context without querying when company or asset type is missing', () => {
    const { result, rerender } = renderHook(({ c, a }) => useDiscountRateContext(c, a, '2025-01-01'),
      { initialProps: { c: '', a: 'a1' } });
    expect(result.current).toMatchObject(NO_DISCOUNT_RATE_CONTEXT);
    rerender({ c: 'c1', a: '' });
    expect(result.current).toMatchObject(NO_DISCOUNT_RATE_CONTEXT);
    expect(fromLog).toEqual([]);
  });

  it('finds the approved election for the company and reports eligibility', async () => {
    const { result } = renderHook(() => useDiscountRateContext('c1', 'a1', '2025-01-01'));
    expect(result.current).toMatchObject(NO_DISCOUNT_RATE_CONTEXT);
    await waitFor(() => expect(result.current).toMatchObject({
      riskFreeElectionApproved: true, entityEligibleForRiskFree: true, riskFreePolicyElectionId: 'r1',
    }));
  });

  it('marks a public business entity as ineligible and ignores other companies\' elections', async () => {
    tables.accounting_policy_elections = [rfr({ id: 'r-c1-other-asset', fixed_asset_type_id: 'a9' }), rfr({ id: 'x', company_id: 'c1x' })];
    const { result } = renderHook(() => useDiscountRateContext('c2', 'a1', '2025-01-01'));
    await waitFor(() => expect(fromLog).toContain('companies'));
    await waitFor(() => expect(result.current).toMatchObject({
      riskFreeElectionApproved: false, entityEligibleForRiskFree: false, riskFreePolicyElectionId: null,
    }));
  });

  it('exposes an approved "no" election id but not approval', async () => {
    tables.accounting_policy_elections = [rfr({ election_value: false })];
    const { result } = renderHook(() => useDiscountRateContext('c1', 'a1', '2025-01-01'));
    await waitFor(() => expect(result.current.riskFreePolicyElectionId).toBe('r1'));
    expect(result.current.riskFreeElectionApproved).toBe(false);
  });

  it('ignores elections not yet effective at the lease start date', async () => {
    const { result } = renderHook(() => useDiscountRateContext('c1', 'a1', '2023-06-01'));
    await waitFor(() => expect(result.current.entityEligibleForRiskFree).toBe(true));
    expect(result.current.riskFreePolicyElectionId).toBeNull();
  });

  it('shows an error with a working retry when the query fails, keeping the empty context', async () => {
    fake.failures.select = { accounting_policy_elections: 'boom', companies: 'boom' };
    const { result } = renderHook(() => useDiscountRateContext('c1', 'a1', '2025-01-01'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject(NO_DISCOUNT_RATE_CONTEXT);
    expect(result.current.error).toBeTruthy();
    fake.failures.select = {};
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('defaults the as-of date to today when no start date is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2023-03-01T12:00:00Z'));
    tables.accounting_policy_elections = [rfr({ effective_from: '2023-01-01', effective_to: '2023-12-31' })];
    const { result } = renderHook(() => useDiscountRateContext('c1', 'a1', ''));
    await waitFor(() => expect(result.current.riskFreePolicyElectionId).toBe('r1'));
  });

  it('recomputes when inputs change and drops stale results', async () => {
    const { result, rerender } = renderHook(({ c }) => useDiscountRateContext(c, 'a1', '2025-01-01'),
      { initialProps: { c: 'c1' } });
    rerender({ c: 'c2' });
    await waitFor(() => expect(result.current.riskFreePolicyElectionId).toBe('r-other-co'));
    expect(result.current.entityEligibleForRiskFree).toBe(false);
    rerender({ c: '' });
    await waitFor(() => expect(result.current).toMatchObject(NO_DISCOUNT_RATE_CONTEXT));
  });
});
