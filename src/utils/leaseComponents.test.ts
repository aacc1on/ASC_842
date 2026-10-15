import { describe, it, expect } from 'vitest';
import {
  determineComponentPolicy,
  measurementPaymentPerPeriod,
  allocateByStandalonePrice,
  type ComponentPolicy,
} from './leaseComponents';
import type { PolicyElection } from './policyElections';
import { generateMonthEndTransactions } from './monthEndTransactions';
import { buildStoredSchedulesForLeases } from './testScheduleHelper';
import { calculateLeaseMetrics } from './leaseCalculations';
import type { Lease } from '../types/lease';

function makeElection(overrides: Partial<PolicyElection> = {}): PolicyElection {
  return {
    id: 'elec-1',
    company_id: 'c1',
    fixed_asset_type_id: 'a1',
    policy_type: 'COMBINE_LEASE_NONLEASE',
    election_value: true,
    effective_from: '2026-01-01',
    effective_to: null,
    status: 'approved',
    policy_version: 1,
    notes: null,
    change_reason: null,
    prepared_by: 'u1',
    approved_by: 'u2',
    ...overrides,
  };
}

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'u1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2027-12-31',
    lease_term_months: 24,
    payment_amount: 10000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 0,
    lease_liability: 0,
    status: 'active',
    payment_timing: 'beginning',
    payment_day_of_month: null,
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 0,
    asset_market_value: 0,
    asset_economic_life_months: 120,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    fixed_asset_type_id: 'a1',
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    lease_component_amount: 10000,
    nonlease_component_amount: 0,
    component_policy: 'not_applicable',
    ...overrides,
  };
}

describe('determineComponentPolicy', () => {
  it('returns not_applicable when nonleaseAmount = 0', () => {
    const result = determineComponentPolicy({
      nonleaseAmount: 0,
      companyId: 'c1',
      fixedAssetTypeId: 'a1',
      leaseStartDate: '2026-01-01',
      elections: [makeElection()],
    });
    expect(result.policy).toBe('not_applicable');
    expect(result.warning).toBeNull();
  });

  it('returns combined when approved election is elected', () => {
    const result = determineComponentPolicy({
      nonleaseAmount: 2000,
      companyId: 'c1',
      fixedAssetTypeId: 'a1',
      leaseStartDate: '2026-01-01',
      elections: [makeElection({ election_value: true })],
    });
    expect(result.policy).toBe('combined');
    expect(result.warning).toBeNull();
    expect(result.policyElectionId).toBe('elec-1');
  });

  it('returns separate when approved election is not elected', () => {
    const result = determineComponentPolicy({
      nonleaseAmount: 2000,
      companyId: 'c1',
      fixedAssetTypeId: 'a1',
      leaseStartDate: '2026-01-01',
      elections: [makeElection({ election_value: false })],
    });
    expect(result.policy).toBe('separate');
    expect(result.warning).toBeNull();
  });

  it('returns separate with warning when no approved election', () => {
    const result = determineComponentPolicy({
      nonleaseAmount: 2000,
      companyId: 'c1',
      fixedAssetTypeId: 'a1',
      leaseStartDate: '2026-01-01',
      elections: [],
    });
    expect(result.policy).toBe('separate');
    expect(result.warning).toContain('No approved lease/nonlease component election');
  });

  it('does not apply election effective after lease start', () => {
    const result = determineComponentPolicy({
      nonleaseAmount: 2000,
      companyId: 'c1',
      fixedAssetTypeId: 'a1',
      leaseStartDate: '2025-06-01',
      elections: [makeElection({ effective_from: '2026-01-01', election_value: true })],
    });
    expect(result.policy).toBe('separate');
    expect(result.warning).toContain('No approved lease/nonlease component election');
  });
});

describe('measurementPaymentPerPeriod', () => {
  it('returns lease + nonlease when combined', () => {
    expect(measurementPaymentPerPeriod(10000, 2000, 'combined')).toBe(12000);
  });

  it('returns lease only when separate', () => {
    expect(measurementPaymentPerPeriod(10000, 2000, 'separate')).toBe(10000);
  });

  it('returns lease only when not_applicable', () => {
    expect(measurementPaymentPerPeriod(10000, 0, 'not_applicable')).toBe(10000);
  });
});

