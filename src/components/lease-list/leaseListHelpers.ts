import type { ReactNode } from 'react';
import type { Lease } from '../../types/lease';
import { formatCurrency } from '../../utils/formatting';

export const MISSING_DATA_TITLE = 'Finance lease without asset fair value or economic life. Edit the lease to add them so the classification tests can be run.';

export interface EnrichedLease extends Lease {
  currentBalances?: Lease['currentBalances'];
  fixed_asset_types?: { type_name: string; type_code: string } | null;
}

export type SortKey = 'lease_name' | 'lessor_name' | 'fixed_asset_type' | 'lease_classification' | 'lease_start_date' | 'lease_end_date' | 'lease_term_months' | 'payment_amount' | 'initial_direct_costs' | 'residual_value_guarantee' | 'rou_asset' | 'liability';
export type SortDir = 'asc' | 'desc';

export interface LeaseViewProps {
  leases: Lease[];
  freqNotice: ReactNode;
  onEdit?: (lease: Lease) => void;
  onDelete?: (id: string) => void;
  onViewSchedule: (lease: Lease) => void;
  onViewJournalEntries?: (lease: Lease) => void;
}

export const formatLessorType = (type: string) => {
  const types: Record<string, string> = {
    'corporate': 'Corporate',
    'individual': 'Individual',
    'government': 'Government',
    'financial_institution': 'Financial Institution',
    'other': 'Other'
  };
  return types[type] || type;
};

export const formatNullableCurrency = (amount: number | null) => formatCurrency(amount ?? 0);

export const getRou = (l: Lease) => (l as EnrichedLease).currentBalances?.currentRouAsset ?? 0;
export const getLiab = (l: Lease) => (l as EnrichedLease).currentBalances?.currentLiability ?? 0;

const TEXT_SORT_KEYS: SortKey[] = ['lease_name', 'lessor_name', 'fixed_asset_type', 'lease_classification', 'lease_start_date', 'lease_end_date'];

export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc' };
}

export function sortLeases(leases: Lease[], sortKey: SortKey, sortDir: SortDir): Lease[] {
  return [...leases].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    let va: string | number = '';
    let vb: string | number = '';
    switch (sortKey) {
      case 'lease_name': va = a.lease_name; vb = b.lease_name; break;
      case 'lessor_name': va = a.lessor_name; vb = b.lessor_name; break;
      case 'fixed_asset_type': va = (a as EnrichedLease).fixed_asset_types?.type_name ?? ''; vb = (b as EnrichedLease).fixed_asset_types?.type_name ?? ''; break;
      case 'lease_classification': va = a.lease_classification; vb = b.lease_classification; break;
      case 'lease_start_date': va = a.lease_start_date; vb = b.lease_start_date; break;
      case 'lease_end_date': va = a.lease_end_date; vb = b.lease_end_date; break;
      case 'lease_term_months': va = a.lease_term_months; vb = b.lease_term_months; break;
      case 'payment_amount': va = Number(a.payment_amount) || 0; vb = Number(b.payment_amount) || 0; break;
      case 'initial_direct_costs': va = Number(a.initial_direct_costs) || 0; vb = Number(b.initial_direct_costs) || 0; break;
      case 'residual_value_guarantee': va = Number(a.residual_value_guarantee) || 0; vb = Number(b.residual_value_guarantee) || 0; break;
      case 'rou_asset': va = getRou(a); vb = getRou(b); break;
      case 'liability': va = getLiab(a); vb = getLiab(b); break;
    }
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
    return ((va as number) - (vb as number)) * dir;
  });
}

export const LEASE_TABLE_COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' | 'center' }[] = [
  { key: 'lease_name', label: 'Lease', align: 'left' },
  { key: 'lessor_name', label: 'Lessor', align: 'left' },
  { key: 'fixed_asset_type', label: 'Fixed Asset Type', align: 'left' },
  { key: 'lease_classification', label: 'Type', align: 'left' },
  { key: 'lease_start_date', label: 'Start', align: 'left' },
  { key: 'lease_end_date', label: 'End', align: 'left' },
  { key: 'lease_term_months', label: 'Term (mo)', align: 'right' },
  { key: 'payment_amount', label: 'Monthly', align: 'right' },
  { key: 'initial_direct_costs', label: 'Initial Direct Cost', align: 'right' },
  { key: 'residual_value_guarantee', label: 'RVG', align: 'right' },
  { key: 'rou_asset', label: 'ROU', align: 'right' },
  { key: 'liability', label: 'Liability', align: 'right' },
];
