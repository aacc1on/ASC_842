import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeModification,
  applyModification,
  type CarryingAmounts,
} from './leaseModification';
import { determineLeaseClassification } from './leaseClassification';
import { generateMonthEndTransactions, type StoredScheduleMap } from './monthEndTransactions';
import { calculateTermMonths, calculateNoncancellableTermMonths } from '../components/lease-form/leaseFormCalculations';
import type { LeaseFormData } from '../components/lease-form/types';
import type { Lease } from '../types/lease';

// Mock supabase for applyModification tests.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2028-12-01',
    lease_term_months: 36,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    incremental_borrowing_rate: 6,
    discount_rate: 6,
    lease_classification: 'operating',
    initial_direct_costs: 0,
    lease_incentives: 0,
    rou_asset: 32871.02,
    lease_liability: 32871.02,
    status: 'active',
    payment_timing: 'beginning',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: 0,
    asset_fair_value: 35000,
    asset_market_value: 35000,
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: false,
    accounting_treatment: 'recognized',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Lease;
}

function makeFormData(overrides: Partial<LeaseFormData> = {}): LeaseFormData {
  return {
    lease_name: 'Test Lease',
    lease_description: '',
    lessor_name: 'Test Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2029-01-01',
    lease_term_months: 36,
    payment_amount: '1000',
    payment_frequency: 'monthly',
    incremental_borrowing_rate: '6',
    lease_classification: 'operating',
    initial_direct_costs: '0',
    lease_incentives: '0',
    payment_timing: 'beginning',
    payment_day_of_month: '',
    transfer_ownership: false,
    purchase_option: false,
    purchase_option_price: '0',
    asset_fair_value: '35000',
    asset_market_value: '0',
    asset_economic_life_months: '60',
    specialized_asset: false,
    residual_value_guarantee: '0',
    rvg_probable_amount: '0',
    auto_classified: false,
    branch_id: '',
    fixed_asset_type_id: '',
    implicit_rate: '',
    implicit_rate_readily_determinable: false,
    risk_free_rate: '',
    risk_free_rate_source: '',
    risk_free_rate_date: '',
    discount_rate_method: 'ibr',
    discount_rate: '',
    rate_source: '',
    rate_date: '',
    risk_free_policy_election_id: '',
    accounting_treatment: 'recognized',
    short_term_policy_election_id: '',
    lease_component_amount: '',
    nonlease_component_amount: '',
    component_policy: 'not_applicable',
    component_policy_election_id: '',
    related_party: false,
    related_party_name: '',
    purchase_option_reasonably_certain: false,
    renewal_months_reasonably_certain: 0,
    renewal_payment_amount: '',
    termination_option_month: '',
    termination_option_reasonably_certain: false,
    termination_penalty_amount: 0,
    prepaid_lease_payments: 0,
    status: 'active',
    ...overrides,
  } as unknown as LeaseFormData;
}

const baseOptions = {
  purchaseOptionPrice: 0,
  purchaseOptionReasonablyCertain: false,
  rvgProbableAmount: 0,
  amortizeOverUsefulLife: false,
  usefulLifeMonths: undefined,
};

