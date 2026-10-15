import type { Lease } from '../../types/lease';
import { supabase } from '../../lib/supabase';
import { round2 } from '../leaseCalculations';
import { fetchAll } from '../fetchAll';
import { monthEndOf } from '../leaseBalanceAsOf';
import { fetchCancellationTxns, fetchTerminationModEntries } from './statementData';
import { localDateStr, processTerminationModForPL, pushBreakdown } from './statementHelpers';
import type { LeaseBreakdownItem, ProfitLossData } from './statementTypes';
import { currentOrgId } from '../currentOrg';

export async function generateProfitLoss(
  leases: Lease[],
  periodStart: Date,
  periodEnd: Date
): Promise<ProfitLossData> {
  const orgId = await currentOrgId();
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const leaseIds = leases.map((l) => l.id);
  const startStr = localDateStr(periodStart);
  const endStr = localDateStr(periodEnd);

  const scheduleData: { lease_id: string; period_date: string; depreciation_expense: number; interest_expense: number; payment_amount: number; short_term_lease_cost: number }[] = [];
  const batchSize = 200;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    const data = await fetchAll<(typeof scheduleData)[number]>('amortization schedules', (from, to) => supabase
      .from('amortization_schedules')
      .select('lease_id, period_date, depreciation_expense, interest_expense, payment_amount, short_term_lease_cost')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .gte('period_date', startStr)
      .lte('period_date', endStr)
      .order('id', { ascending: true })
      .range(from, to));
    scheduleData.push(...data.filter((r) => monthEndOf(String(r.period_date)) <= endStr));
  }

  let totalDepreciation = 0;
  let totalInterest = 0;
  let totalLeaseExpense = 0;
  let totalShortTermLeaseCost = 0;

  const bkDepreciation: LeaseBreakdownItem[] = [];
  const bkLeaseExpense: LeaseBreakdownItem[] = [];
  const bkInterest: LeaseBreakdownItem[] = [];
  const bkShortTermLeaseCost: LeaseBreakdownItem[] = [];

  const depreciationByLease = new Map<string, { amount: number; date: string }>();
  const interestByLease = new Map<string, { amount: number; date: string }>();
  const leaseExpenseByLease = new Map<string, { amount: number; date: string }>();
  const shortTermCostByLease = new Map<string, { amount: number; date: string }>();

  for (const row of scheduleData) {
    const leaseId = row.lease_id;
    const lease = leaseMap.get(leaseId);
    if (!lease) continue;
    const date = String(row.period_date).split('T')[0];

    if (lease.accounting_treatment === 'short_term_exemption') {
      const stlCost = Number(row.short_term_lease_cost) || 0;
      const ec = shortTermCostByLease.get(leaseId) || { amount: 0, date };
      ec.amount += stlCost; if (date > ec.date) ec.date = date;
      shortTermCostByLease.set(leaseId, ec);
    } else if (lease.lease_classification === 'finance') {
      const dep = Number(row.depreciation_expense) || 0;
      const int = Number(row.interest_expense) || 0;

      const ed = depreciationByLease.get(leaseId) || { amount: 0, date };
      ed.amount += dep;
      if (date > ed.date) ed.date = date;
      depreciationByLease.set(leaseId, ed);

      const ei = interestByLease.get(leaseId) || { amount: 0, date };
      ei.amount += int;
      if (date > ei.date) ei.date = date;
      interestByLease.set(leaseId, ei);
    } else {
      // Operating lease: single lease cost = interest accretion + ROU
      // amortization (the straight-line single lease cost), NOT cash
      // payment_amount. This includes IDC, incentives and prepaid
      // because they are baked into the schedule's depreciation and
      // interest columns.
      const dep = Number(row.depreciation_expense) || 0;
      const int = Number(row.interest_expense) || 0;
      const leaseCost = round2(dep + int);
      const el = leaseExpenseByLease.get(leaseId) || { amount: 0, date };
      el.amount += leaseCost;
      if (date > el.date) el.date = date;
      leaseExpenseByLease.set(leaseId, el);
    }
  }

  for (const [leaseId, info] of depreciationByLease) {
    totalDepreciation += info.amount;
    pushBreakdown(bkDepreciation, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of interestByLease) {
    totalInterest += info.amount;
    pushBreakdown(bkInterest, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of leaseExpenseByLease) {
    totalLeaseExpense += info.amount;
    pushBreakdown(bkLeaseExpense, leaseMap, leaseId, info.amount, info.date);
  }

  for (const [leaseId, info] of shortTermCostByLease) {
    totalShortTermLeaseCost += info.amount;
    pushBreakdown(bkShortTermLeaseCost, leaseMap, leaseId, info.amount, info.date);
  }

  const totalOperatingExpenses = totalDepreciation + totalLeaseExpense + totalShortTermLeaseCost;
  const totalExpenses = totalOperatingExpenses + totalInterest;

  // Fetch gain/loss on lease termination
  let totalGain = 0, totalLoss = 0;
  const bkGainLoss: LeaseBreakdownItem[] = [];
  if (leaseIds.length > 0) {
    for (let i = 0; i < leaseIds.length; i += batchSize) {
      const batch = leaseIds.slice(i, i + batchSize);
      const canTxns = await fetchCancellationTxns(batch, startStr, endStr);
      if (canTxns) {
        for (const txn of canTxns) {
          const lid = txn.lease_id;
          const credited = (txn.account_credited || '').toLowerCase();
          const debited = (txn.account_debited || '').toLowerCase();
          if (credited.includes('gain on lease termination')) {
            const amount = Number(txn.credit_amount) || 0;
            totalGain += amount;
            const lease = leaseMap.get(lid);
            if (lease) {
              bkGainLoss.push({ leaseId: lid, leaseName: lease.lease_name, classification: lease.lease_classification as 'finance' | 'operating', value: amount, transactionDate: String(txn.transaction_date).split('T')[0] });
            }
          }
          if (debited.includes('loss on lease termination')) {
            const amount = Number(txn.debit_amount) || 0;
            totalLoss += amount;
            const lease = leaseMap.get(lid);
            if (lease) {
              bkGainLoss.push({ leaseId: lid, leaseName: lease.lease_name, classification: lease.lease_classification as 'finance' | 'operating', value: -amount, transactionDate: String(txn.transaction_date).split('T')[0] });
            }
          }
        }
      }
    }

    // Also include termination/modification gain/loss from lease_transactions
    // (posted by the shared modification/cancellation engine).
    const termModRows = await fetchTerminationModEntries(leaseIds, startStr, endStr);
    const gainAcc = { v: totalGain };
    const lossAcc = { v: totalLoss };
    processTerminationModForPL(termModRows, leaseMap, gainAcc, lossAcc, bkGainLoss);
    totalGain = gainAcc.v;
    totalLoss = lossAcc.v;
  }
  const netGainLoss = totalGain - totalLoss;
  const netIncome = -totalExpenses + netGainLoss;

  return {
    periodStart,
    periodEnd,
    operatingExpenses: {
      depreciationExpense: totalDepreciation,
      leaseExpense: totalLeaseExpense,
      shortTermLeaseCost: totalShortTermLeaseCost,
      initialDirectCostsAmortized: 0,
      total: totalOperatingExpenses,
      breakdown: { depreciation: bkDepreciation, leaseExpense: bkLeaseExpense, shortTermLeaseCost: bkShortTermLeaseCost, idc: [] },
    },
    financingCosts: {
      interestExpense: totalInterest,
      breakdown: { interest: bkInterest },
    },
    gainLossOnTermination: {
      gain: totalGain,
      loss: totalLoss,
      net: netGainLoss,
      breakdown: bkGainLoss,
    },
    totalExpenses,
    netIncome,
  };
}
