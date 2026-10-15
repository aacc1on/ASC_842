import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType, LeaseCostDisclosure, MaturityResult } from '../financialReports';
import { formatCurrencyVal } from '../../components/reports/shared/formatters';
import { getLeaseDiscountRate } from '../discountRate';
import { parseLocalDate } from '../formatting';
import type { WeightedMetrics } from './complianceCalculations';

export type DisclosureItem = {
  ref: string;
  title: string;
  requirement: string;
  available: boolean;
  findings: string[];
};

/** Reference of the policy-election item, which is rendered by PolicyElectionChecklist instead. */
export const POLICY_ELECTIONS_REF = '842-20-50-5';

export function lessorTypeLabel(k: string): string {
  return ({ corporate: 'Corporate', individual: 'Individual', government: 'Government', financial_institution: 'Financial Institution', other: 'Other' } as Record<string, string>)[k] || k;
}

export interface PortfolioFacts {
  futureLeases: Lease[];
  transferOwnershipCount: number;
  purchaseOptionCount: number;
  specializedCount: number;
  totalRvg: number;
  leasesWithRvg: number;
  ibrMin: number;
  ibrMax: number;
  lessorTypeCounts: Record<string, number>;
  relatedPartyLeases: Lease[];
  autoClassifiedCount: number;
}

export function computePortfolioFacts(activeLeases: Lease[], today: Date): PortfolioFacts {
  const futureLeases = activeLeases.filter((l) => {
    const start = parseLocalDate(l.lease_start_date);
    start.setHours(0, 0, 0, 0);
    return start.getTime() > today.getTime();
  });
  const ibrValues = activeLeases.map((l) => getLeaseDiscountRate(l) || 0).filter((v) => v > 0);
  const lessorTypeCounts: Record<string, number> = {};
  activeLeases.forEach((l) => {
    const k = l.lessor_type || 'other';
    lessorTypeCounts[k] = (lessorTypeCounts[k] || 0) + 1;
  });
  return {
    futureLeases,
    transferOwnershipCount: activeLeases.filter((l) => l.transfer_ownership).length,
    purchaseOptionCount: activeLeases.filter((l) => l.purchase_option).length,
    specializedCount: activeLeases.filter((l) => l.specialized_asset).length,
    totalRvg: activeLeases.reduce((s, l) => s + (Number(l.residual_value_guarantee) || 0), 0),
    leasesWithRvg: activeLeases.filter((l) => (Number(l.residual_value_guarantee) || 0) > 0).length,
    ibrMin: ibrValues.length ? Math.min(...ibrValues) : 0,
    ibrMax: ibrValues.length ? Math.max(...ibrValues) : 0,
    lessorTypeCounts,
    relatedPartyLeases: activeLeases.filter((l) => l.related_party),
    autoClassifiedCount: activeLeases.filter((l) => l.auto_classified).length,
  };
}

export interface DisclosureInput {
  activeLeases: Lease[];
  finance: Lease[];
  operating: Lease[];
  today: Date;
  metrics: WeightedMetrics;
  leaseCostDisclosure: LeaseCostDisclosure | null;
  leaseBalancesByType: LeaseBalancesByType | null;
  maturityFinance: MaturityResult;
  maturityOperating: MaturityResult;
}

