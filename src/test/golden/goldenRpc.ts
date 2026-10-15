import { leaseLifecycle } from '../../utils/leaseLifecycle';
import { scheduleBalancesRpc } from '../fixtures/fakeSupabase';
import type { Tables } from '../fixtures/goldenPortfolio';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Test oracle for get_lease_portfolio_totals over the fixture (status filter + buckets). */
export function goldenPortfolioTotalsRpc(args: Record<string, unknown>, tables: Tables) {
  const asOf = String(args.p_as_of ?? new Date().toISOString().slice(0, 10));
  const leases = tables.leases.filter((l) => !args.p_company_id || l.company_id === args.p_company_id);
  const balances = scheduleBalancesRpc({ p_lease_ids: leases.map((l) => l.id), p_as_of: asOf }, tables) as { lease_id: string; rou: number; liability: number }[];
  const byId = new Map(balances.map((b) => [b.lease_id, b]));
  const buckets = new Map<string, { bucket: string; lease_count: number; total_rou: number; total_liability: number }>();
  for (const l of leases) {
    if (args.p_status && leaseLifecycle(l as never, asOf) !== args.p_status) continue;
    const bucket = l.accounting_treatment === 'short_term_exemption' ? 'short_term' : String(l.lease_classification);
    const b = buckets.get(bucket) ?? { bucket, lease_count: 0, total_rou: 0, total_liability: 0 };
    const bal = byId.get(String(l.id));
    b.lease_count++;
    b.total_rou = r2(b.total_rou + (bal?.rou ?? 0));
    b.total_liability = r2(b.total_liability + (bal?.liability ?? 0));
    buckets.set(bucket, b);
  }
  return [...buckets.values()];
}
