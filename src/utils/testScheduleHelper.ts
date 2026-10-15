import { generateAmortizationSchedule, type PaymentFrequency } from './leaseCalculations';
import type { Lease } from '../types/lease';
import { parseLocalDate } from './formatting';
import type { StoredScheduleMap, StoredScheduleRow } from './monthEndTransactions';

export function buildStoredSchedulesForLeases(leases: Lease[]): StoredScheduleMap {
  const map: StoredScheduleMap = new Map();
  for (const lease of leases) {
    const freq: PaymentFrequency = (['monthly', 'quarterly', 'semi_annually', 'annually', 'weekly'] as string[])
      .includes(lease.payment_frequency)
      ? (lease.payment_frequency as PaymentFrequency)
      : 'monthly';

    const schedule = generateAmortizationSchedule({
      leaseTermMonths: lease.lease_term_months,
      paymentAmount: lease.payment_amount,
      incrementalBorrowingRate: lease.incremental_borrowing_rate,
      initialDirectCosts: lease.initial_direct_costs ?? 0,
      leaseIncentives: lease.lease_incentives ?? 0,
      leaseStartDate: parseLocalDate(lease.lease_start_date),
      paymentTiming: (lease.payment_timing as 'beginning' | 'end') ?? 'end',
      paymentFrequency: freq,
      residualValueGuarantee: lease.residual_value_guarantee ?? 0,
      rvgProbableAmount: 0,
      classification: lease.lease_classification as 'operating' | 'finance',
      paymentSchedule: lease.paymentTranches,
    });

    const rows: StoredScheduleRow[] = schedule.map((r) => ({
      period_number: r.periodNumber,
      period_date: `${r.periodDate.getFullYear()}-${String(r.periodDate.getMonth() + 1).padStart(2, '0')}-${String(r.periodDate.getDate()).padStart(2, '0')}`,
      beginning_liability: r.beginningLiability,
      payment_amount: r.paymentAmount,
      interest_expense: r.interestExpense,
      principal_reduction: r.principalReduction,
      ending_liability: r.endingLiability,
      rou_asset_balance: r.rouAssetBalance,
      depreciation_expense: r.depreciationExpense,
    }));
    map.set(lease.id, rows);
  }
  return map;
}