export function buildQualitativeDisclosures(input: DisclosureInput): DisclosureItem[] {
  const { activeLeases, finance, operating, today, leaseCostDisclosure, leaseBalancesByType, maturityFinance, maturityOperating } = input;
  const { watFinance, watOperating, wadrFinance, wadrOperating } = input.metrics;
  const {
    futureLeases, transferOwnershipCount, purchaseOptionCount, specializedCount, totalRvg, leasesWithRvg,
    ibrMin, ibrMax, lessorTypeCounts, relatedPartyLeases, autoClassifiedCount,
  } = computePortfolioFacts(activeLeases, today);
  const totalRou = leaseBalancesByType?.totalRouAsset ?? 0;
  const totalLiab = leaseBalancesByType?.totalLiability ?? 0;

  return [
    {
      ref: '842-20-50-3(a)',
      title: 'Nature of Leases',
      requirement: 'General description of the entity\u2019s leases, including basis and terms of variable payments, renewal/termination options, and residual value guarantees.',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : [
        `Portfolio contains ${activeLeases.length} active lease${activeLeases.length === 1 ? '' : 's'} (${finance.length} finance, ${operating.length} operating).`,
        `Lessor composition: ${Object.entries(lessorTypeCounts).map(([k, v]) => `${lessorTypeLabel(k)} (${v})`).join(', ') || 'Not specified'}.`,
        purchaseOptionCount > 0 ? `${purchaseOptionCount} lease${purchaseOptionCount === 1 ? '' : 's'} include a purchase option.` : 'No leases include a contractual purchase option.',
        transferOwnershipCount > 0 ? `${transferOwnershipCount} lease${transferOwnershipCount === 1 ? '' : 's'} transfer ownership of the underlying asset at end of term.` : 'No leases transfer ownership at end of term.',
        leasesWithRvg > 0 ? `Residual value guarantees provided on ${leasesWithRvg} lease${leasesWithRvg === 1 ? '' : 's'}, totaling ${formatCurrencyVal(totalRvg)}.` : 'No residual value guarantees have been provided.',
        'Variable lease payment terms (CPI, usage, performance) are not captured in the system; disclose narratively if applicable.',
        'Renewal/termination options that are not reasonably certain of exercise are excluded from lease term; disclose narratively if material.',
      ],
    },
    {
      ref: '842-20-50-3(b)',
      title: 'Leases Not Yet Commenced',
      requirement: 'Information about leases that have not yet commenced but create significant rights and obligations.',
      available: futureLeases.length > 0,
      findings: futureLeases.length === 0
        ? ['No leases with a future commencement date are recorded.']
        : [
            `${futureLeases.length} lease${futureLeases.length === 1 ? '' : 's'} have a commencement date after ${today.toLocaleDateString()}.`,
            ...futureLeases.slice(0, 8).map((l) => `\u2022 ${l.lease_name} \u2014 commences ${parseLocalDate(l.lease_start_date).toLocaleDateString()}, term ${l.lease_term_months} months, monthly payment ${formatCurrencyVal(Number(l.payment_amount) || 0)}.`),
            futureLeases.length > 8 ? `\u2026 and ${futureLeases.length - 8} additional lease(s).` : '',
          ].filter(Boolean),
    },
    {
      ref: '842-20-50-3(c)',
      title: 'Significant Assumptions and Judgments',
      requirement: 'Significant assumptions and judgments used to apply ASC 842 (identifying a lease, allocating consideration, determining discount rate).',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : [
        `Discount rates applied as the lessee\u2019s incremental borrowing rate, ranging from ${ibrMin.toFixed(2)}% to ${ibrMax.toFixed(2)}% across the portfolio.`,
        `Weighted-average IBR \u2014 Finance: ${wadrFinance.toFixed(2)}%; Operating: ${wadrOperating.toFixed(2)}%.`,
        `${autoClassifiedCount} of ${activeLeases.length} lease${activeLeases.length === 1 ? '' : 's'} were classified using the automated ASC 842-10-25-2 five-criterion test; the remainder were classified through management judgment.`,
        specializedCount > 0 ? `${specializedCount} lease${specializedCount === 1 ? '' : 's'} involve specialized assets with no alternative use to the lessor.` : 'No specialized assets identified within the portfolio.',
        'Judgments regarding whether a contract contains a lease (identified asset and right to control) are made at contract inception; narrative disclosure required.',
      ],
    },
    {
      ref: '842-20-50-3(d)',
      title: 'Related Party Leases',
      requirement: 'Disclosure of lease transactions between related parties.',
      available: relatedPartyLeases.length > 0,
      findings: relatedPartyLeases.length > 0
        ? [
            `${relatedPartyLeases.length} lease${relatedPartyLeases.length === 1 ? ' is' : 's are'} flagged as related-party transactions (ASC 850).`,
            ...relatedPartyLeases.map((l) =>
              `${l.lease_name}${l.related_party_name ? ` — related party: ${l.related_party_name}` : ''}; lessor: ${l.lessor_name || 'n/a'}; ${l.lease_classification === 'finance' ? 'finance' : 'operating'} lease; payment ${formatCurrencyVal(Number(l.payment_amount) || 0)} ${l.payment_frequency || 'monthly'}; liability ${formatCurrencyVal(Number(l.lease_liability) || 0)}.`,
            ),
          ]
        : ['No leases are flagged as related-party transactions. Confirm through management review.'],
    },
    {
      ref: '842-20-50-4(a)',
      title: 'Components of Lease Cost',
      requirement: 'Finance lease amortization and interest, operating lease cost, short-term lease cost, variable lease cost, and sublease income.',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : leaseCostDisclosure ? [
        `Finance lease cost (amortization + interest): ${formatCurrencyVal(leaseCostDisclosure.financeLeaseCost)}.`,
        `Operating lease cost (straight-line): ${formatCurrencyVal(leaseCostDisclosure.operatingLeaseCost)}.`,
        `Short-term lease cost: ${formatCurrencyVal(leaseCostDisclosure.shortTermLeaseCost)}.`,
        `Variable lease cost: ${formatCurrencyVal(leaseCostDisclosure.variableLeaseCost)} (not tracked).`,
        `Sublease income: ${formatCurrencyVal(leaseCostDisclosure.subleaseIncome)} (not tracked).`,
        `Total lease cost: ${formatCurrencyVal(leaseCostDisclosure.totalLeaseCost)}.`,
      ] : ['Loading lease cost components…'],
    },
    {
      ref: '842-20-50-4(g)',
      title: 'Other Information — Cash Paid and ROU Obtained',
      requirement: 'Supplemental cash flow information: cash paid for lease liabilities (operating and financing), and ROU assets obtained in exchange for lease obligations.',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : leaseCostDisclosure ? [
        `Cash paid for operating leases (operating outflow): ${formatCurrencyVal(leaseCostDisclosure.cashPaidOperatingLeases)}.`,
        `Cash paid for finance lease interest (operating outflow): ${formatCurrencyVal(leaseCostDisclosure.cashPaidFinanceInterest)}.`,
        `Cash paid for finance lease principal (financing outflow): ${formatCurrencyVal(leaseCostDisclosure.cashPaidFinancePrincipal)}.`,
        `ROU assets obtained from operating leases: ${formatCurrencyVal(leaseCostDisclosure.rouObtainedOperating)}.`,
        `ROU assets obtained from finance leases: ${formatCurrencyVal(leaseCostDisclosure.rouObtainedFinance)}.`,
      ] : ['Loading other lease information…'],
    },
    {
      ref: '842-20-50-4(d)',
      title: 'Weighted-Average Term and Discount Rate',
      requirement: 'Weighted-average remaining lease term and discount rate by class (finance and operating).',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : [
        `Weighted-average remaining lease term \u2014 Finance: ${watFinance.toFixed(2)} years; Operating: ${watOperating.toFixed(2)} years.`,
        `Weighted-average discount rate \u2014 Finance: ${wadrFinance.toFixed(2)}%; Operating: ${wadrOperating.toFixed(2)}%.`,
      ],
    },
    {
      ref: '842-20-50-6',
      title: 'Maturity Analysis',
      requirement: 'Undiscounted future lease payments by year for five years and thereafter, reconciled to lease liability.',
      available: activeLeases.length > 0,
      findings: activeLeases.length === 0 ? ['No active leases recorded.'] : [
        `Total undiscounted payments \u2014 Finance: ${formatCurrencyVal(maturityFinance.totalUndiscounted)}; Operating: ${formatCurrencyVal(maturityOperating.totalUndiscounted)}.`,
        `Imputed interest \u2014 Finance: ${formatCurrencyVal(maturityFinance.imputedInterest)}; Operating: ${formatCurrencyVal(maturityOperating.imputedInterest)}.`,
        `Present value of lease liabilities recognized \u2014 ${formatCurrencyVal(totalLiab)}; ROU asset balance \u2014 ${formatCurrencyVal(totalRou)}.`,
        'Full maturity schedule is presented in the Maturity Analysis section.',
      ],
    },
    {
      ref: POLICY_ELECTIONS_REF,
      title: 'Accounting Policy Elections',
      requirement: 'Disclose practical expedients and accounting policy elections (short-term lease exemption, non-separation of lease/non-lease components, portfolio approach, risk-free rate election).',
      available: false,
      findings: ['Policy elections are not tracked in the system. Confirm with management and disclose narratively (e.g., short-term lease exemption, lease/non-lease component combination).'],
    },
  ];
}

/** Checklist items shown in the UI (policy elections render separately) and their status counts. */
export function checklistItems(items: DisclosureItem[]): { visible: DisclosureItem[]; populated: number; narrative: number } {
  const visible = items.filter((d) => d.ref !== POLICY_ELECTIONS_REF);
  return {
    visible,
    populated: visible.filter((d) => d.available).length,
    narrative: visible.filter((d) => !d.available).length,
  };
}
