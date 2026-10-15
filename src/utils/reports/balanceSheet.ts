import type { Lease } from '../../types/lease';
import { round2 } from '../leaseCalculations';
import { fromCents, toCents } from './footing';
import { computeScheduleBalances, fetchDocumentedLedger, fetchRouAdjustments } from './statementData';
import { accountMatches, localDateStr, pushBreakdown } from './statementHelpers';
import type { BalanceSheetData, LeaseBreakdownItem } from './statementTypes';

export interface RouRollforward {
  gross: number;
  impairment: number;
  accumulated: number;
}

/**
 * Schedule-based ROU roll-forward: gross = ROU at commencement adjusted by approved remeasurements,
 * impairments shown separately, accumulated amortization = gross − impairments − net.
 */
export function rouRollforward(openingRou: number, modificationDelta: number, impairment: number, netRou: number): RouRollforward {
  const grossC = toCents(openingRou) + toCents(modificationDelta);
  const impairmentC = toCents(impairment);
  return {
    gross: fromCents(grossC),
    impairment: fromCents(impairmentC),
    accumulated: fromCents(grossC - impairmentC - toCents(netRou)),
  };
}

export async function generateBalanceSheet(
  leases: Lease[],
  asOfDate: Date
): Promise<BalanceSheetData> {
  const recognized = leases.filter((l) => l.status !== 'cancelled' && l.accounting_treatment !== 'short_term_exemption');
  const leaseMap = new Map(recognized.map((l) => [l.id, l]));
  const leaseIds = recognized.map((l) => l.id);
  const asOfStr = localDateStr(asOfDate);

  const [ledger, balances, adjustments] = await Promise.all([
    fetchDocumentedLedger(leaseIds, null, asOfStr),
    computeScheduleBalances(recognized, asOfStr),
    fetchRouAdjustments(leaseIds, asOfStr),
  ]);

  const incentiveByLease = new Map<string, number>();
  const rvgByLease = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, val: number) =>
    map.set(key, (map.get(key) || 0) + val);

  for (const row of ledger) {
    if (accountMatches(row.account_credited, ['Lease Incentive Liability'])) add(incentiveByLease, row.lease_id, row.amount);
    if (accountMatches(row.account_debited, ['Lease Incentive Liability'])) add(incentiveByLease, row.lease_id, -row.amount);
    if (accountMatches(row.account_credited, ['Residual Value Guarantee Payable'])) add(rvgByLease, row.lease_id, row.amount);
    if (accountMatches(row.account_debited, ['Residual Value Guarantee Payable'])) add(rvgByLease, row.lease_id, -row.amount);
  }

  const c = { gross: 0, impairment: 0, accFinance: 0, accOperating: 0, net: 0, current: 0, longTerm: 0 };
  const bkGrossRou: LeaseBreakdownItem[] = [];
  const bkAccDep: LeaseBreakdownItem[] = [];
  const bkImpairment: LeaseBreakdownItem[] = [];
  const bkCurrent: LeaseBreakdownItem[] = [];
  const bkLongTerm: LeaseBreakdownItem[] = [];

  for (const b of balances.values()) {
    if (b.status !== 'active') continue;
    const id = b.lease.id;
    const roll = rouRollforward(b.openingRou, adjustments.modificationDelta.get(id) || 0, adjustments.impairment.get(id) || 0, b.rou);
    c.gross += toCents(roll.gross);
    c.impairment += toCents(roll.impairment);
    c.net += toCents(b.rou);
    if (b.lease.lease_classification === 'finance') c.accFinance += toCents(roll.accumulated);
    else c.accOperating += toCents(roll.accumulated);
    pushBreakdown(bkGrossRou, leaseMap, id, roll.gross, asOfStr);
    pushBreakdown(bkAccDep, leaseMap, id, roll.accumulated, asOfStr);
    pushBreakdown(bkImpairment, leaseMap, id, roll.impairment, asOfStr);

    const current = Math.min(b.liability, b.current);
    const longTerm = round2(b.liability - current);
    c.current += toCents(current);
    c.longTerm += toCents(longTerm);
    pushBreakdown(bkCurrent, leaseMap, id, current, asOfStr);
    pushBreakdown(bkLongTerm, leaseMap, id, longTerm, asOfStr);
  }

  let totalIncentive = 0;
  let totalRvg = 0;
  for (const [, value] of incentiveByLease) if (value > 0.005) totalIncentive += value;
  for (const [, value] of rvgByLease) if (value > 0.005) totalRvg += value;

  const netRouAsset = fromCents(c.net);
  const totalLiability = fromCents(c.current + c.longTerm);

  return {
    assets: {
      currentRouAsset: fromCents(c.gross),
      accumulatedDepreciation: fromCents(c.accFinance + c.accOperating),
      accumulatedAmortizationFinance: fromCents(c.accFinance),
      accumulatedAmortizationOperating: fromCents(c.accOperating),
      impairment: fromCents(c.impairment),
      netRouAsset,
      breakdown: { grossRou: bkGrossRou, accDepreciation: bkAccDep, impairment: bkImpairment },
    },
    liabilities: {
      currentPortion: fromCents(c.current),
      longTermPortion: fromCents(c.longTerm),
      totalLiability,
      leaseIncentiveLiability: totalIncentive,
      residualValueGuarantee: totalRvg,
      breakdown: { current: bkCurrent, longTerm: bkLongTerm },
    },
    equity: { retainedEarnings: round2(netRouAsset - totalLiability) },
    asOfDate,
  };
}
