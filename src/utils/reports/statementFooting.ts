import { footParts, roundWhole } from './footing';
import type { CashFlowData, MaturityResult, ProfitLossData } from './statementTypes';

export interface FootedProfitLoss {
  depreciation: number;
  leaseExpense: number;
  shortTermLeaseCost: number;
  idc: number;
  operatingTotal: number;
  interest: number;
  gain: number;
  loss: number;
  netGainLoss: number;
  totalExpenses: number;
  netIncome: number;
}

/** Whole-dollar P&L lines; every subtotal is the sum of the displayed lines. */
export function footProfitLoss(pl: ProfitLossData): FootedProfitLoss {
  const o = pl.operatingExpenses;
  const op = footParts([o.depreciationExpense, o.leaseExpense, o.shortTermLeaseCost, o.initialDirectCostsAmortized]);
  const [depreciation, leaseExpense, shortTermLeaseCost, idc] = op.parts;
  const interest = roundWhole(pl.financingCosts.interestExpense);
  const gain = roundWhole(pl.gainLossOnTermination.gain);
  const loss = roundWhole(pl.gainLossOnTermination.loss);
  const totalExpenses = op.total + interest;
  return {
    depreciation,
    leaseExpense,
    shortTermLeaseCost,
    idc,
    operatingTotal: op.total,
    interest,
    gain,
    loss,
    netGainLoss: gain - loss,
    totalExpenses,
    netIncome: gain - loss - totalExpenses,
  };
}

export interface FootedCashFlow {
  interestPaid: number;
  leasePayments: number;
  shortTermLeasePayments: number;
  terminationCashPaid: number;
  operatingTotal: number;
  principalPayments: number;
  idcPaid: number;
  rvgPaid: number;
  financingTotal: number;
  netCashFlow: number;
}

/** Whole-dollar cash flow lines (outflows as positive amounts); section totals are negative sums. */
export function footCashFlow(cf: CashFlowData): FootedCashFlow {
  const o = cf.operatingActivities;
  const f = cf.financingActivities;
  const op = footParts([o.interestPaid, o.leasePayments, o.shortTermLeasePayments, o.terminationCashPaid]);
  const fin = footParts([f.principalPayments, f.initialDirectCostsPaid, f.residualValueGuaranteePaid]);
  const [interestPaid, leasePayments, shortTermLeasePayments, terminationCashPaid] = op.parts;
  const [principalPayments, idcPaid, rvgPaid] = fin.parts;
  const operatingTotal = -op.total || 0;
  const financingTotal = -fin.total || 0;
  return {
    interestPaid,
    leasePayments,
    shortTermLeasePayments,
    terminationCashPaid,
    operatingTotal,
    principalPayments,
    idcPaid,
    rvgPaid,
    financingTotal,
    netCashFlow: operatingTotal + financingTotal,
  };
}

export interface FootedMaturity {
  years: number[];
  thereafter: number;
  totalUndiscounted: number;
  imputedInterest: number;
  liability: number;
}

/** Whole-dollar maturity table: buckets sum to the undiscounted total; undiscounted − interest = liability. */
export function footMaturity(m: MaturityResult): FootedMaturity {
  const buckets = footParts([m.y1, m.y2, m.y3, m.y4, m.y5, m.thereafter]);
  const liability = roundWhole(m.liabilitySum);
  return {
    years: buckets.parts.slice(0, 5),
    thereafter: buckets.parts[5],
    totalUndiscounted: buckets.total,
    imputedInterest: buckets.total - liability,
    liability,
  };
}
