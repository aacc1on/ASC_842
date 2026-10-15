import { supabase } from '../lib/supabase';

export interface BucketTotals {
  count: number;
  rou: number;
  liability: number;
}

export interface PortfolioTotals {
  finance: BucketTotals;
  operating: BucketTotals;
  shortTerm: BucketTotals;
}

export interface PortfolioFilters {
  companyId?: string | null;
  search: string;
  leaseType: 'all' | 'operating' | 'finance';
  lessorType: string;
  branchId: string;
  status?: 'all' | 'active' | 'not_started' | 'ended';
  missingClassificationOnly?: boolean;
}

interface PortfolioTotalsRow {
  bucket: string;
  lease_count: number | string | null;
  total_rou: number | string | null;
  total_liability: number | string | null;
}

const emptyBucket = (): BucketTotals => ({ count: 0, rou: 0, liability: 0 });

export function buildPortfolioTotalsParams(filters: PortfolioFilters) {
  const search = filters.search.trim();
  return {
    p_company_id: filters.companyId || null,
    p_search: search || null,
    p_lease_type: filters.leaseType === 'all' ? null : filters.leaseType,
    p_lessor_type: filters.lessorType === 'all' ? null : filters.lessorType,
    p_branch_id: filters.branchId === 'all' || filters.branchId === 'none' ? null : filters.branchId,
    p_branch_unassigned: filters.branchId === 'none',
    p_status: !filters.status || filters.status === 'all' ? null : filters.status,
    p_missing_classification: !!filters.missingClassificationOnly,
  };
}

export function parsePortfolioTotals(rows: unknown): PortfolioTotals | null {
  if (!Array.isArray(rows)) return null;
  const totals: PortfolioTotals = { finance: emptyBucket(), operating: emptyBucket(), shortTerm: emptyBucket() };
  for (const raw of rows as PortfolioTotalsRow[]) {
    const key = raw?.bucket === 'finance' ? 'finance' : raw?.bucket === 'operating' ? 'operating' : raw?.bucket === 'short_term' ? 'shortTerm' : null;
    if (!key) continue;
    totals[key] = {
      count: Number(raw.lease_count) || 0,
      rou: Number(raw.total_rou) || 0,
      liability: Number(raw.total_liability) || 0,
    };
  }
  return totals;
}

export function sumPortfolioTotals(totals: PortfolioTotals): BucketTotals {
  const buckets = [totals.finance, totals.operating, totals.shortTerm];
  return {
    count: buckets.reduce((s, b) => s + b.count, 0),
    rou: Math.round(buckets.reduce((s, b) => s + b.rou, 0) * 100) / 100,
    liability: Math.round(buckets.reduce((s, b) => s + b.liability, 0) * 100) / 100,
  };
}

export async function fetchPortfolioTotals(filters: PortfolioFilters): Promise<PortfolioTotals | null> {
  const { data, error } = await supabase.rpc('get_lease_portfolio_totals', buildPortfolioTotalsParams(filters));
  if (error) return null;
  return parsePortfolioTotals(data);
}
