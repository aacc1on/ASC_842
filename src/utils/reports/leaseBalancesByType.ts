import type { Lease } from '../../types/lease';
import { rouRollforward } from './balanceSheet';
import { fromCents, toCents } from './footing';
import { computeScheduleBalances, fetchRouAdjustments } from './statementData';
import { localDateStr } from './statementHelpers';
import type { LeaseBalancesByType } from './statementTypes';

/** Remaining lease liability per lease as of the report date (single as-of rule). */
export async function fetchRemainingLiabilityFromSchedule(
  leases: Lease[],
  asOfDate: Date
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (leases.length === 0) return map;
  const balances = await computeScheduleBalances(leases, localDateStr(asOfDate));
  for (const [id, b] of balances) if (b.status === 'active') map.set(id, b.liability);
  return map;
}

/** Lease balances split by operating vs finance, current = principal due in the next 12 months. */
export async function computeLeaseBalancesByType(
  leases: Lease[],
  asOfDate: Date
): Promise<LeaseBalancesByType> {
  const eligible = leases.filter(
    (l) => l.status !== 'cancelled' && l.accounting_treatment !== 'short_term_exemption'
  );
  const asOfStr = localDateStr(asOfDate);
  const [balances, adjustments] = await Promise.all([
    computeScheduleBalances(eligible, asOfStr),
    fetchRouAdjustments(eligible.map((l) => l.id), asOfStr),
  ]);

  const zero = () => ({ gross: 0, accumulated: 0, impairment: 0, rou: 0, current: 0, noncurrent: 0 });
  const cls = { operating: zero(), finance: zero() };

  for (const b of balances.values()) {
    if (b.status !== 'active') continue;
    const id = b.lease.id;
    const roll = rouRollforward(b.openingRou, adjustments.modificationDelta.get(id) || 0, adjustments.impairment.get(id) || 0, b.rou);
    const currentC = Math.min(toCents(b.liability), toCents(b.current));
    const t = b.lease.lease_classification === 'finance' ? cls.finance : cls.operating;
    t.gross += toCents(roll.gross);
    t.accumulated += toCents(roll.accumulated);
    t.impairment += toCents(roll.impairment);
    t.rou += toCents(b.rou);
    t.current += currentC;
    t.noncurrent += toCents(b.liability) - currentC;
  }

  const { operating: op, finance: fin } = cls;
  return {
    operatingGrossRou: fromCents(op.gross),
    financeGrossRou: fromCents(fin.gross),
    operatingAccumulatedAmortization: fromCents(op.accumulated),
    financeAccumulatedAmortization: fromCents(fin.accumulated),
    operatingImpairment: fromCents(op.impairment),
    financeImpairment: fromCents(fin.impairment),
    operatingRouAsset: fromCents(op.rou),
    financeRouAsset: fromCents(fin.rou),
    operatingLiabilityCurrent: fromCents(op.current),
    operatingLiabilityNoncurrent: fromCents(op.noncurrent),
    financeLiabilityCurrent: fromCents(fin.current),
    financeLiabilityNoncurrent: fromCents(fin.noncurrent),
    totalRouAsset: fromCents(op.rou + fin.rou),
    totalLiabilityCurrent: fromCents(op.current + fin.current),
    totalLiabilityNoncurrent: fromCents(op.noncurrent + fin.noncurrent),
    totalLiability: fromCents(op.current + op.noncurrent + fin.current + fin.noncurrent),
  };
}