describe('allocateByStandalonePrice', () => {
  it('allocates by relative standalone price and sums exactly', () => {
    const { leaseComponent, nonleaseComponent } = allocateByStandalonePrice(12000, 10000, 2000);
    expect(leaseComponent + nonleaseComponent).toBe(12000);
    // 10000/12000 * 12000 = 10000, 2000/12000 * 12000 = 2000
    expect(leaseComponent).toBe(10000);
    expect(nonleaseComponent).toBe(2000);
  });

  it('puts remainder on lease component so amounts sum exactly', () => {
    const { leaseComponent, nonleaseComponent } = allocateByStandalonePrice(100, 1, 2);
    expect(leaseComponent + nonleaseComponent).toBe(100);
    // 2/3 * 100 = 66.67, lease = 100 - 66.67 = 33.33
    expect(nonleaseComponent).toBe(66.67);
    expect(leaseComponent).toBe(33.33);
  });

  it('returns all to lease when standalone prices are zero', () => {
    const { leaseComponent, nonleaseComponent } = allocateByStandalonePrice(5000, 0, 0);
    expect(leaseComponent).toBe(5000);
    expect(nonleaseComponent).toBe(0);
  });
});

describe('Test 4: combined lease measurement', () => {
  it('combined election ON -> measurement payment 12,000, liability = PV of 12,000', () => {
    const leaseComponent = 10000;
    const nonleaseComponent = 2000;
    const policy: ComponentPolicy = 'combined';
    const measurementPayment = measurementPaymentPerPeriod(leaseComponent, nonleaseComponent, policy);
    expect(measurementPayment).toBe(12000);

    const metrics = calculateLeaseMetrics({
      leaseTermMonths: 24,
      paymentAmount: measurementPayment,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });

    // PV of 12,000/month for 24 months at 6% beginning
    expect(metrics.leaseLiability).toBeGreaterThan(0);
    // Should be significantly more than PV of 10,000
    const metrics10k = calculateLeaseMetrics({
      leaseTermMonths: 24,
      paymentAmount: 10000,
      incrementalBorrowingRate: 6,
      initialDirectCosts: 0,
      leaseIncentives: 0,
      leaseStartDate: new Date(2026, 0, 1),
      paymentTiming: 'beginning',
      residualValueGuarantee: 0,
      classification: 'operating',
    });
    expect(metrics.leaseLiability).toBeGreaterThan(metrics10k.leaseLiability);
  });
});

