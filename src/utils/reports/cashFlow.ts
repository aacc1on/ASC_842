import type { Lease } from '../../types/lease';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../fetchAll';
import { monthEndOf } from '../leaseBalanceAsOf';
import { fetchTerminationModEntries } from './statementData';
import { localDateStr, processTerminationModForCashFlow, pushBreakdown } from './statementHelpers';
import type { CashFlowData, LeaseBreakdownItem } from './statementTypes';
import { currentOrgId } from '../currentOrg';

export async function generateCashFlow(
  leases: Lease[],
  periodStart: Date,
  periodEnd: Date
): Promise<CashFlowData> {
  const orgId = await currentOrgId();
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const leaseIds = leases.map((l) => l.id);
  const startStr = localDateStr(periodStart);
  const endStr = localDateStr(periodEnd);

  const scheduleData: { lease_id: string; period_date: string; payment_amount: number; interest_expense: number; principal_reduction: number; short_term_lease_cost: number }[] = [];
  const batchSize = 200;
  for (let i = 0; i < leaseIds.length; i += batchSize) {
    const batch = leaseIds.slice(i, i + batchSize);
    const data = await fetchAll<(typeof scheduleData)[number]>('amortization schedules', (from, to) => supabase
      .from('amortization_schedules')
      .select('lease_id, period_date, payment_amount, interest_expense, principal_reduction, short_term_lease_cost')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .gte('period_date', startStr)
      .lte('period_date', endStr)
      .order('id', { ascending: true })
      .range(from, to));
    scheduleData.push(...data.filter((r) => monthEndOf(String(r.period_date)) <= endStr));
  }

  let totalInterestPaid = 0;
  let totalPrincipalPayments = 0;
  let totalLeasePayments = 0;
  let totalShortTermLeasePayments = 0;

  const bkInterest: LeaseBreakdownItem[] = [];
  const bkLeasePayments: LeaseBreakdownItem[] = [];
  const bkPrincipal: LeaseBreakdownItem[] = [];
  const bkShortTermLeasePayments: LeaseBreakdownItem[] = [];

  const interestByLease = new Map<string, { amount: number; date: string }>();
  const principalByLease = new Map<string, { amount: number; date: string }>();
  const paymentByLease = new Map<string, { amount: number; date: string }>();
  const shortTermPaymentByLease = new Map<string, { amount: number; date: string }>();

  for (const row of scheduleData) {
    const leaseId = row.lease_id;
    const interest = Number(row.interest_expense) || 0;
    const principal = Number(row.principal_reduction) || 0;
    const payment = Number(row.payment_amount) || 0;
    const date = String(row.period_date).split('T')[0];

    const lease = leaseMap.get(leaseId);
    if (!lease) continue;

    if (lease.accounting_treatment === 'short_term_exemption') {
      const ep = shortTermPaymentByLease.get(leaseId) || { amount: 0, date };
      ep.amount += payment; if (date > ep.date) ep.date = date;
      shortTermPaymentByLease.set(leaseId, ep);
    } else if (lease.lease_classification === 'finance') {
      const ei = interestByLease.get(leaseId) || { amount: 0, date };
      ei.amount += interest;
      if (date > ei.date) ei.date = date;
      interestByLease.set(leaseId, ei);

      const ep = principalByLease.get(leaseId) || { amount: 0, date };
      ep.amount += principal;
      if (date > ep.date) ep.date = date;
      principalByLease.set(leaseId, ep);
    } else {
      const ep = paymentByLease.get(leaseId) || { amount: 0, date };
      ep.amount += payment;
      if (date > ep.date) ep.date = date;
      paymentByLease.set(leaseId, ep);
    }
  }

  for (const [leaseId, info] of interestByLease) {
    totalInterestPaid += info.amount;
    pushBreakdown(bkInterest, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of principalByLease) {
    totalPrincipalPayments += info.amount;
    pushBreakdown(bkPrincipal, leaseMap, leaseId, info.amount, info.date);
  }
  for (const [leaseId, info] of paymentByLease) {
    totalLeasePayments += info.amount;
    pushBreakdown(bkLeasePayments, leaseMap, leaseId, info.amount, info.date);
  }

  for (const [leaseId, info] of shortTermPaymentByLease) {
    totalShortTermLeasePayments += info.amount;
    pushBreakdown(bkShortTermLeasePayments, leaseMap, leaseId, info.amount, info.date);
  }

  // Include cash paid for lease terminations/modifications from lease_transactions
  // (posted by the shared modification/cancellation engine).
  let totalTerminationCashPaid = 0;
  const bkTerminationCash: LeaseBreakdownItem[] = [];
  if (leaseIds.length > 0) {
    const termModRows = await fetchTerminationModEntries(leaseIds, startStr, endStr);
    const cashAcc = { v: 0 };
    processTerminationModForCashFlow(termModRows, leaseMap, cashAcc, bkTerminationCash);
    totalTerminationCashPaid = cashAcc.v;
  }

  const totalOperatingCashFlow = -(totalInterestPaid + totalLeasePayments + totalShortTermLeasePayments + totalTerminationCashPaid);
  const totalFinancingCashFlow = -totalPrincipalPayments;
  const netCashFlow = totalOperatingCashFlow + totalFinancingCashFlow;

  return {
    periodStart,
    periodEnd,
    operatingActivities: {
      interestPaid: totalInterestPaid,
      leasePayments: totalLeasePayments,
      shortTermLeasePayments: totalShortTermLeasePayments,
      terminationCashPaid: totalTerminationCashPaid,
      total: totalOperatingCashFlow,
      breakdown: { interest: bkInterest, leasePayments: bkLeasePayments, shortTermLeasePayments: bkShortTermLeasePayments, terminationCash: bkTerminationCash },
    },
    financingActivities: {
      principalPayments: totalPrincipalPayments,
      initialDirectCostsPaid: 0,
      residualValueGuaranteePaid: 0,
      total: totalFinancingCashFlow,
      breakdown: { principal: bkPrincipal, idc: [], rvg: [] },
    },
    netCashFlow,
  };
}
