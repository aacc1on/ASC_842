import { describe, it, expect } from 'vitest';
import type { Lease } from '../../types/lease';
import type { LeaseBalancesByType, LeaseCostDisclosure } from '../financialReports';
import { EMPTY_MATURITY } from './complianceCalculations';
import {
  buildQualitativeDisclosures, checklistItems, computePortfolioFacts, lessorTypeLabel, POLICY_ELECTIONS_REF, type DisclosureInput,
} from './complianceDisclosures';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'l1',
  lease_name: 'Lease 1',
  status: 'active',
  lease_start_date: '2026-01-01',
  lease_end_date: '2030-12-31',
  lease_term_months: 60,
  payment_amount: 1000,
  payment_frequency: 'monthly',
  lease_classification: 'operating',
  incremental_borrowing_rate: 5,
  lease_liability: 50000,
  ...over,
} as unknown as Lease);

const today = new Date(2026, 5, 30);
const metrics = { watFinance: 3.456, watOperating: 2, wadrFinance: 4.5, wadrOperating: 6.125 };

const input = (over: Partial<DisclosureInput> = {}): DisclosureInput => {
  const activeLeases = over.activeLeases ?? [lease()];
  return {
    activeLeases,
    finance: activeLeases.filter((l) => l.lease_classification === 'finance'),
    operating: activeLeases.filter((l) => l.lease_classification === 'operating'),
    today,
    metrics,
    leaseCostDisclosure: null,
    leaseBalancesByType: null,
    maturityFinance: EMPTY_MATURITY,
    maturityOperating: EMPTY_MATURITY,
    ...over,
  };
};

const byRef = (items: ReturnType<typeof buildQualitativeDisclosures>, ref: string) => items.find((d) => d.ref === ref)!;

describe('lessorTypeLabel', () => {
  it('maps known types and passes unknown ones through', () => {
    expect(lessorTypeLabel('financial_institution')).toBe('Financial Institution');
    expect(lessorTypeLabel('other')).toBe('Other');
    expect(lessorTypeLabel('alien')).toBe('alien');
  });
});

describe('computePortfolioFacts', () => {
  it('derives counts, IBR range, lessor composition and future leases', () => {
    const facts = computePortfolioFacts([
      lease({ id: 'a', lessor_type: 'corporate', purchase_option: true, residual_value_guarantee: 500, auto_classified: true } as Partial<Lease>),
      lease({ id: 'b', incremental_borrowing_rate: 0, transfer_ownership: true, specialized_asset: true, related_party: true, lease_start_date: '2026-09-01' } as Partial<Lease>),
      lease({ id: 'c', incremental_borrowing_rate: 9, lessor_type: 'corporate' } as Partial<Lease>),
    ], today);
    expect(facts.futureLeases.map((l) => l.id)).toEqual(['b']);
    expect(facts.ibrMin).toBe(5);
    expect(facts.ibrMax).toBe(9);
    expect(facts.lessorTypeCounts).toEqual({ corporate: 2, other: 1 });
    expect(facts.purchaseOptionCount).toBe(1);
    expect(facts.transferOwnershipCount).toBe(1);
    expect(facts.specializedCount).toBe(1);
    expect(facts.totalRvg).toBe(500);
    expect(facts.leasesWithRvg).toBe(1);
    expect(facts.relatedPartyLeases.map((l) => l.id)).toEqual(['b']);
    expect(facts.autoClassifiedCount).toBe(1);
  });

  it('reports a zero IBR range for an empty portfolio', () => {
    const facts = computePortfolioFacts([], today);
    expect([facts.ibrMin, facts.ibrMax]).toEqual([0, 0]);
  });
});

