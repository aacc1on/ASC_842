

export interface LeaseBreakdownItem {
  leaseId: string;
  leaseName: string;
  classification: 'finance' | 'operating';
  value: number;
  transactionDate?: string;
}

export interface BalanceSheetData {
  assets: {
    currentRouAsset: number;
    accumulatedDepreciation: number;
    accumulatedAmortizationFinance: number;
    accumulatedAmortizationOperating: number;
    impairment: number;
    netRouAsset: number;
    breakdown: {
      grossRou: LeaseBreakdownItem[];
      accDepreciation: LeaseBreakdownItem[];
      impairment: LeaseBreakdownItem[];
    };
  };
  liabilities: {
    currentPortion: number;
    longTermPortion: number;
    totalLiability: number;
    leaseIncentiveLiability: number;
    residualValueGuarantee: number;
    breakdown: {
      current: LeaseBreakdownItem[];
      longTerm: LeaseBreakdownItem[];
    };
  };
  equity: {
    retainedEarnings: number;
  };
  asOfDate: Date;
}

export interface ProfitLossData {
  periodStart: Date;
  periodEnd: Date;
  operatingExpenses: {
    depreciationExpense: number;
    leaseExpense: number;
    shortTermLeaseCost: number;
    initialDirectCostsAmortized: number;
    total: number;
    breakdown: {
      depreciation: LeaseBreakdownItem[];
      leaseExpense: LeaseBreakdownItem[];
      shortTermLeaseCost: LeaseBreakdownItem[];
      idc: LeaseBreakdownItem[];
    };
  };
  financingCosts: {
    interestExpense: number;
    breakdown: {
      interest: LeaseBreakdownItem[];
    };
  };
  gainLossOnTermination: {
    gain: number;
    loss: number;
    net: number;
    breakdown: LeaseBreakdownItem[];
  };
  totalExpenses: number;
  netIncome: number;
}

export interface CashFlowData {
  periodStart: Date;
  periodEnd: Date;
  operatingActivities: {
    interestPaid: number;
    leasePayments: number;
    shortTermLeasePayments: number;
    terminationCashPaid: number;
    total: number;
    breakdown: {
      interest: LeaseBreakdownItem[];
      leasePayments: LeaseBreakdownItem[];
      shortTermLeasePayments: LeaseBreakdownItem[];
      terminationCash: LeaseBreakdownItem[];
    };
  };
  financingActivities: {
    principalPayments: number;
    initialDirectCostsPaid: number;
    residualValueGuaranteePaid: number;
    total: number;
    breakdown: {
      principal: LeaseBreakdownItem[];
      idc: LeaseBreakdownItem[];
      rvg: LeaseBreakdownItem[];
    };
  };
  netCashFlow: number;
}

export interface LeaseCostDisclosure {
  financeLeaseCost: number;        // amortization (depreciation) + interest for finance leases
  operatingLeaseCost: number;      // single straight-line cost (payment_amount) for operating leases
  shortTermLeaseCost: number;      // short_term_lease_cost for short-term exempt leases
  variableLeaseCost: number;       // 0 — not tracked
  subleaseIncome: number;          // 0 — not tracked
  totalLeaseCost: number;
  // Other information (842-20-50-4(g))
  cashPaidOperatingLeases: number; // operating cash outflow from operating lease payments
  cashPaidFinanceInterest: number; // operating cash outflow from finance lease interest
  cashPaidFinancePrincipal: number;// financing cash outflow from finance lease principal
  rouObtainedOperating: number;    // ROU from new operating leases + modification increases in period
  rouObtainedFinance: number;      // ROU from new finance leases + modification increases in period
}

export interface LeaseBalancesByType {
  operatingGrossRou: number;
  financeGrossRou: number;
  operatingAccumulatedAmortization: number;
  financeAccumulatedAmortization: number;
  operatingImpairment: number;
  financeImpairment: number;
  operatingRouAsset: number;
  financeRouAsset: number;
  operatingLiabilityCurrent: number;
  operatingLiabilityNoncurrent: number;
  financeLiabilityCurrent: number;
  financeLiabilityNoncurrent: number;
  totalRouAsset: number;
  totalLiabilityCurrent: number;
  totalLiabilityNoncurrent: number;
  totalLiability: number;
}

export interface MaturityResult {
  y1: number;
  y2: number;
  y3: number;
  y4: number;
  y5: number;
  thereafter: number;
  totalUndiscounted: number;
  liabilitySum: number;
  imputedInterest: number;
}

export interface MaturityAnalysis {
  finance: MaturityResult;
  operating: MaturityResult;
}
