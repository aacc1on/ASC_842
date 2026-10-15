import type { Lease } from '../../types/lease';

export type PortfolioSortKey = 'lease_name' | 'lease_classification' | 'lease_start_date' | 'lease_term_months' | 'rou_asset' | 'liability' | 'payment_amount' | 'status';
export type PortfolioViewMode = 'table' | 'kanban';

export const PORTFOLIO_PAGE_SIZE = 50;

export function defaultPortfolioSortDir(key: PortfolioSortKey): 'asc' | 'desc' {
  return key === 'lease_name' || key === 'lease_classification' || key === 'lease_start_date' || key === 'status' ? 'asc' : 'desc';
}

export function sortPortfolioLeases(leases: Lease[], key: PortfolioSortKey, sortDir: 'asc' | 'desc'): Lease[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...leases].sort((a, b) => {
    if (key === 'rou_asset') {
      return ((a.currentBalances?.currentRouAsset || 0) - (b.currentBalances?.currentRouAsset || 0)) * dir;
    }
    if (key === 'liability') {
      return ((a.currentBalances?.currentLiability || 0) - (b.currentBalances?.currentLiability || 0)) * dir;
    }
    const va = (a as unknown as Record<string, unknown>)[key] ?? '';
    const vb = (b as unknown as Record<string, unknown>)[key] ?? '';
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
    return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
  });
}

export interface ReportFilterState {
  branch: string;
  assetType: string;
  leaseName: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilterState = { branch: 'all', assetType: 'all', leaseName: '' };

export function filterLeases(leases: Lease[], f: ReportFilterState): Lease[] {
  return leases.filter((l) => {
    if (f.leaseName && l.id !== f.leaseName) return false;
    if (f.branch !== 'all') {
      if (f.branch === 'none') {
        if (l.branch_id) return false;
      } else if (l.branch_id !== f.branch) {
        return false;
      }
    }
    if (f.assetType !== 'all') {
      if (f.assetType === 'none') {
        if (l.fixed_asset_type_id) return false;
      } else if (l.fixed_asset_type_id !== f.assetType) {
        return false;
      }
    }
    return true;
  });
}

export interface PortfolioViewState {
  mode: PortfolioViewMode;
  page: number;
  sortKey: PortfolioSortKey;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_PORTFOLIO_VIEW: PortfolioViewState = { mode: 'table', page: 1, sortKey: 'lease_name', sortDir: 'asc' };
