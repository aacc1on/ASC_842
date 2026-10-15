import { Lease } from '../types/lease';
import { toYMD } from './formatting';
import { fetchLeaseBalancesAsOf, LeaseBalanceStatus } from './leaseBalanceAsOf';

export interface CurrentBalances {
  currentRouAsset: number;
  currentLiability: number;
  balanceStatus: LeaseBalanceStatus;
}

export async function batchCalculateCurrentBalances(
  leases: Lease[],
  asOf: Date = new Date()
): Promise<Map<string, CurrentBalances>> {
  const result = new Map<string, CurrentBalances>();
  if (leases.length === 0) return result;

  const balances = await fetchLeaseBalancesAsOf(leases.map((l) => l.id), toYMD(asOf));
  for (const lease of leases) {
    const b = balances.get(lease.id);
    result.set(lease.id, b
      ? { currentRouAsset: b.rou, currentLiability: b.liability, balanceStatus: b.status }
      : { currentRouAsset: 0, currentLiability: 0, balanceStatus: 'no_schedule' });
  }
  return result;
}