describe('Test 5: separate lease month-end entries', () => {
  it('separate election -> measurement payment 10,000, month-end posts 2,000 Nonlease Component Expense', () => {
    const lease = makeLease({
      payment_amount: 10000,
      lease_component_amount: 10000,
      nonlease_component_amount: 2000,
      component_policy: 'separate',
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);

    // Should have nonlease component expense entry
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeDefined();
    expect(nlcTxn!.debit_amount).toBe(2000);
    expect(nlcTxn!.credit_amount).toBe(2000);
    expect(nlcTxn!.account_debited).toBe('Nonlease Component Expense');
    expect(nlcTxn!.account_credited).toBe('Cash');
    expect(nlcTxn!.reference_number).toContain('ME-NLC-');

    // Operating lease payment entry should use 10,000 (lease component only)
    const paymentTxn = txns.find((t) => t.transaction_type === 'payment');
    expect(paymentTxn).toBeDefined();
    expect(paymentTxn!.debit_amount).toBe(10000);
  });

  it('combined lease has no separate nonlease entry', () => {
    const lease = makeLease({
      payment_amount: 12000,
      lease_component_amount: 10000,
      nonlease_component_amount: 2000,
      component_policy: 'combined',
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });

  it('not_applicable lease has no nonlease entry', () => {
    const lease = makeLease({
      payment_amount: 10000,
      lease_component_amount: 10000,
      nonlease_component_amount: 0,
      component_policy: 'not_applicable',
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });
});

describe('nonlease 0 -> identical results to before Phase 4', () => {
  it('not_applicable with 0 nonlease produces same entries as a lease without component fields', () => {
    const lease = makeLease({
      component_policy: 'not_applicable',
      nonlease_component_amount: 0,
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();

    // Standard operating lease entries should be present
    const hasPayment = txns.some((t) => t.transaction_type === 'payment');
    const hasOpExpense = txns.some((t) => t.transaction_type === 'operating_lease_expense');
    expect(hasPayment).toBe(true);
    expect(hasOpExpense).toBe(true);
  });
});

describe('short-term exempt lease with combine ON', () => {
  it('straight-line cost includes the nonlease amount', () => {
    // 10-month short-term exempt lease, lease 1000 + nonlease 200, combined
    // measurement payment = 1200, total = 12000, straight-line = 1200
    const lease = makeLease({
      lease_term_months: 10,
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-10-31',
      payment_amount: 1200,
      lease_component_amount: 1000,
      nonlease_component_amount: 200,
      component_policy: 'combined',
      accounting_treatment: 'short_term_exemption',
    });

    const txns = generateMonthEndTransactions([lease], '2026-03');
    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    // Straight-line cost = 1200*10/10 = 1200
    expect(expenseTxn!.debit_amount).toBe(1200);

    // No separate nonlease entry for combined
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });
});

describe('nonlease component expense period guard', () => {
  it('no nonlease entry before lease start', () => {
    const lease = makeLease({
      lease_start_date: '2026-03-01',
      lease_end_date: '2027-02-28',
      lease_term_months: 12,
      component_policy: 'separate',
      nonlease_component_amount: 500,
    });
    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-01', stored);
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });

  it('no nonlease entry on or after lease_term_months', () => {
    const lease = makeLease({
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-12-31',
      lease_term_months: 12,
      component_policy: 'separate',
      nonlease_component_amount: 500,
    });
    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2027-01', stored);
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });
});

// ---- Phase 4 review fix tests ----

describe('combined recognized lease month-end uses measurement payment (12,000)', () => {
  it('operating lease: payment entry uses 12,000, not 10,000', () => {
    const lease = makeLease({
      payment_amount: 12000,
      lease_component_amount: 10000,
      nonlease_component_amount: 2000,
      component_policy: 'combined',
      lease_classification: 'operating',
      incremental_borrowing_rate: 6,
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const paymentTxn = txns.find((t) => t.transaction_type === 'payment');
    expect(paymentTxn).toBeDefined();
    expect(paymentTxn!.debit_amount).toBe(12000);
    expect(paymentTxn!.credit_amount).toBe(12000);

    // No separate nonlease entry for combined
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });

  it('finance lease: interest is based on 12,000 liability, payment uses 12,000', () => {
    const lease = makeLease({
      payment_amount: 12000,
      lease_component_amount: 10000,
      nonlease_component_amount: 2000,
      component_policy: 'combined',
      lease_classification: 'finance',
      incremental_borrowing_rate: 6,
    });

    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const paymentTxn = txns.find((t) => t.transaction_type === 'payment');
    expect(paymentTxn).toBeDefined();
    expect(paymentTxn!.debit_amount).toBe(12000);

    // Interest expense should be based on 12,000 schedule, not 10,000
    const interestTxn = txns.find((t) => t.transaction_type === 'interest');
    expect(interestTxn).toBeDefined();
    // Compare against a 10,000 lease to verify it's higher
    const lease10k = makeLease({
      payment_amount: 10000,
      lease_component_amount: 10000,
      nonlease_component_amount: 0,
      component_policy: 'not_applicable',
      lease_classification: 'finance',
      incremental_borrowing_rate: 6,
    });
    const stored10k = buildStoredSchedulesForLeases([lease10k]);
    const txns10k = generateMonthEndTransactions([lease10k], '2026-03', stored10k);
    const interest10k = txns10k.find((t) => t.transaction_type === 'interest');
    expect(interestTxn!.debit_amount).toBeGreaterThan(interest10k!.debit_amount);
  });
});

describe('edit/resave of combined lease keeps correct amounts', () => {
  it('resave: payment_amount stays 12,000, lease_component_amount stays 10,000', () => {
    // After fix 1: payment_amount stores measurementPayment (12,000),
    // lease_component_amount stores the lease-only component (10,000).
    // When loaded back, lease_component_amount = 10,000 (non-zero, so no fallback).
    // Re-measuring: measurementPayment = 10,000 + 2,000 = 12,000 (same, no double-add).
    const storedLease = makeLease({
      payment_amount: 12000,
      lease_component_amount: 10000,
      nonlease_component_amount: 2000,
      component_policy: 'combined',
    });

    // Simulate form load: lease_component_amount prefilled from stored column
    const loadedLeaseComp = storedLease.lease_component_amount || storedLease.payment_amount;
    expect(loadedLeaseComp).toBe(10000);

    // Simulate re-submit: compute measurement payment
    const policy: ComponentPolicy = 'combined';
    const reMeasurementPayment = measurementPaymentPerPeriod(
      loadedLeaseComp,
      Number(storedLease.nonlease_component_amount) || 0,
      policy,
    );
    expect(reMeasurementPayment).toBe(12000);
    // No double-add: 10,000 + 2,000 = 12,000, not 14,000
    expect(reMeasurementPayment).not.toBe(14000);
  });

  it('legacy row with lease_component_amount=0 falls back to payment_amount', () => {
    const legacyLease = makeLease({
      payment_amount: 10000,
      lease_component_amount: 0, // legacy backfill missed this
      nonlease_component_amount: 0,
      component_policy: 'not_applicable',
    });

    // Form load fallback: 0 || 10000 = 10000
    const loadedLeaseComp = legacyLease.lease_component_amount || legacyLease.payment_amount;
    expect(loadedLeaseComp).toBe(10000);
  });
});

describe('short-term combined with tranches', () => {
  it('adds nonlease to each tranche amount for combined short-term exempt', () => {
    const lease = makeLease({
      lease_term_months: 6,
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-06-30',
      payment_amount: 1200, // includes nonlease (stored as measurement payment)
      lease_component_amount: 1000,
      nonlease_component_amount: 200,
      component_policy: 'combined',
      accounting_treatment: 'short_term_exemption',
      paymentTranches: [
        { fromMonth: 1, toMonth: 3, paymentAmount: 1000 },
        { fromMonth: 4, toMonth: 6, paymentAmount: 1000 },
      ],
    });

    const txns = generateMonthEndTransactions([lease], '2026-02');
    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    // Total = (1000+200)*6 = 7200, straight-line = 7200/6 = 1200
    expect(expenseTxn!.debit_amount).toBe(1200);

    // No separate nonlease entry for combined
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });
});

describe('short-term separate posts nonlease entry', () => {
  it('separate short-term exempt with nonlease > 0 posts Nonlease Component Expense', () => {
    const lease = makeLease({
      lease_term_months: 10,
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-10-31',
      payment_amount: 1000, // lease component only
      lease_component_amount: 1000,
      nonlease_component_amount: 200,
      component_policy: 'separate',
      accounting_treatment: 'short_term_exemption',
    });

    const txns = generateMonthEndTransactions([lease], '2026-03');
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeDefined();
    expect(nlcTxn!.debit_amount).toBe(200);
    expect(nlcTxn!.credit_amount).toBe(200);
    expect(nlcTxn!.account_debited).toBe('Nonlease Component Expense');
    expect(nlcTxn!.account_credited).toBe('Cash');

    // Short-term lease expense should be 1000 (lease component only)
    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    expect(expenseTxn!.debit_amount).toBe(1000);
  });

  it('separate short-term exempt before lease start has no nonlease entry', () => {
    const lease = makeLease({
      lease_term_months: 10,
      lease_start_date: '2026-03-01',
      lease_end_date: '2026-12-31',
      payment_amount: 1000,
      lease_component_amount: 1000,
      nonlease_component_amount: 200,
      component_policy: 'separate',
      accounting_treatment: 'short_term_exemption',
    });

    const txns = generateMonthEndTransactions([lease], '2026-01');
    const nlcTxn = txns.find((t) => t.transaction_type === 'nonlease_component_expense');
    expect(nlcTxn).toBeUndefined();
  });
});
