import type { ContractModification } from '../../types/lease';
import { MISSING_CLASSIFICATION_OR_FILTER } from '../../utils/leaseLifecycle';
import type { LeaseListScope } from './leaseScope';

export interface LeaseListFilters {
  search: string;
  leaseType: string;
  lessorType: string;
  branchId: string;
  listScope: LeaseListScope;
  companyId?: string | null;
}

export interface LeaseFilterableQuery<Q> {
  or(filters: string): Q;
  eq(column: string, value: string): Q;
  neq(column: string, value: string): Q;
  is(column: string, value: null): Q;
  lte(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  gt(column: string, value: string): Q;
}

export function applyLeaseListFilters<Q extends LeaseFilterableQuery<Q>>(query: Q, f: LeaseListFilters, today: string): Q {
  let q = query;
  if (f.search.trim()) {
    const ilike = `%${f.search.trim()}%`;
    q = q.or(`lease_name.ilike.${ilike},lessor_name.ilike.${ilike}`);
  }
  if (f.leaseType !== 'all') q = q.eq('lease_classification', f.leaseType);
  if (f.lessorType !== 'all') q = q.eq('lessor_type', f.lessorType);
  if (f.branchId !== 'all') {
    q = f.branchId === 'none' ? q.is('branch_id', null) : q.eq('branch_id', f.branchId);
  }
  if (f.listScope.status === 'active') {
    q = q.eq('status', 'active').lte('lease_start_date', today).gte('lease_end_date', today);
  } else if (f.listScope.status === 'not_started') {
    q = q.eq('status', 'active').gt('lease_start_date', today);
  } else if (f.listScope.status === 'ended') {
    q = q.or(`status.neq.active,lease_end_date.lt.${today}`);
  }
  if (f.listScope.missingClassificationOnly) {
    q = q.eq('lease_classification', 'finance').neq('accounting_treatment', 'short_term_exemption').or(MISSING_CLASSIFICATION_OR_FILTER);
  }
  if (f.companyId) q = q.eq('company_id', f.companyId);
  return q;
}

export function groupModificationsByLease(mods: ContractModification[]): Map<string, ContractModification[]> {
  const byLease = new Map<string, ContractModification[]>();
  for (const mod of mods) {
    if (!byLease.has(mod.lease_id)) byLease.set(mod.lease_id, []);
    byLease.get(mod.lease_id)!.push(mod);
  }
  return byLease;
}
