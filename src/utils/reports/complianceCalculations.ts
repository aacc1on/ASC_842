import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType, MaturityResult } from '../financialReports';
import { getLeaseDiscountRate } from '../discountRate';
import { parseLocalDate } from '../formatting';
import { calculateLeaseMetrics, round2, type PaymentFrequency } from '../leaseCalculations';
import { determineLeaseClassification, type ClassificationResult } from '../leaseClassification';

export interface Reassessment {
  lease_id: string;
  modification_date: string;
  reassessed_classification: 'finance' | 'operating';
  new_lease_liability: number | null;
  new_lease_term: number | null;
  fair_value_at_modification: number | null;
}

export type PeriodPreset = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'fy' | 'lastFy';

export function toIso(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Start/end dates for a reporting-period preset relative to `now`. */
export function presetRange(preset: PeriodPreset, now: Date): [Date, Date] | null {
  const y = now.getFullYear();
  if (preset === 'ytd') return [new Date(y, 0, 1), now];
  if (preset === 'q1') return [new Date(y, 0, 1), new Date(y, 2, 31)];
  if (preset === 'q2') return [new Date(y, 3, 1), new Date(y, 5, 30)];
  if (preset === 'q3') return [new Date(y, 6, 1), new Date(y, 8, 30)];
  if (preset === 'q4') return [new Date(y, 9, 1), new Date(y, 11, 31)];
  if (preset === 'fy') return [new Date(y, 0, 1), new Date(y, 11, 31)];
  if (preset === 'lastFy') return [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)];
  return null;
}

export interface ReportDates {
  periodStartDate: Date;
  periodEndDate: Date;
  /** The later of period start and period end (the "as of" date). */
  today: Date;
}

export function resolveReportDates(periodStart: string, periodEnd: string): ReportDates {
  const periodStartDate = new Date(periodStart);
  periodStartDate.setHours(0, 0, 0, 0);
  const periodEndDate = new Date(periodEnd);
  periodEndDate.setHours(0, 0, 0, 0);
  const today = periodEndDate.getTime() >= periodStartDate.getTime() ? periodEndDate : periodStartDate;
  return { periodStartDate, periodEndDate, today };
}

/** Active leases whose term overlaps the reporting period. */
export function filterActiveLeases(leases: Lease[], periodStart: string, periodEnd: string): Lease[] {
  const ps = new Date(periodStart);
  ps.setHours(0, 0, 0, 0);
  const pe = new Date(periodEnd);
  pe.setHours(0, 0, 0, 0);
  return leases.filter((l) => {
    if (l.status !== 'active') return false;
    const start = parseLocalDate(l.lease_start_date);
    start.setHours(0, 0, 0, 0);
    const end = parseLocalDate(l.lease_end_date);
    end.setHours(0, 0, 0, 0);
    return start.getTime() <= pe.getTime() && end.getTime() >= ps.getTime();
  });
}

/** Leases eligible for disclosures: excludes short-term exempt and terminated leases. */
export function eligibleLeases(leases: Lease[]): Lease[] {
  return leases.filter((l) => l.accounting_treatment !== 'short_term_exemption' && l.status !== 'terminated');
}

export function monthsBetween(from: Date, to: Date): number {
  const y = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  return Math.max(0, y * 12 + m + (to.getDate() >= from.getDate() ? 0 : -1));
}

export function remainingMonths(l: Lease, today: Date): number {
  const end = parseLocalDate(l.lease_end_date);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, monthsBetween(today, end));
}

export function presentValueAtInception(l: Lease): number {
  const pmt = Number(l.payment_amount) || 0;
  const n = Number(l.lease_term_months) || 0;
  if (n <= 0 || pmt < 0) return 0;
  const freq: PaymentFrequency = (['monthly','quarterly','semi_annually','annually','weekly'] as string[]).includes(l.payment_frequency)
    ? (l.payment_frequency as PaymentFrequency) : 'monthly';
  return calculateLeaseMetrics({
    leaseTermMonths: n,
    paymentAmount: pmt,
    incrementalBorrowingRate: getLeaseDiscountRate(l) || 0,
    initialDirectCosts: 0,
    leaseIncentives: 0,
    leaseStartDate: parseLocalDate(l.lease_start_date),
    classification: l.lease_classification,
    paymentTiming: l.payment_timing || 'beginning',
    paymentFrequency: freq,
    rvgProbableAmount: Number(l.rvg_probable_amount) || 0,
    paymentSchedule: l.paymentTranches,
    purchaseOptionPrice: Number(l.purchase_option_price) || 0,
    purchaseOptionReasonablyCertain: !!l.purchase_option_reasonably_certain,
  }).leaseLiability;
}

export type ClassificationRow = {
  lease: Lease;
  reassessedOn: string | null;
  pv: number;
  fv: number;
  termRatio: number | null;
  pvRatio: number | null;
  purchaseRatio: number | null;
  mismatch: boolean;
} & ClassificationResult;

