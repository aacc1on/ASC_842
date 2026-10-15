import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Lease } from '../../types/lease';
import { createFakeSupabase } from '../../test/fixtures/fakeSupabase';
import type { Tables } from '../../test/fixtures/goldenPortfolio';
import { cancellationContent, modificationContent, newItemFields, numberOr, numberOrNull } from './editPayload';
import { PROTECTED_EDIT_FIELDS, saveItemEdit } from '../approvals';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => h.client[k as string] }),
}));

const LEASE = {
  id: 'L1', organization_id: 'org-1', payment_amount: 1000, lease_term_months: 36,
  discount_rate: 5, incremental_borrowing_rate: 6, rou_asset: 30000, lease_liability: 31000,
} as unknown as Lease;

const MOD = {
  lease_id: 'L1', modification_date: '2026-03-01', modification_type: 'term_extension', reason: 'r',
  old_monthly_payment: null, new_monthly_payment: 1200, old_lease_term: null, new_lease_term: 48,
  old_discount_rate: null, new_discount_rate: 5, notes: '', separate_contract: false,
  new_fair_value: null, new_economic_life_months: null,
};

describe('numberOr / numberOrNull', () => {
  it('keeps an explicit 0 and falls back only for missing or invalid input', () => {
    expect(numberOr(0, 99)).toBe(0);
    expect(numberOr('0', 99)).toBe(0);
    expect(numberOr(null, 99)).toBe(99);
    expect(numberOr(undefined, 99)).toBe(99);
    expect(numberOr('', 99)).toBe(99);
    expect(numberOr('abc', 99)).toBe(99);
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
    expect(numberOrNull('x')).toBeNull();
    expect(numberOrNull('12.5')).toBe(12.5);
  });
});

describe('modificationContent', () => {
  it('never contains owner, organization or status', () => {
    const c = modificationContent(MOD, LEASE);
    for (const f of PROTECTED_EDIT_FIELDS) expect(c).not.toHaveProperty(f);
  });

  it('falls back to lease terms only when the old value is missing', () => {
    expect(modificationContent(MOD, LEASE)).toMatchObject({ old_monthly_payment: 1000, old_lease_term: 36, old_discount_rate: 5 });
    expect(modificationContent({ ...MOD, old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0 }, LEASE))
      .toMatchObject({ old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0 });
    expect(modificationContent(MOD, { ...LEASE, discount_rate: undefined } as unknown as Lease).old_discount_rate).toBe(6);
    expect(modificationContent({ ...MOD, new_monthly_payment: null }, undefined))
      .toMatchObject({ old_monthly_payment: 0, old_lease_term: 0, old_discount_rate: 0, new_monthly_payment: 0 });
  });

  it('keeps a 0 fair value and life, rounds life, and nulls both for a separate contract', () => {
    expect(modificationContent({ ...MOD, new_fair_value: 0, new_economic_life_months: 0 }, LEASE))
      .toMatchObject({ fair_value_at_modification: 0, remaining_economic_life_months: 0 });
    expect(modificationContent({ ...MOD, new_fair_value: 5, new_economic_life_months: 59.6 }, LEASE))
      .toMatchObject({ fair_value_at_modification: 5, remaining_economic_life_months: 60 });
    expect(modificationContent({ ...MOD, separate_contract: true, new_fair_value: 5, new_economic_life_months: 12 }, LEASE))
      .toMatchObject({ fair_value_at_modification: null, remaining_economic_life_months: null });
  });
});

describe('cancellationContent / newItemFields', () => {
  const CAN = {
    lease_id: 'L1', cancellation_date: '2026-04-01', cancellation_reason: 'x', early_termination: true,
    termination_penalty: 500, final_payment_amount: 250, settlement_details: '',
  };

  it('computes the preview gain/loss and excludes protected fields', () => {
    const c = cancellationContent(CAN, LEASE);
    expect(c).toMatchObject({ remaining_rou_asset: 30000, remaining_lease_liability: 31000, gain_loss_amount: 250 });
    for (const f of [...PROTECTED_EDIT_FIELDS, 'derecognition_posted']) expect(c).not.toHaveProperty(f);
    expect(cancellationContent({ ...CAN, termination_penalty: null, final_payment_amount: '' }, undefined))
      .toMatchObject({ termination_penalty: 0, final_payment_amount: 0, gain_loss_amount: 0 });
  });

  it('sets owner, organization and pending status for new records only', () => {
    expect(newItemFields('u1', LEASE)).toEqual({ user_id: 'u1', organization_id: 'org-1', status: 'pending_approval' });
    expect(newItemFields(null, undefined)).toEqual({ user_id: null, organization_id: undefined, status: 'pending_approval' });
  });
});

describe('saveItemEdit', () => {
  let tables: Tables;
  let fake: ReturnType<typeof createFakeSupabase>;
  beforeEach(() => {
    tables = { contract_modifications: [{ id: 'M1', status: 'pending_approval', user_id: 'owner', notes: 'a' }] } as unknown as Tables;
    fake = createFakeSupabase(tables, { userId: 'editor' });
    h.client = fake as unknown as Record<string, unknown>;
  });

  it('refuses a payload that carries owner, organization or status', async () => {
    await expect(saveItemEdit('contract_modification', 'M1', { notes: 'b', user_id: 'editor' }, 'pending_approval'))
      .rejects.toThrow('must not include user_id');
    await expect(saveItemEdit('contract_modification', 'M1', { status: 'approved', organization_id: 'x' }, 'pending_approval'))
      .rejects.toThrow('organization_id, status');
    expect(fake.writes).toEqual([]);
  });

  it('updates content only for a pending item', async () => {
    await saveItemEdit('contract_modification', 'M1', { notes: 'b' }, 'pending_approval');
    expect(fake.writes.filter((w) => w.op === 'update')).toHaveLength(1);
    expect(tables.contract_modifications[0]).toMatchObject({ notes: 'b', user_id: 'owner', status: 'pending_approval' });
  });

  it('resubmits a draft item with a status-only update', async () => {
    tables.contract_modifications[0].status = 'draft';
    await saveItemEdit('contract_modification', 'M1', { notes: 'b' }, 'draft');
    const updates = fake.writes.filter((w) => w.op === 'update');
    expect(updates.map((u) => u.values)).toEqual([{ notes: 'b' }, { status: 'pending_approval' }]);
  });

  it('throws database errors from either step', async () => {
    fake.failures.write = { contract_modifications: 'Status cannot be changed while editing' };
    await expect(saveItemEdit('contract_modification', 'M1', { notes: 'b' }, 'draft')).rejects.toThrow('Status cannot be changed');
    let n = 0;
    const base = fake.from;
    h.client = {
      ...fake,
      from: (t: string) => {
        const q = base(t) as unknown as Record<string, unknown>;
        n += 1;
        if (n === 1) return q;
        return { update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('resubmit failed') }) }) }) }) };
      },
    };
    fake.failures.write = {};
    await expect(saveItemEdit('contract_modification', 'M1', { notes: 'c' }, 'draft')).rejects.toThrow('resubmit failed');
  });
});
