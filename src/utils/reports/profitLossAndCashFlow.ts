import type { Lease } from '../../types/lease';
import { supabase } from '../../lib/supabase';
import { round2 } from '../leaseCalculations';
import { fetchAll } from '../fetchAll';
import { monthEndOf } from '../leaseBalanceAsOf';
import { fetchCancellationTxns, fetchTerminationModEntries } from './statementData';
import { localDateStr, processTerminationModForCashFlow, processTerminationModForPL, pushBreakdown } from './statementHelpers';
import type { CashFlowData, LeaseBreakdownItem, ProfitLossData } from './statementTypes';
import { currentOrgId } from '../currentOrg';

export async function generateProfitLossAndCashFlow(
  leases: Lease[],
  periodStart: Date,
  periodEnd: Date
): Promise<{ pl: ProfitLossData; cf: CashFlowData }> {
  const orgId = await currentOrgId();
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const leaseIds = leases.map((l) => l.id);
  const startStr = localDateStr(periodStart);
  const endStr = localDateStr(periodEnd);

  const scheduleData: { lease_id: string; period_date: string; depreciation_expense: number; interest_expense: number; payment_amount: number; principal_reduction: number; short_term_lease_cost: number }[] = [];
  const batchSize = 200;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    const data = await fetchAll<(typeof scheduleData)[number]>('amortization schedules', (from, to) => supabase
      .from('amortization_schedules')
      .select('lease_id, period_date, depreciation_expense, interest_expense, payment_amount, principal_reduction, short_term_lease_cost')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .gte('period_date', `${startStr.slice(0, 7)}-01`)
      .lte('period_date', endStr)
      .order('id', { ascending: true })
      .range(from, to));
    // Each schedule row is recognized at its period end, so contiguous
    // sub-ranges (months, weeks) always add up to the full-range total.
    scheduleData.push(...data.filter((r) => {
      const periodEnd = monthEndOf(String(r.period_date));
      return periodEnd >= startStr && periodEnd <= endStr;
    }));
  }

  // P&L accumulators
  let totalDepreciation = 0, totalInterestPL = 0, totalLeaseExpense = 0, totalShortTermLeaseCostPL = 0;
  const bkDepreciation: LeaseBreakdownItem[] = [];
  const bkLeaseExpense: LeaseBreakdownItem[] = [];
  const bkInterestPL: LeaseBreakdownItem[] = [];
  const bkShortTermLeaseCostPL: LeaseBreakdownItem[] = [];
  const depreciationByLease = new Map<string, { amount: number; date: string }>();
  const interestPLByLease = new Map<string, { amount: number; date: string }>();
  const leaseExpenseByLease = new Map<string, { amount: number; date: string }>();
  const shortTermCostByLease = new Map<string, { amount: number; date: string }>();

  // Cash flow accumulators
  let totalInterestCF = 0, totalPrincipalPayments = 0, totalLeasePaymentsCF = 0, totalShortTermPaymentsCF = 0;
  const bkInterestCF: LeaseBreakdownItem[] = [];
  const bkLeasePaymentsCF: LeaseBreakdownItem[] = [];
  const bkPrincipal: LeaseBreakdownItem[] = [];
  const bkShortTermPaymentsCF: LeaseBreakdownItem[] = [];
  const interestCFByLease = new Map<string, { amount: number; date: string }>();
  const principalByLease = new Map<string, { amount: number; date: string }>();
  const paymentCFByLease = new Map<string, { amount: number; date: string }>();
  const shortTermPaymentCFByLease = new Map<string, { amount: number; date: string }>();

  for (const row of scheduleData) {
    const leaseId = row.lease_id;
    const lease = leaseMap.get(leaseId);
    if (!lease) continue;
    const date = String(row.period_date).split('T')[0];
    const dep = Number(row.depreciation_expense) || 0;
    const interest = Number(row.interest_expense) || 0;
    const principal = Number(row.principal_reduction) || 0;
    const payment = Number(row.payment_amount) || 0;
    const stlCost = Number(row.short_term_lease_cost) || 0;

    if (lease.accounting_treatment === 'short_term_exemption') {
      // Short-term exempt: P&L short-term lease cost, Cash Flow short-term payment
      const ec = shortTermCostByLease.get(leaseId) || { amount: 0, date };
      ec.amount += stlCost; if (date > ec.date) ec.date = date;
      shortTermCostByLease.set(leaseId, ec);

      const epCF = shortTermPaymentCFByLease.get(leaseId) || { amount: 0, date };
      epCF.amount += payment; if (date > epCF.date) epCF.date = date;
      shortTermPaymentCFByLease.set(leaseId, epCF);
    } else if (lease.lease_classification === 'finance') {
      // P&L
      const ed = depreciationByLease.get(leaseId) || { amount: 0, date };
      ed.amount += dep; if (date > ed.date) ed.date = date;
      depreciationByLease.set(leaseId, ed);

      const ei = interestPLByLease.get(leaseId) || { amount: 0, date };
      ei.amount += interest; if (date > ei.date) ei.date = date;
      interestPLByLease.set(leaseId, ei);

      // Cash flow
      const eiCF = interestCFByLease.get(leaseId) || { amount: 0, date };
      eiCF.amount += interest; if (date > eiCF.date) eiCF.date = date;
      interestCFByLease.set(leaseId, eiCF);

      const ep = principalByLease.get(leaseId) || { amount: 0, date };
      ep.amount += principal; if (date > ep.date) ep.date = date;
      principalByLease.set(leaseId, ep);
    } else {
      // P&L: operating lease cost = interest + depreciation (straight-line
      // single lease cost), NOT cash payment_amount.
      const dep = Number(row.depreciation_expense) || 0;
      const int = Number(row.interest_expense) || 0;
      const leaseCost = round2(dep + int);
      const el = leaseExpenseByLease.get(leaseId) || { amount: 0, date };
      el.amount += leaseCost; if (date > el.date) el.date = date;
      leaseExpenseByLease.set(leaseId, el);

      // Cash flow: operating lease payment (cash outflow)
      const epCF = paymentCFByLease.get(leaseId) || { amount: 0, date };
      epCF.amount += payment; if (date > epCF.date) epCF.date = date;
      paymentCFByLease.set(leaseId, epCF);
    }
  }

  // Build P&L breakdowns
  for (const [leaseId, info] of depreciationByLease) {
    totalDepreciation += info.amount;
    pushBreakdown(bkDepreciation, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of interestPLByLease) {
    totalInterestPL += info.amount;
    pushBreakdown(bkInterestPL, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of leaseExpenseByLease) {
    totalLeaseExpense += info.amount;
    pushBreakdown(bkLeaseExpense, leaseMap, leaseId, info.amount, info.date);
  }

  for (const [leaseId, info] of shortTermCostByLease) {
    totalShortTermLeaseCostPL += info.amount;
    pushBreakdown(bkShortTermLeaseCostPL, leaseMap, leaseId, info.amount, info.date);
  }

  // Build Cash Flow breakdowns
  for (const [leaseId, info] of interestCFByLease) {
    totalInterestCF += info.amount;
    pushBreakdown(bkInterestCF, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of principalByLease) {
    totalPrincipalPayments += info.amount;
    pushBreakdown(bkPrincipal, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of paymentCFByLease) {
    totalLeasePaymentsCF += info.amount;
    pushBreakdown(bkLeasePaymentsCF, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of shortTermPaymentCFByLease) {
    totalShortTermPaymentsCF += info.amount;
    pushBreakdown(bkShortTermPaymentsCF, leaseMap, leaseId, info.amount, info.date);
  }

  const totalOperatingExpenses = totalDepreciation + totalLeaseExpense + totalShortTermLeaseCostPL;
  const totalExpenses = totalOperatingExpenses + totalInterestPL;

  // Fetch gain/loss on lease termination from cancellation transactions
  let totalGain = 0, totalLoss = 0;
  const bkGainLoss: LeaseBreakdownItem[] = [];
  if (leaseIds.length > 0) {
    const canBatchSize = 200;
    for (let i = 0; i < leaseIds.length; i += canBatchSize) {
      const batch = leaseIds.slice(i, i + canBatchSize);
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
              bkGainLoss.push({
                leaseId: lid,
                leaseName: lease.lease_name,
                classification: lease.lease_classification as 'finance' | 'operating',
                value: amount,
                transactionDate: String(txn.transaction_date).split('T')[0],
              });
            }
          }
          if (debited.includes('loss on lease termination')) {
            const amount = Number(txn.debit_amount) || 0;
            totalLoss += amount;
            const lease = leaseMap.get(lid);
            if (lease) {
              bkGainLoss.push({
                leaseId: lid,
                leaseName: lease.lease_name,
                classification: lease.lease_classification as 'finance' | 'operating',
                value: -amount,
                transactionDate: String(txn.transaction_date).split('T')[0],
              });
            }
          }
        }
      }
    }

    // Also include termination/modification gain/loss from lease_transactions
    const termModRows = await fetchTerminationModEntries(leaseIds, startStr, endStr);
    const gainAcc = { v: totalGain };
    const lossAcc = { v: totalLoss };
    processTerminationModForPL(termModRows, leaseMap, gainAcc, lossAcc, bkGainLoss);
    totalGain = gainAcc.v;
    totalLoss = lossAcc.v;
  }
  const netGainLoss = totalGain - totalLoss;

  const netIncome = -totalExpenses + netGainLoss;

  // Include cash paid for lease terminations/modifications from lease_transactions
  let totalTerminationCashPaid = 0;
  const bkTerminationCash: LeaseBreakdownItem[] = [];
  if (leaseIds.length > 0) {
    const termModRowsCF = await fetchTerminationModEntries(leaseIds, startStr, endStr);
    const cashAcc = { v: 0 };
    processTerminationModForCashFlow(termModRowsCF, leaseMap, cashAcc, bkTerminationCash);
    totalTerminationCashPaid = cashAcc.v;
  }

  const totalOperatingCashFlow = -(totalInterestCF + totalLeasePaymentsCF + totalShortTermPaymentsCF + totalTerminationCashPaid);
  const totalFinancingCashFlow = -totalPrincipalPayments;
  const netCashFlow = totalOperatingCashFlow + totalFinancingCashFlow;

  return {
    pl: {
      periodStart,
      periodEnd,
      operatingExpenses: {
        depreciationExpense: totalDepreciation,
        leaseExpense: totalLeaseExpense,
        shortTermLeaseCost: totalShortTermLeaseCostPL,
        initialDirectCostsAmortized: 0,
        total: totalOperatingExpenses,
        breakdown: { depreciation: bkDepreciation, leaseExpense: bkLeaseExpense, shortTermLeaseCost: bkShortTermLeaseCostPL, idc: [] },
      },
      financingCosts: {
        interestExpense: totalInterestPL,
        breakdown: { interest: bkInterestPL },
      },
      gainLossOnTermination: {
        gain: totalGain,
        loss: totalLoss,
        net: netGainLoss,
        breakdown: bkGainLoss,
      },
      totalExpenses,
      netIncome,
    },
    cf: {
      periodStart,
      periodEnd,
      operatingActivities: {
        interestPaid: totalInterestCF,
        leasePayments: totalLeasePaymentsCF,
        shortTermLeasePayments: totalShortTermPaymentsCF,
        terminationCashPaid: totalTerminationCashPaid,
        total: totalOperatingCashFlow,
        breakdown: { interest: bkInterestCF, leasePayments: bkLeasePaymentsCF, shortTermLeasePayments: bkShortTermPaymentsCF, terminationCash: bkTerminationCash },
      },
      financingActivities: {
        principalPayments: totalPrincipalPayments,
        initialDirectCostsPaid: 0,
        residualValueGuaranteePaid: 0,
        total: totalFinancingCashFlow,
        breakdown: { principal: bkPrincipal, idc: [], rvg: [] },
      },
      netCashFlow,
    },
  };
}
