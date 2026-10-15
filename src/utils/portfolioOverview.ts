import type { Lease, LeaseReport } from '../types/lease';
import { getLeaseDiscountRate } from './discountRate';
import { isActiveLease, todayYmd } from './leaseLifecycle';

const PAYMENTS_PER_MONTH: Record<string, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  semi_annually: 1 / 6,
  annually: 1 / 12,
};

function monthlyEquivalent(lease: Lease): number {
  return (Number(lease.payment_amount) || 0) * (PAYMENTS_PER_MONTH[lease.payment_frequency] ?? 1);
}

export function summarizePortfolio(leases: Lease[], asOf: string = todayYmd()): LeaseReport {
  const active = leases.filter((l) => isActiveLease(l, asOf));
  const recognized = active.filter((l) => l.accounting_treatment !== 'short_term_exemption');

  let totalRouAsset = 0;
  let totalLiability = 0;
  let weightedRate = 0;
  for (const l of recognized) {
    const rou = l.currentBalances?.currentRouAsset ?? 0;
    const liability = l.currentBalances?.currentLiability ?? 0;
    totalRouAsset += rou;
    totalLiability += liability;
    weightedRate += liability * (Number(getLeaseDiscountRate(l)) || 0);
  }

  return {
    totalLeases: leases.length,
    activeLeases: active.length,
    financeLeases: leases.filter((l) => l.lease_classification === 'finance').length,
    operatingLeases: leases.filter((l) => l.lease_classification === 'operating').length,
    shortTermExemptLeases: leases.filter((l) => l.accounting_treatment === 'short_term_exemption').length,
    totalRouAsset,
    totalLiability,
    totalMonthlyPayments: active.reduce((s, l) => s + monthlyEquivalent(l), 0),
    avgBorrowingRate: totalLiability > 0 ? weightedRate / totalLiability : 0,
  };
}
