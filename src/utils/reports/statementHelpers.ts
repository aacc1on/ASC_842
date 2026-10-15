import type { Lease } from '../../types/lease';
import type { TerminationModRow } from './statementData';
import type { LeaseBreakdownItem } from './statementTypes';

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function accountMatches(account: string, names: string[]): boolean {
  const n = (account || '').toLowerCase().trim();
  return names.some((x) => n === x.toLowerCase());
}

/**
 * Processes termination/modification rows from lease_transactions into
 * P&L gain/loss amounts. Mutates the provided accumulators.
 */
export function processTerminationModForPL(
  rows: TerminationModRow[],
  leaseMap: Map<string, Lease>,
  totalGain: { v: number },
  totalLoss: { v: number },
  bkGainLoss: LeaseBreakdownItem[]
): void {
  for (const row of rows) {
    const credited = (row.account_credited || '').toLowerCase();
    const debited = (row.account_debited || '').toLowerCase();
    const lease = leaseMap.get(row.lease_id);

    if (credited.includes('gain on lease termination') || credited.includes('gain on lease modification')) {
      totalGain.v += row.amount;
      if (lease) {
        bkGainLoss.push({
          leaseId: row.lease_id,
          leaseName: lease.lease_name,
          classification: lease.lease_classification as 'finance' | 'operating',
          value: row.amount,
          transactionDate: row.transaction_date,
        });
      }
    }
    if (debited.includes('loss on lease termination') || debited.includes('lease modification loss') || debited.includes('impairment loss')) {
      totalLoss.v += row.amount;
      if (lease) {
        bkGainLoss.push({
          leaseId: row.lease_id,
          leaseName: lease.lease_name,
          classification: lease.lease_classification as 'finance' | 'operating',
          value: -row.amount,
          transactionDate: row.transaction_date,
        });
      }
    }
  }
}

/**
 * Processes termination/modification rows from lease_transactions into
 * cash outflow amounts (Cash credits). Returns total cash out and breakdown.
 */
export function processTerminationModForCashFlow(
  rows: TerminationModRow[],
  leaseMap: Map<string, Lease>,
  totalCashOut: { v: number },
  bkCashOut: LeaseBreakdownItem[]
): void {
  for (const row of rows) {
    const credited = (row.account_credited || '').toLowerCase();
    if (credited === 'cash') {
      totalCashOut.v += row.amount;
      const lease = leaseMap.get(row.lease_id);
      if (lease) {
        const existing = bkCashOut.find((x) => x.leaseId === row.lease_id);
        if (existing) {
          existing.value += row.amount;
        } else {
          bkCashOut.push({
            leaseId: row.lease_id,
            leaseName: lease.lease_name,
            classification: lease.lease_classification as 'finance' | 'operating',
            value: row.amount,
            transactionDate: row.transaction_date,
          });
        }
      }
    }
  }
}

export function pushBreakdown(
  arr: LeaseBreakdownItem[],
  leaseMap: Map<string, Lease>,
  leaseId: string,
  value: number,
  lastDate: string
) {
  if (value <= 0) return;
  const lease = leaseMap.get(leaseId);
  if (!lease) return;
  const existing = arr.find((x) => x.leaseId === leaseId);
  if (existing) {
    existing.value += value;
    if (lastDate > (existing.transactionDate || '')) existing.transactionDate = lastDate;
  } else {
    arr.push({
      leaseId,
      leaseName: lease.lease_name,
      classification: lease.lease_classification,
      value,
      transactionDate: lastDate,
    });
  }
}
