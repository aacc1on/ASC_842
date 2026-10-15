import type { Lease } from '../types/lease';
import { formatCurrency } from '../utils/formatting';

export function BalanceAmount({ lease, kind }: { lease: Lease; kind: 'rou' | 'liability' }) {
  const b = lease.currentBalances;
  if (b?.balanceStatus === 'not_started') {
    return <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Not started</span>;
  }
  return <>{formatCurrency(kind === 'rou' ? b?.currentRouAsset ?? 0 : b?.currentLiability ?? 0)}</>;
}