export function buildClassificationRows(activeLeases: Lease[], reassessments: Map<string, Reassessment>): ClassificationRow[] {
  return activeLeases.map((l) => {
    // PV of lease payments at commencement (ASC 842-10-25-2(d)); a reassessing modification re-tests on modified terms.
    const reassessment = reassessments.get(l.id);
    const pv = reassessment && Number(reassessment.new_lease_liability) > 0
      ? Number(reassessment.new_lease_liability)
      : round2(presentValueAtInception(l) + (Number(l.prepaid_lease_payments) || 0));
    const fv = (reassessment && Number(reassessment.fair_value_at_modification) > 0)
      ? Number(reassessment.fair_value_at_modification)
      : Number(l.asset_market_value) || 0;
    const life = Number(l.asset_economic_life_months) || 0;
    const term = (reassessment && Number(reassessment.new_lease_term) > 0)
      ? Number(reassessment.new_lease_term)
      : Number(l.lease_term_months) || 0;
    const termYears = term / 12;
    const result = determineLeaseClassification({
      leaseTermMonths: term,
      assetEconomicLifeMonths: life,
      presentValue: pv,
      assetFairValue: fv,
      transferOwnership: !!l.transfer_ownership,
      purchaseOption: !!l.purchase_option,
      purchaseOptionReasonablyCertain: !!l.purchase_option_reasonably_certain,
      purchaseOptionPrice: Number(l.purchase_option_price) || 0,
      specializedAsset: !!l.specialized_asset,
    });
    const termRatio = life > 0 ? termYears / life : null;
    const pvRatio = fv > 0 ? pv / fv : null;
    const purchaseRatio = l.purchase_option && fv > 0 && (Number(l.purchase_option_price) || 0) > 0
      ? (Number(l.purchase_option_price) || 0) / fv
      : null;
    return {
      lease: l,
      reassessedOn: reassessment?.modification_date ?? null,
      pv,
      fv,
      termRatio,
      pvRatio,
      purchaseRatio,
      ...result,
      mismatch: result.classification !== l.lease_classification,
    };
  });
}

/** B2: finance / operating split excluding short-term exempt and terminated leases. */
export function splitByClassification(activeLeases: Lease[]): { finance: Lease[]; operating: Lease[] } {
  const finance = activeLeases.filter((l) => l.lease_classification === 'finance' && l.accounting_treatment !== 'short_term_exemption' && l.status !== 'terminated');
  const operating = activeLeases.filter((l) => l.lease_classification === 'operating' && l.accounting_treatment !== 'short_term_exemption' && l.status !== 'terminated');
  return { finance, operating };
}

export function weightedAvg(list: Lease[], weight: (l: Lease) => number, value: (l: Lease) => number): number {
  const w = list.reduce((s, l) => s + weight(l), 0);
  if (w <= 0) return 0;
  return list.reduce((s, l) => s + weight(l) * value(l), 0) / w;
}

export interface WeightedMetrics {
  watFinance: number;
  watOperating: number;
  wadrFinance: number;
  wadrOperating: number;
}

/** B2: weighted by remaining liability from amortization_schedules (missing → 0). */
export function computeWeightedMetrics(finance: Lease[], operating: Lease[], remainingLiabilityMap: Map<string, number>, today: Date): WeightedMetrics {
  const liabWeight = (l: Lease) => remainingLiabilityMap.get(l.id) ?? 0;
  return {
    watFinance: weightedAvg(finance, liabWeight, (l) => remainingMonths(l, today) / 12),
    watOperating: weightedAvg(operating, liabWeight, (l) => remainingMonths(l, today) / 12),
    wadrFinance: weightedAvg(finance, liabWeight, (l) => getLeaseDiscountRate(l) || 0),
    wadrOperating: weightedAvg(operating, liabWeight, (l) => getLeaseDiscountRate(l) || 0),
  };
}

export function classTotals(b: LeaseBalancesByType | null, cls: 'finance' | 'operating'): { rou: number; liab: number } {
  if (!b) return { rou: 0, liab: 0 };
  return cls === 'finance'
    ? { rou: b.financeRouAsset, liab: round2(b.financeLiabilityCurrent + b.financeLiabilityNoncurrent) }
    : { rou: b.operatingRouAsset, liab: round2(b.operatingLiabilityCurrent + b.operatingLiabilityNoncurrent) };
}

export function sumPayments(list: Lease[]): number {
  return list.reduce((s, l) => s + (Number(l.payment_amount) || 0), 0);
}

export const EMPTY_MATURITY: MaturityResult = { y1: 0, y2: 0, y3: 0, y4: 0, y5: 0, thereafter: 0, totalUndiscounted: 0, liabilitySum: 0, imputedInterest: 0 };

export function maturityBucketLabels(today: Date): string[] {
  return [1, 2, 3, 4, 5].map((k) => {
    const end = new Date(today);
    end.setMonth(end.getMonth() + 12 * k);
    return `Year ${k} (to ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
  });
}
