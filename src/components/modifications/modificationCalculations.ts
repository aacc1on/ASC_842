import type { AmortizationSchedule } from '../../types/lease';

export const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

export const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * ASC 842 Step 4: PV of remaining payments (end-of-period ordinary annuity).
 * This matches the script formula: Σ Payment_t / (1+r)^t for t=1..n
 */
export function pvRemainingPayments(payment: number, months: number, annualRate: number): number {
  if (months <= 0) return 0;
  if (annualRate === 0) return payment * months;
  const r = annualRate / 100 / 12;
  let pv = 0;
  for (let t = 1; t <= months; t++) {
    pv += payment / Math.pow(1 + r, t);
  }
  return pv;
}

/**
 * Build amortization rows starting from the modification month.
 *
 * Period dates are anchored to modYear/modMonth so that:
 *   row 0 → modification month  (e.g. 2025-06)
 *   row 1 → modification month + 1 (2025-07)
 *   ...
 *
 * Amortisation formula (end-of-period ordinary annuity):
 *   interest   = beginning_liability × monthly_rate
 *   principal  = payment − interest
 *   ending     = beginning − principal
 *   depr       = straight-line  (startingRou / months)
 */
export function buildScheduleRows(
  startingLiability: number,
  startingRou: number,
  payment: number,
  months: number,
  annualRate: number,
  firstPeriodNumber: number,
  modYear: number,
  modMonth: number   // 0-indexed JS month of the modification date
) {
  const r = annualRate / 100 / 12;
  const monthlyDepr = months > 0 ? startingRou / months : 0;
  const rows: Omit<AmortizationSchedule, 'id' | 'lease_id' | 'created_at'>[] = [];
  let liability = startingLiability;
  let rou = startingRou;

  for (let i = 0; i < months; i++) {
    const isFinal = i === months - 1;
    const periodDate = new Date(modYear, modMonth + i, 1);

    const interest = Math.max(0, liability * r);
    const principal = Math.max(0, payment - interest);
    const endingLiability = isFinal ? 0 : Math.max(0, liability - principal);
    const rouBalance = isFinal ? 0 : Math.max(0, rou - monthlyDepr);

    rows.push({
      period_number: firstPeriodNumber + i,
      period_date: toYMD(periodDate),
      beginning_liability: parseFloat(liability.toFixed(2)),
      payment_amount: parseFloat(payment.toFixed(2)),
      interest_expense: parseFloat(interest.toFixed(2)),
      principal_reduction: parseFloat(principal.toFixed(2)),
      ending_liability: parseFloat(endingLiability.toFixed(2)),
      rou_asset_balance: parseFloat(rouBalance.toFixed(2)),
      depreciation_expense: parseFloat(monthlyDepr.toFixed(2)),
    });

    liability = endingLiability;
    rou = rouBalance;
  }
  return rows;
}

export const statusColor = (s: string) => ({
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}[s] ?? 'bg-slate-100 text-slate-700');