describe('buildQualitativeDisclosures', () => {
  it('returns the nine ASC 842-20-50 items in order', () => {
    expect(buildQualitativeDisclosures(input()).map((d) => d.ref)).toEqual([
      '842-20-50-3(a)', '842-20-50-3(b)', '842-20-50-3(c)', '842-20-50-3(d)', '842-20-50-4(a)', '842-20-50-4(g)', '842-20-50-4(d)', '842-20-50-6', POLICY_ELECTIONS_REF,
    ]);
  });

  it('reports "No active leases recorded." when the portfolio is empty', () => {
    const items = buildQualitativeDisclosures(input({ activeLeases: [] }));
    for (const ref of ['842-20-50-3(a)', '842-20-50-3(c)', '842-20-50-4(a)', '842-20-50-4(g)', '842-20-50-4(d)', '842-20-50-6']) {
      expect(byRef(items, ref)).toMatchObject({ available: false, findings: ['No active leases recorded.'] });
    }
    expect(byRef(items, '842-20-50-3(d)').findings).toEqual(['No leases are flagged as related-party transactions. Confirm through management review.']);
  });

  it('writes nature-of-leases and weighted-average findings with fixed rounding', () => {
    const items = buildQualitativeDisclosures(input());
    expect(byRef(items, '842-20-50-3(a)').findings.slice(0, 3)).toEqual([
      'Portfolio contains 1 active lease (0 finance, 1 operating).',
      'Lessor composition: Other (1).',
      'No leases include a contractual purchase option.',
    ]);
    expect(byRef(items, '842-20-50-4(d)').findings).toEqual([
      'Weighted-average remaining lease term \u2014 Finance: 3.46 years; Operating: 2.00 years.',
      'Weighted-average discount rate \u2014 Finance: 4.50%; Operating: 6.13%.',
    ]);
  });

  it('shows loading text until cost disclosure arrives, then formatted amounts', () => {
    expect(byRef(buildQualitativeDisclosures(input()), '842-20-50-4(a)').findings).toEqual(['Loading lease cost components…']);
    expect(byRef(buildQualitativeDisclosures(input()), '842-20-50-4(g)').findings).toEqual(['Loading other lease information…']);
    const cost = { financeLeaseCost: 1234.4, operatingLeaseCost: 0, shortTermLeaseCost: 0, variableLeaseCost: 0, subleaseIncome: 0, totalLeaseCost: 1234.4, cashPaidOperatingLeases: 10, cashPaidFinanceInterest: 0, cashPaidFinancePrincipal: 0, rouObtainedOperating: 0, rouObtainedFinance: 0 } as LeaseCostDisclosure;
    const items = buildQualitativeDisclosures(input({ leaseCostDisclosure: cost }));
    expect(byRef(items, '842-20-50-4(a)').findings[0]).toBe('Finance lease cost (amortization + interest): $1,234.');
    expect(byRef(items, '842-20-50-4(g)').findings[0]).toBe('Cash paid for operating leases (operating outflow): $10.');
  });

  it('lists future leases (max 8) and related-party leases', () => {
    const future = Array.from({ length: 10 }, (_, i) => lease({ id: `f${i}`, lease_name: `F${i}`, lease_start_date: '2027-01-01', related_party: i === 0, related_party_name: 'Owner' } as Partial<Lease>));
    const items = buildQualitativeDisclosures(input({ activeLeases: future }));
    const b = byRef(items, '842-20-50-3(b)');
    expect(b.available).toBe(true);
    expect(b.findings).toHaveLength(10);
    expect(b.findings[9]).toBe('\u2026 and 2 additional lease(s).');
    const d = byRef(items, '842-20-50-3(d)');
    expect(d.findings[0]).toBe('1 lease is flagged as related-party transactions (ASC 850).');
    expect(d.findings[1]).toBe('F0 — related party: Owner; lessor: n/a; operating lease; payment $1,000 monthly; liability $50,000.');
  });

  it('reconciles maturity totals to balances', () => {
    const balances = { totalLiability: 9000, totalRouAsset: 8000 } as LeaseBalancesByType;
    const items = buildQualitativeDisclosures(input({ leaseBalancesByType: balances, maturityFinance: { ...EMPTY_MATURITY, totalUndiscounted: 5000, imputedInterest: 400 } }));
    expect(byRef(items, '842-20-50-6').findings.slice(0, 3)).toEqual([
      'Total undiscounted payments \u2014 Finance: $5,000; Operating: $0.',
      'Imputed interest \u2014 Finance: $400; Operating: $0.',
      'Present value of lease liabilities recognized \u2014 $9,000; ROU asset balance \u2014 $8,000.',
    ]);
  });
});

describe('checklistItems', () => {
  it('hides the policy-election item and counts populated vs narrative', () => {
    const { visible, populated, narrative } = checklistItems(buildQualitativeDisclosures(input()));
    expect(visible.some((d) => d.ref === POLICY_ELECTIONS_REF)).toBe(false);
    expect(visible).toHaveLength(8);
    expect(populated).toBe(6);
    expect(narrative).toBe(2);
  });
});
