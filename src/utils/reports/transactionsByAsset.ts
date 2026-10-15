import type { Lease } from '../../types/lease';

export interface AssetTransactionRow {
  leaseId: string;
  leaseName: string;
  classification: string;
  initialRecognition: number;
  accumulatedDepreciation: number;
  endingRou: number;
  liability: number;
  interestRecognized: number;
  leasePayment: number;
  endingLeaseLiability: number;
}

export type AssetSortKey = 'leaseName' | 'classification' | 'initialRecognition' | 'accumulatedDepreciation' | 'endingRou' | 'liability' | 'interestRecognized' | 'leasePayment' | 'endingLeaseLiability';

export interface AssetBreakdownDetail {
  leaseId: string;
  leaseName: string;
  column: string;
  transactions: { date: string; type: string; description: string; amount: number }[];
}

export interface ScheduleRow {
  lease_id?: string;
  period_date: string;
  period_number: number;
  beginning_liability: number | string | null;
  payment_amount: number | string | null;
  interest_expense: number | string | null;
  principal_reduction?: number | string | null;
  ending_liability: number | string | null;
  rou_asset_balance: number | string | null;
  depreciation_expense: number | string | null;
}

/** Schedule rows must be ordered by period_number and limited to period_date <= periodEnd. */
export function buildAssetTransactionRows(scheduleRows: ScheduleRow[], leases: Lease[], periodStart: string): AssetTransactionRow[] {
  const rows: AssetTransactionRow[] = [];
  const byLease = new Map<string, ScheduleRow[]>();
  for (const row of scheduleRows) {
    const id = row.lease_id as string;
    if (!byLease.has(id)) byLease.set(id, []);
    byLease.get(id)!.push(row);
  }

  for (const lease of leases) {
    const allPeriods = byLease.get(lease.id);
    if (!allPeriods || allPeriods.length === 0) continue;

    const periodsInRange = allPeriods.filter((p) => p.period_date >= periodStart);
    const lastPeriod = allPeriods[allPeriods.length - 1];
    const endingRou = Number(lastPeriod.rou_asset_balance) || 0;
    const endingLiab = Number(lastPeriod.ending_liability) || 0;
    const initialRou = lease.rou_asset || 0;
    const accDep = initialRou - endingRou;

    const totalInterest = periodsInRange.reduce((s, p) => s + (Number(p.interest_expense) || 0), 0);
    const totalPayment = periodsInRange.reduce((s, p) => s + (Number(p.payment_amount) || 0), 0);
    const beginLiab = periodsInRange.length > 0 ? (Number(periodsInRange[0].beginning_liability) || 0) : endingLiab;

    rows.push({
      leaseId: lease.id,
      leaseName: lease.lease_name,
      classification: lease.lease_classification || 'N/A',
      initialRecognition: initialRou,
      accumulatedDepreciation: accDep,
      endingRou,
      liability: beginLiab,
      interestRecognized: totalInterest,
      leasePayment: totalPayment,
      endingLeaseLiability: endingLiab,
    });
  }
  return rows;
}

export function sortAssetRows(rows: AssetTransactionRow[], key: AssetSortKey, dir: 'asc' | 'desc'): AssetTransactionRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * sign;
    return ((va as number) - (vb as number)) * sign;
  });
}

export function defaultAssetSortDir(key: AssetSortKey): 'asc' | 'desc' {
  return key === 'leaseName' || key === 'classification' ? 'asc' : 'desc';
}

const FIELD_EXTRACTORS: Record<string, (row: ScheduleRow) => { amount: number; description: string }> = {
  'Initial Recognition': (row) => ({ amount: Number(row.rou_asset_balance) || 0, description: `ROU Asset Balance` }),
  'Accum. Depreciation': (row) => ({ amount: Number(row.depreciation_expense) || 0, description: `Depreciation Expense` }),
  'Ending ROU': (row) => ({ amount: Number(row.rou_asset_balance) || 0, description: `ROU Asset Balance` }),
  'Beg. Liability': (row) => ({ amount: Number(row.beginning_liability) || 0, description: `Beginning Liability` }),
  'Interest Recognized': (row) => ({ amount: Number(row.interest_expense) || 0, description: `Interest Expense` }),
  'Lease Payment': (row) => ({ amount: Number(row.payment_amount) || 0, description: `Lease Payment` }),
  'Ending Liability': (row) => ({ amount: Number(row.ending_liability) || 0, description: `Ending Liability` }),
};

export function buildAssetBreakdownTransactions(scheduleRows: ScheduleRow[], column: string): AssetBreakdownDetail['transactions'] {
  const txns: AssetBreakdownDetail['transactions'] = [];
  const extractor = FIELD_EXTRACTORS[column];
  if (!extractor) return txns;
  for (const row of scheduleRows) {
    const { amount, description } = extractor(row);
    if (amount !== 0) {
      const label = new Date(row.period_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      txns.push({
        date: String(row.period_date).split('T')[0],
        type: `period_${row.period_number}`,
        description: `${description} — ${label}`,
        amount,
      });
    }
  }
  return txns;
}
