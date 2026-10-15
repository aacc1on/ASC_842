import { footToTotal, roundWhole } from './footing';
import type { BalanceSheetData, LeaseBalancesByType } from './statementTypes';

export interface FootedBalanceSheet {
  grossRou: number;
  accumulatedFinance: number;
  accumulatedOperating: number;
  accumulatedTotal: number;
  impairment: number;
  netRou: number;
  current: number;
  longTerm: number;
  totalLiability: number;
}

/**
 * Whole-dollar balance sheet lines that foot: net ROU and total liability are rounded directly,
 * gross − accumulated − impairment = net, finance + operating = accumulated, current + long-term = total.
 */
export function footBalanceSheet(bs: BalanceSheetData): FootedBalanceSheet {
  const { assets, liabilities } = bs;
  const netRou = roundWhole(assets.netRouAsset);
  const grossRou = roundWhole(assets.currentRouAsset);
  const impairment = roundWhole(assets.impairment);
  const accumulatedTotal = grossRou - impairment - netRou;
  const acc = footToTotal([assets.accumulatedAmortizationOperating, assets.accumulatedAmortizationFinance], accumulatedTotal);
  const liab = footToTotal([liabilities.currentPortion, liabilities.longTermPortion], liabilities.totalLiability);
  return {
    grossRou,
    accumulatedOperating: acc.parts[0],
    accumulatedFinance: acc.parts[1],
    accumulatedTotal,
    impairment,
    netRou,
    current: liab.parts[0],
    longTerm: liab.parts[1],
    totalLiability: liab.total,
  };
}

export interface FootedBalancesByType {
  gross: { operating: number; finance: number; total: number };
  accumulated: { operating: number; finance: number; total: number };
  impairment: { operating: number; finance: number; total: number };
  rou: { operating: number; finance: number; total: number };
  current: { operating: number; finance: number; total: number };
  noncurrent: { operating: number; finance: number; total: number };
  liability: { operating: number; finance: number; total: number };
}

/**
 * Whole-dollar Lease Balances by Type table where every row and column foots. Totals are rounded the
 * same way as the balance sheet (so they agree with it); the finance column, the noncurrent row and the
 * gross row (= net + accumulated + impairment) are derived so each column foots.
 */
export function footBalancesByType(b: LeaseBalancesByType): FootedBalancesByType {
  const rou = footToTotal([b.operatingRouAsset, b.financeRouAsset], b.totalRouAsset);
  const liab = footToTotal([b.operatingLiabilityCurrent + b.operatingLiabilityNoncurrent, 0], b.totalLiability);
  const current = footToTotal([b.operatingLiabilityCurrent, b.financeLiabilityCurrent], b.totalLiabilityCurrent);
  const [opLiab, finLiab] = liab.parts;
  const [opCurrent, finCurrent] = current.parts;
  const grossTotal = roundWhole(b.operatingGrossRou + b.financeGrossRou);
  const imp = footToTotal([b.operatingImpairment, b.financeImpairment], b.operatingImpairment + b.financeImpairment);
  const accTotal = grossTotal - imp.total - rou.total;
  const acc = footToTotal([b.operatingAccumulatedAmortization, b.financeAccumulatedAmortization], accTotal);
  const grossOf = (i: 0 | 1) => rou.parts[i] + acc.parts[i] + imp.parts[i];
  return {
    gross: { operating: grossOf(0), finance: grossOf(1), total: grossTotal },
    accumulated: { operating: acc.parts[0], finance: acc.parts[1], total: accTotal },
    impairment: { operating: imp.parts[0], finance: imp.parts[1], total: imp.total },
    rou: { operating: rou.parts[0], finance: rou.parts[1], total: rou.total },
    current: { operating: opCurrent, finance: finCurrent, total: current.total },
    noncurrent: { operating: opLiab - opCurrent, finance: finLiab - finCurrent, total: liab.total - current.total },
    liability: { operating: opLiab, finance: finLiab, total: liab.total },
  };
}
