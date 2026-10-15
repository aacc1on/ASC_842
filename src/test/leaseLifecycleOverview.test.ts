import { describe, it, expect } from 'vitest';
import type { Lease } from '../types/lease';
import { isMissingClassificationData, leaseLifecycle } from '../utils/leaseLifecycle';
import { summarizePortfolio } from '../utils/portfolioOverview';

const AS_OF = '2026-10-11';

function lease(overrides: Partial<Lease>): Lease {
  return {
    id: 'l',
    status: 'active',
    lease_start_date: '2026-01-01',
    lease_end_date: '2027-12-31',
    lease_classification: 'operating',
    accounting_treatment: 'recognized',
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 5,
    asset_market_value: 100000,
    asset_economic_life_months: 120,
    currentBalances: { currentRouAsset: 0, currentLiability: 0 },
    ...overrides,
  } as Lease;
}

describe('lease lifecycle', () => {
  it('classifies by status and dates', () => {
    expect(leaseLifecycle(lease({}), AS_OF)).toBe('active');
    expect(leaseLifecycle(lease({ lease_start_date: '2026-11-01' }), AS_OF)).toBe('not_started');
    expect(leaseLifecycle(lease({ lease_end_date: '2026-10-10' }), AS_OF)).toBe('ended');
    expect(leaseLifecycle(lease({ status: 'terminated' }), AS_OF)).toBe('ended');
    expect(leaseLifecycle(lease({ lease_start_date: AS_OF, lease_end_date: AS_OF }), AS_OF)).toBe('active');
  });
});

describe('missing classification data', () => {
  it('flags finance leases without fair value or useful life only', () => {
    expect(isMissingClassificationData(lease({ lease_classification: 'finance', asset_market_value: 0 }))).toBe(true);
    expect(isMissingClassificationData(lease({ lease_classification: 'finance', asset_economic_life_months: null as never }))).toBe(true);
    expect(isMissingClassificationData(lease({ lease_classification: 'finance' }))).toBe(false);
    expect(isMissingClassificationData(lease({ asset_market_value: 0 }))).toBe(false);
    expect(isMissingClassificationData(lease({ lease_classification: 'finance', asset_market_value: 0, accounting_treatment: 'short_term_exemption' }))).toBe(false);
  });
});

describe('portfolio overview', () => {
  const leases = [
    lease({ id: 'a', incremental_borrowing_rate: 4, currentBalances: { currentRouAsset: 900, currentLiability: 1000 } }),
    lease({ id: 'b', discount_rate: 7, currentBalances: { currentRouAsset: 2800, currentLiability: 3000 } }),
    lease({ id: 'c', lease_end_date: '2026-01-31', incremental_borrowing_rate: 20, currentBalances: { currentRouAsset: 0, currentLiability: 0 } }),
    lease({ id: 'd', lease_start_date: '2027-01-01', incremental_borrowing_rate: 20, currentBalances: { currentRouAsset: 5000, currentLiability: 5000 } }),
    lease({ id: 'e', accounting_treatment: 'short_term_exemption', payment_amount: 500, currentBalances: { currentRouAsset: 0, currentLiability: 0 } }),
    lease({ id: 'f', payment_frequency: 'quarterly', payment_amount: 3000, incremental_borrowing_rate: 5, currentBalances: { currentRouAsset: 0, currentLiability: 0 } }),
  ];
  const r = summarizePortfolio(leases, AS_OF);

  it('counts active leases by date', () => {
    expect(r.totalLeases).toBe(6);
    expect(r.activeLeases).toBe(4);
  });

  it('uses active, recognized leases for balances', () => {
    expect(r.totalRouAsset).toBe(3700);
    expect(r.totalLiability).toBe(4000);
  });

  it('weights the borrowing rate by remaining liability, in percent', () => {
    expect(r.avgBorrowingRate).toBeCloseTo((1000 * 4 + 3000 * 7) / 4000, 6);
  });

  it('includes active short-term leases in monthly payments and converts frequencies', () => {
    expect(r.totalMonthlyPayments).toBeCloseTo(1000 + 1000 + 500 + 1000, 6);
  });
});