/** Build a chainable supabase mock that records updates per table. */
function makeSupabaseMock(opts: {
  modRow?: Record<string, unknown>;
  scheduleRows?: Record<string, unknown>[];
  postedCount?: number | null;
}) {
  const updates: Record<string, Record<string, unknown>[]> = {};
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const deletes: Record<string, number> = {};

  const modRow = opts.modRow ?? { accounting_posted: false };
  const scheduleRows = opts.scheduleRows ?? [];
  const postedCount = opts.postedCount ?? 0;

  function makeChain(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {};

    // Terminal thenable — resolves to { data, error, count }
    const resolveData = (data: unknown, count: number | null = null) => {
      chain.then = (resolve: (v: { data: unknown; error: null; count: number | null }) => void) =>
        resolve({ data, error: null, count });
      return chain;
    };

    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.not = () => chain;
    chain.gte = () => chain;
    chain.gt = () => chain;
    chain.lte = () => chain;
    chain.in = () => chain;
    chain.order = () => chain;
    chain.range = () => chain;
    chain.limit = () => chain;

    chain.single = () => {
      resolveData(modRow);
      return chain;
    };
    chain.maybeSingle = () => {
      resolveData(modRow);
      return chain;
    };

    chain.update = (payload: Record<string, unknown>) => {
      (updates[table] ??= []).push(payload);
      // After update, the chain resolves to { data: null, error: null }
      resolveData(null);
      return chain;
    };

    chain.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      (inserts[table] ??= []).push(...arr);
      resolveData(null);
      return chain;
    };

    chain.delete = () => {
      deletes[table] = (deletes[table] ?? 0) + 1;
      resolveData(null);
      return chain;
    };

    // For schedule select queries that return rows
    if (table === 'amortization_schedules' && scheduleRows.length > 0) {
      resolveData(scheduleRows);
    }

    // For the hasPostedMonthEnd count query (transactions, head:true, count)
    if (table === 'transactions') {
      resolveData(null, postedCount);
    }

    // For lease_transactions insert
    if (table === 'lease_transactions') {
      resolveData(null);
    }

    return chain;
  }

  const fromFn = vi.fn((table: string) => makeChain(table));
  return { from: fromFn, updates, inserts, deletes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: Separate-contract modification posts nothing
// ---------------------------------------------------------------------------
describe('Separate-contract modification posts nothing', () => {
  it('applyModification with separateContract=true does not remeasure, post journals, or update lease', async () => {
    const lease = makeLease();
    const mock = makeSupabaseMock({
      modRow: { accounting_posted: false, separate_contract: true },
      postedCount: 0,
    });

    const supabaseMod = await import('../lib/supabase');
    (supabaseMod.supabase as unknown as { from: ReturnType<typeof vi.fn> }).from = mock.from;

    const result = await applyModification(
      'mod-1',
      lease,
      '2026-06-01',
      1200,
      24,
      6,
      'user-1',
      true, // separateContract
      null,
      null,
    );

    // Result is zeros — no remeasurement performed
    expect(result.newLiability).toBe(0);
    expect(result.newRouAsset).toBe(0);
    expect(result.remainingSchedule).toHaveLength(0);

    // No journal entries inserted
    expect(mock.inserts['lease_transactions']).toBeUndefined();

    // Lease table was NOT updated (no remeasurement)
    expect(mock.updates['leases']).toBeUndefined();

    // Amortization schedule was NOT deleted or inserted
    expect(mock.deletes['amortization_schedules']).toBeUndefined();
    expect(mock.inserts['amortization_schedules']).toBeUndefined();

    // contract_modifications was updated with accounting_posted + reassessed_classification
    expect(mock.updates['contract_modifications']).toBeDefined();
    const modUpdate = mock.updates['contract_modifications'][0];
    expect(modUpdate.accounting_posted).toBe(true);
    expect(modUpdate.reassessed_classification).toBe('separate_contract');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Modification reclassification operating -> finance
// ---------------------------------------------------------------------------
describe('Modification reclassification operating -> finance', () => {
  it('stores reassessed_classification and builds finance schedule when term >= 75% of remaining economic life', () => {
    // Original lease: 36-month term, 5-year (60-month) economic life → 36/60 = 60% → operating.
    // After 12 months, modify: remaining term 48 months, remaining economic life 48 months.
    // 48/48 = 100% >= 75% → finance.
    const lease = makeLease({
      lease_classification: 'operating',
      lease_term_months: 36,
      asset_economic_life_months: 60, // 60 months
      asset_fair_value: 50000,
      payment_amount: 1000,
      discount_rate: 6,
      incremental_borrowing_rate: 6,
    });

    const carrying: CarryingAmounts = {
      rouAsset: 28000,
      leaseLiability: 28000,
      periodsCompleted: 12,
    };

    // Compute the modification using the ORIGINAL classification (operating)
    const operatingResult = computeModification(lease, carrying, 1000, 48, 6, {
      ...baseOptions,
      classification: 'operating',
    });

    // Now reclassify at the modification date: 48 remaining months / 48 remaining
    // economic life months = 100% >= 75% → finance.
    const remainingEconomicLifeMonths = 48;
    const classificationResult = determineLeaseClassification({
      leaseTermMonths: 48,
      assetEconomicLifeMonths: remainingEconomicLifeMonths, // 48 months
      presentValue: operatingResult.newLiability,
      assetFairValue: 50000,
      transferOwnership: false,
      purchaseOption: false,
      purchaseOptionReasonablyCertain: false,
      purchaseOptionPrice: 0,
      specializedAsset: false,
    });

    expect(classificationResult.classification).toBe('finance');
    expect(classificationResult.tests.majorPartOfLife).toBe(true);

    // Rebuild the schedule with the reassessed (finance) classification
    const financeResult = computeModification(lease, carrying, 1000, 48, 6, {
      ...baseOptions,
      classification: 'finance',
    });

    // Finance schedule has interest > 0 and depreciation > 0 (not straight-line single cost)
    const hasInterest = financeResult.remainingSchedule.some((r) => r.interest_expense > 0);
    const hasDepreciation = financeResult.remainingSchedule.some((r) => r.depreciation_expense > 0);
    expect(hasInterest).toBe(true);
    expect(hasDepreciation).toBe(true);

    // The reassessed classification differs from the original
    expect(classificationResult.classification).not.toBe(lease.lease_classification);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Reasonably certain purchase option keeps price in liability
// ---------------------------------------------------------------------------
describe('Modification with reasonably certain purchase option keeps price in liability', () => {
  it('computeModification includes PV of purchase option price in remeasured liability', () => {
    const lease = makeLease({
      lease_classification: 'finance',
      purchase_option: true,
      purchase_option_price: 5000,
      purchase_option_reasonably_certain: true,
    });

    const carrying: CarryingAmounts = {
      rouAsset: 25000,
      leaseLiability: 24000,
      periodsCompleted: 12,
    };

    // With the purchase option reasonably certain
    const withOption = computeModification(lease, carrying, 1000, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 5000,
      purchaseOptionReasonablyCertain: true,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // Without the purchase option
    const withoutOption = computeModification(lease, carrying, 1000, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 0,
      purchaseOptionReasonablyCertain: false,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    // The liability with the option must be greater (PV of 5000 added)
    expect(withOption.newLiability).toBeGreaterThan(withoutOption.newLiability);

    // The difference should be the PV of 5000 discounted 24 months at 6%
    const monthlyRate = 6 / 100 / 12;
    const expectedPv = 5000 / Math.pow(1 + monthlyRate, 24);
    expect(withOption.newLiability - withoutOption.newLiability).toBeCloseTo(expectedPv, 1);
  });

  it('adds purchase option price as final-period payment in the schedule', () => {
    const lease = makeLease({
      lease_classification: 'finance',
      purchase_option: true,
      purchase_option_price: 5000,
      purchase_option_reasonably_certain: true,
    });

    const carrying: CarryingAmounts = {
      rouAsset: 25000,
      leaseLiability: 24000,
      periodsCompleted: 12,
    };

    const result = computeModification(lease, carrying, 1000, 24, 6, {
      classification: 'finance',
      purchaseOptionPrice: 5000,
      purchaseOptionReasonablyCertain: true,
      rvgProbableAmount: 0,
      amortizeOverUsefulLife: false,
      usefulLifeMonths: undefined,
    });

    const lastRow = result.remainingSchedule[result.remainingSchedule.length - 1];
    // The final payment includes the 5000 purchase option price
    expect(lastRow.payment_amount).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Month-end posts depreciation in month 40 of a 36-month finance lease
//         with 60-month useful life
// ---------------------------------------------------------------------------
describe('Month-end posts depreciation beyond lease term for finance lease amortized over useful life', () => {
  it('posts depreciation in month 40 (4 months past lease end) from stored schedule', () => {
    const lease = makeLease({
      lease_classification: 'finance',
      lease_term_months: 36,
      lease_start_date: '2026-01-01',
      transfer_ownership: true,
      asset_economic_life_months: 60, // 60 months
      accounting_treatment: 'recognized',
    });

    // Build a 60-row stored schedule: 36 rows with payments, 24 depreciation-only.
    const storedRows: Record<string, unknown>[] = [];
    const startDate = new Date(2026, 0, 1);
    const monthlyDepreciation = 500; // simplification
    for (let i = 0; i < 60; i++) {
      const periodDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const isPostLease = i >= 36;
      const isFinalLease = i === 35;
      storedRows.push({
        period_number: i + 1,
        period_date: periodDate.toISOString().split('T')[0],
        beginning_liability: isPostLease ? 0 : 20000,
        payment_amount: isPostLease ? 0 : 1000,
        interest_expense: isPostLease ? 0 : 100,
        principal_reduction: isPostLease ? 0 : 900,
        ending_liability: isPostLease ? 0 : (isFinalLease ? 0 : 19100),
        rou_asset_balance: isPostLease ? Math.max(0, 18000 - (i - 36) * monthlyDepreciation) : 18000,
        depreciation_expense: isPostLease ? monthlyDepreciation : monthlyDepreciation,
      });
    }

    const storedSchedules: StoredScheduleMap = new Map();
    storedSchedules.set(lease.id, storedRows as never);

    // Month 40 = 2029-04 (start 2026-01 + 39 months = 2029-04, 0-indexed)
    // periodYearMonth for 2029-04 = 2029*12 + 4
    // leaseEndYearMonth = 2026*12 + 1 + 36 - 1 = ... let's just compute:
    // lease end = 2026-01 + 36 months → 2029-01 → endYearMonth = 2029*12 + 1
    // Month 40 → 2029-04 → 2029*12 + 4 > endYearMonth → past lease end.
    const transactions = generateMonthEndTransactions([lease], '2029-04', storedSchedules);

    // Should post a depreciation (amortization) transaction
    const amortizationTx = transactions.find((t) => t.transaction_type === 'amortization');
    expect(amortizationTx).toBeDefined();
    expect(amortizationTx!.debit_amount).toBe(monthlyDepreciation);

    // Should NOT post a payment (past lease term)
    const paymentTx = transactions.find((t) => t.transaction_type === 'payment');
    expect(paymentTx).toBeUndefined();

    // Should NOT post interest (past lease term)
    const interestTx = transactions.find((t) => t.transaction_type === 'interest');
    expect(interestTx).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 5: lease_end_date for 36 + 24 renewal months
// ---------------------------------------------------------------------------
describe('lease_end_date for 36 + 24 renewal months', () => {
  it('calculateTermMonths returns 60 when renewal_months_reasonably_certain is 24 and noncancellable is 36', () => {
    const data = makeFormData({
      lease_term_months: 36,
      lease_end_date: '2029-01-01',
      renewal_months_reasonably_certain: 24,
      renewal_payment_amount: '1000',
    });

    const noncancellable = calculateNoncancellableTermMonths(data);
    const total = calculateTermMonths(data);

    expect(noncancellable).toBe(36);
    expect(total).toBe(60);
  });

  it('accounting end date is 60 months from start when renewal is reasonably certain', () => {
    const data = makeFormData({
      lease_term_months: 36,
      lease_end_date: '2029-01-01', // 36 months from 2026-01-01
      renewal_months_reasonably_certain: 24,
      renewal_payment_amount: '1000',
    });

    const termMonths = calculateTermMonths(data);
    expect(termMonths).toBe(60);

    // Replicate the computation in useLeaseFormActions:
    const noncancellable = calculateNoncancellableTermMonths(data);
    const [sdY, sdM, sdD] = String(data.lease_start_date).split('T')[0].split('-').map(Number);
    const startDate = new Date(sdY, (sdM || 1) - 1, sdD || 1);
    const accountingEndDate = new Date(startDate.getFullYear(), startDate.getMonth() + termMonths, startDate.getDate());
    const accountingEndDateStr = `${accountingEndDate.getFullYear()}-${String(accountingEndDate.getMonth() + 1).padStart(2, '0')}-${String(accountingEndDate.getDate()).padStart(2, '0')}`;

    // 2026-01 + 60 months = 2031-01-01
    expect(accountingEndDateStr).toBe('2031-01-01');

    // Since termMonths (60) !== noncancellable (36), the override kicks in
    expect(termMonths).not.toBe(noncancellable);
    const overrideEndDate =
      termMonths !== noncancellable || data.termination_option_reasonably_certain
        ? accountingEndDateStr
        : data.lease_end_date;
    expect(overrideEndDate).toBe('2031-01-01');
    expect(overrideEndDate).not.toBe(data.lease_end_date);
  });
});
