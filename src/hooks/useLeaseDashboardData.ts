import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type { PaymentTranche } from '../utils/leaseCalculations';
import { currentOrgId } from '../utils/currentOrg';
import { fetchAll, fetchAllIn } from '../utils/fetchAll';
import { buildDashboardRow, type LeaseDashboardRow } from '../utils/leaseDashboard';
import { useAsyncData } from './useAsyncData';

export interface DashboardBranch {
  id: string;
  branch_name: string;
}

export interface LeaseDashboardData {
  rows: LeaseDashboardRow[];
  branches: DashboardBranch[];
}

interface ScheduleRow {
  lease_id: string;
  from_month: number;
  to_month: number;
  payment_amount: number;
}

const EMPTY: LeaseDashboardData = { rows: [], branches: [] };

export async function loadLeaseDashboard(selectedCompanyId: string | null | undefined): Promise<LeaseDashboardData> {
  const orgId = await currentOrgId();

  const leases = await fetchAll<Lease>('leases', (from, to) => {
    let q = supabase.from('leases').select('*').eq('organization_id', orgId);
    if (selectedCompanyId) q = q.eq('company_id', selectedCompanyId);
    return q.order('lease_name', { ascending: true }).order('id', { ascending: true }).range(from, to);
  });

  const branches = await fetchAll<DashboardBranch>('branches', (from, to) => supabase
    .from('branches')
    .select('id, branch_name')
    .eq('organization_id', orgId)
    .order('branch_name', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));

  const schedules = await fetchAllIn<ScheduleRow>(
    'payment schedules',
    leases.map((l) => l.id),
    (ids, from, to) => supabase
      .from('lease_payment_schedules')
      .select('lease_id, from_month, to_month, payment_amount')
      .eq('organization_id', orgId)
      .in('lease_id', ids)
      .order('lease_id', { ascending: true })
      .order('from_month', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );

  const tranches = new Map<string, PaymentTranche[]>();
  for (const s of schedules) {
    const list = tranches.get(s.lease_id) ?? [];
    list.push({ fromMonth: Number(s.from_month), toMonth: Number(s.to_month), paymentAmount: Number(s.payment_amount) || 0 });
    tranches.set(s.lease_id, list);
  }
  const branchName = new Map(branches.map((b) => [b.id, b.branch_name]));

  const rows = leases.map((l) => buildDashboardRow(
    l,
    tranches.get(l.id) ?? [],
    (l.branch_id && branchName.get(l.branch_id)) || '',
  ));
  const usedBranchIds = new Set(leases.map((l) => l.branch_id).filter(Boolean));
  return { rows, branches: branches.filter((b) => usedBranchIds.has(b.id)) };
}

export function useLeaseDashboardData(selectedCompanyId: string | null | undefined) {
  return useAsyncData(
    () => loadLeaseDashboard(selectedCompanyId),
    [selectedCompanyId],
    EMPTY,
    'Failed to load the lease dashboard.',
  );
}
