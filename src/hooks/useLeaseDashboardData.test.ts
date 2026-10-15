import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../test/fixtures/fakeSupabase';
import { GOLDEN_ORG, type Row, type Tables } from '../test/fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (h.client as Record<string, unknown>)[k as string] }),
}));

import { loadLeaseDashboard } from './useLeaseDashboardData';

const OTHER_ORG = '00000000-0000-0000-0000-0000000000b2';

const base = {
  lease_start_date: '2020-01-01', lease_end_date: '2099-12-31', payment_frequency: 'monthly', payment_timing: 'beginning',
  status: 'active', lease_classification: 'operating', component_policy: 'not_applicable',
};

function seed(): Tables {
  const longTerm = 1500;
  const schedules: Row[] = Array.from({ length: longTerm }, (_, i) => ({
    id: `s${String(i).padStart(5, '0')}`, lease_id: 'L1', from_month: i + 1, to_month: i + 1, payment_amount: 10 + (i % 2), organization_id: GOLDEN_ORG,
  }));
  schedules.push({ id: 'sx', lease_id: 'LX', from_month: 1, to_month: 12, payment_amount: 99999, organization_id: OTHER_ORG });
  const tables: Tables = {
    leases: [
      { ...base, id: 'L1', lease_name: 'Warehouse', company_id: 'C1', branch_id: 'b1', lease_term_months: longTerm, payment_amount: 10, organization_id: GOLDEN_ORG },
      { ...base, id: 'L2', lease_name: 'Truck', company_id: 'C2', branch_id: null, lease_term_months: 12, payment_amount: 400, lease_classification: 'finance', organization_id: GOLDEN_ORG },
      { ...base, id: 'LX', lease_name: 'Foreign HQ', company_id: 'C1', branch_id: 'bx', lease_term_months: 12, payment_amount: 99999, organization_id: OTHER_ORG },
    ],
    branches: [
      { id: 'b1', branch_name: 'Main', organization_id: GOLDEN_ORG },
      { id: 'b9', branch_name: 'Unused', organization_id: GOLDEN_ORG },
      { id: 'bx', branch_name: 'Foreign branch', organization_id: OTHER_ORG },
    ],
    lease_payment_schedules: schedules,
  };
  h.client = createFakeSupabase(tables, { userId: 'u1', maxRows: 1000 }) as unknown as Record<string, unknown>;
  return tables;
}

describe('loadLeaseDashboard', () => {
  it('never returns another organization\'s leases, branches or schedules', async () => {
    seed();
    const { rows, branches } = await loadLeaseDashboard(null);
    expect(rows.map((r) => r.id).sort()).toEqual(['L1', 'L2']);
    expect(branches.map((b) => b.id)).toEqual(['b1']);
    expect(rows.find((r) => r.id === 'L1')?.branchName).toBe('Main');
  });

  it('reads every schedule row past the 1,000-row page cap so escalations are fully totalled', async () => {
    const tables = seed();
    const { rows } = await loadLeaseDashboard(null);
    const expected = tables.lease_payment_schedules
      .filter((s) => s.lease_id === 'L1')
      .reduce((sum, s) => sum + Number(s.payment_amount), 0);
    expect(rows.find((r) => r.id === 'L1')?.totalLease).toBe(expected);
  });

  it('limits rows to the selected company', async () => {
    seed();
    const { rows } = await loadLeaseDashboard('C2');
    expect(rows.map((r) => r.id)).toEqual(['L2']);
    expect(rows[0].type).toBe('finance');
    expect(rows[0].totalLease).toBe(4800);
  });

  it('returns an empty dashboard when the organization has no leases', async () => {
    h.client = createFakeSupabase({ leases: [], branches: [], lease_payment_schedules: [] }, { userId: 'u1' }) as unknown as Record<string, unknown>;
    expect(await loadLeaseDashboard(null)).toEqual({ rows: [], branches: [] });
  });
});
