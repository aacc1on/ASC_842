import type { Lease } from '../../types/lease';
import { supabase } from '../../lib/supabase';
import { round2 } from '../leaseCalculations';
import { fetchAll } from '../fetchAll';
import { monthEndOf } from '../leaseBalanceAsOf';
import { localDateStr } from './statementHelpers';
import type { LeaseCostDisclosure } from './statementTypes';
import { currentOrgId } from '../currentOrg';

/**
 * Computes the ASC 842-20-50-4(a) lease cost components and 50-4(g) other
 * information for a period. Reads amortization_schedules rows for the period
 * (same as generateProfitLoss) and lease_transactions for ROU obtained.
 */
export async function computeLeaseCostDisclosure(
  leases: Lease[],
  periodStart: Date,
  periodEnd: Date
): Promise<LeaseCostDisclosure> {
  const orgId = await currentOrgId();
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const leaseIds = leases.map((l) => l.id);
  const startStr = localDateStr(periodStart);
  const endStr = localDateStr(periodEnd);

  // Fetch schedule rows for the period
  const scheduleData: {
    lease_id: string;
    period_date: string;
    depreciation_expense: number;
    interest_expense: number;
    payment_amount: number;
    principal_reduction: number;
    short_term_lease_cost: number;
  }[] = [];
  if (leaseIds.length > 0) {
    const batchSize = 200;
    for (let i = 0; i < leaseIds.length; i += batchSize) {
      const batch = leaseIds.slice(i, i + batchSize);
      const data = await fetchAll<(typeof scheduleData)[number]>('amortization schedules', (from, to) => supabase
        .from('amortization_schedules')
        .select('lease_id, period_date, depreciation_expense, interest_expense, payment_amount, principal_reduction, short_term_lease_cost')
        .eq('organization_id', orgId)
        .in('lease_id', batch)
        .gte('period_date', startStr)
        .lte('period_date', endStr)
        .order('id', { ascending: true })
        .range(from, to));
      scheduleData.push(...data.filter((r) => monthEndOf(String(r.period_date)) <= endStr));
    }
  }

  let financeLeaseCost = 0;
  let operatingLeaseCost = 0;
  let shortTermLeaseCost = 0;
  let cashPaidOperatingLeases = 0;
  let cashPaidFinanceInterest = 0;
  let cashPaidFinancePrincipal = 0;

  for (const row of scheduleData) {
    const lease = leaseMap.get(row.lease_id);
    if (!lease) continue;

    if (lease.accounting_treatment === 'short_term_exemption') {
      const stlCost = Number(row.short_term_lease_cost) || 0;
      const stlPayment = Number(row.payment_amount) || 0;
      shortTermLeaseCost += stlCost;
      cashPaidOperatingLeases += stlPayment;
    } else if (lease.lease_classification === 'finance') {
      const dep = Number(row.depreciation_expense) || 0;
      const int = Number(row.interest_expense) || 0;
      const principal = Number(row.principal_reduction) || 0;
      financeLeaseCost += dep + int;
      cashPaidFinanceInterest += int;
      cashPaidFinancePrincipal += principal;
    } else {
      // Operating lease cost = interest + depreciation (single lease cost)
      const dep = Number(row.depreciation_expense) || 0;
      const int = Number(row.interest_expense) || 0;
      operatingLeaseCost += round2(dep + int);
      cashPaidOperatingLeases += Number(row.payment_amount) || 0;
    }
  }

  // Fetch ROU obtained from initial_recognition and modification transactions
  // where account_debited is 'Right-of-Use Asset' in the period
  let rouObtainedOperating = 0;
  let rouObtainedFinance = 0;
  if (leaseIds.length > 0) {
    const batchSize = 200;
    for (let i = 0; i < leaseIds.length; i += batchSize) {
      const batch = leaseIds.slice(i, i + batchSize);
      const txnData = await fetchAll<{ lease_id: string; transaction_type: string; account_debited: string; amount: number }>(
        'lease events',
        (from, to) => supabase
          .from('lease_transactions')
          .select('lease_id, transaction_type, account_debited, amount')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .in('transaction_type', ['initial_recognition', 'modification'])
          .gte('transaction_date', startStr)
          .lte('transaction_date', endStr)
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (txnData) {
        for (const r of txnData) {
          const debited = (r.account_debited || '').toLowerCase().trim();
          if (debited === 'right-of-use asset' || debited === 'rou asset') {
            const lease = leaseMap.get(r.lease_id);
            if (!lease) continue;
            const amount = Number(r.amount) || 0;
            if (lease.lease_classification === 'finance') {
              rouObtainedFinance += amount;
            } else {
              rouObtainedOperating += amount;
            }
          }
        }
      }
    }
  }

  const totalLeaseCost = financeLeaseCost + operatingLeaseCost + shortTermLeaseCost;

  return {
    financeLeaseCost,
    operatingLeaseCost,
    shortTermLeaseCost,
    variableLeaseCost: 0,
    subleaseIncome: 0,
    totalLeaseCost,
    cashPaidOperatingLeases,
    cashPaidFinanceInterest,
    cashPaidFinancePrincipal,
    rouObtainedOperating,
    rouObtainedFinance,
  };
}
