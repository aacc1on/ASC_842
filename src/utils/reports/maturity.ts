import type { Lease } from '../../types/lease';
import { round2 } from '../leaseCalculations';
import { addMonthsYMD, fetchLeaseBalancesAsOf, fetchSchedulesByLease, monthEndOf, type FullScheduleRow } from '../leaseBalanceAsOf';
import { fromCents, sumCents, toCents } from './footing';
import { localDateStr } from './statementHelpers';
import type { MaturityAnalysis, MaturityResult } from './statementTypes';

function scheduledPaymentDate(lease: Lease, periodDate: string): string {
  return lease.payment_timing === 'beginning' ? periodDate.slice(0, 10) : monthEndOf(periodDate);
}

/**
 * Undiscounted remaining payments in 12-month buckets from the report date. A payment is
 * remaining when its payment date falls after the report date, which is the same cut-off the
 * as-of liability uses, so total − imputed interest equals the Balance Sheet liability exactly.
 */
export async function computeMaturityAnalysis(leases: Lease[], asOfDate: Date): Promise<MaturityAnalysis> {
  const asOfStr = localDateStr(asOfDate);
  const recognized = leases.filter((l) => l.status !== 'cancelled' && l.accounting_treatment !== 'short_term_exemption');
  const ids = recognized.map((l) => l.id);
  const [schedules, balances] = ids.length > 0
    ? await Promise.all([fetchSchedulesByLease(ids), fetchLeaseBalancesAsOf(ids, asOfStr)])
    : [new Map(), new Map()];
  const yearEnds = [1, 2, 3, 4, 5].map((k) => addMonthsYMD(asOfStr, 12 * k));
  const empty = (): MaturityResult => ({ y1: 0, y2: 0, y3: 0, y4: 0, y5: 0, thereafter: 0, totalUndiscounted: 0, liabilitySum: 0, imputedInterest: 0 });
  const out: MaturityAnalysis = { finance: empty(), operating: empty() };
  const keys = ['y1', 'y2', 'y3', 'y4', 'y5'] as const;

  for (const lease of recognized) {
    const rows: FullScheduleRow[] = schedules.get(lease.id) ?? [];
    const bal = balances.get(lease.id);
    if (!bal || bal.status !== 'active') continue;
    const target = lease.lease_classification === 'finance' ? out.finance : out.operating;
    target.liabilitySum += bal.liability;
    for (const r of rows) {
      const pay = Number(r.payment_amount) || 0;
      if (pay === 0) continue;
      const payDate = scheduledPaymentDate(lease, String(r.period_date));
      if (payDate <= asOfStr) continue;
      const idx = yearEnds.findIndex((end) => payDate <= end);
      if (idx === -1) target.thereafter += pay;
      else target[keys[idx]] += pay;
      target.totalUndiscounted += pay;
    }
  }

  for (const m of [out.finance, out.operating]) {
    for (const k of [...keys, 'thereafter', 'liabilitySum'] as const) m[k] = round2(m[k]);
    m.totalUndiscounted = sumCents([...keys.map((k) => m[k]), m.thereafter]);
    m.imputedInterest = fromCents(toCents(m.totalUndiscounted) - toCents(m.liabilitySum));
  }
  return out;
}
