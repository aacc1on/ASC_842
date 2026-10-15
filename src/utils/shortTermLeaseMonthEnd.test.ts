import { describe, it, expect } from 'vitest';
import { generateMonthEndTransactions } from './monthEndTransactions';
import { buildStoredSchedulesForLeases } from './testScheduleHelper';
import type { Lease } from '../types/lease';
import type { PaymentTranche } from './leaseCalculations';

function makeExemptLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'exempt-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    lease_name: 'Vehicle Lease',
    lease_description: '',
    lessor_name: 'Lessor',
    lessor_type: 'corporate',
    lease_start_date: '2026-01-01',
    lease_end_date: '2026-10-31',
    lease_term_months: 10,
    payment_amount: 1000,
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
    asset_economic_life_months: 60,
    specialized_asset: false,
    residual_value_guarantee: 0,
    auto_classified: false,
    accounting_treatment: 'short_term_exemption',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function makeRecognizedLease(overrides: Partial<Lease> = {}): Lease {
  return {
    ...makeExemptLease(),
    id: 'recog-1',
    lease_name: 'Office Lease',
    lease_term_months: 36,
    lease_end_date: '2028-12-31',
    rou_asset: 32871,
    lease_liability: 32871,
    accounting_treatment: 'recognized',
    ...overrides,
  };
}

describe('Month-end: short-term exempt lease entries', () => {
  it('posts Dr Short-Term Lease Expense / Cr Cash for even payments', () => {
    const lease = makeExemptLease();
    const txns = generateMonthEndTransactions([lease], '2026-03');
    expect(txns.length).toBeGreaterThanOrEqual(1);

    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    expect(expenseTxn!.debit_amount).toBe(1000);

    const cashTxn = txns.find((t) => t.account_credited === 'Cash');
    expect(cashTxn).toBeDefined();
    expect(cashTxn!.credit_amount).toBe(1000);
  });

  it('every entry balances (debit = credit per entry)', () => {
    const lease = makeExemptLease({ payment_amount: 1200 });
    const txns = generateMonthEndTransactions([lease], '2026-02');
    for (const t of txns) {
      expect(t.debit_amount).toBe(t.credit_amount);
    }
  });

  it('does not post ROU depreciation or interest for exempt leases', () => {
    const lease = makeExemptLease();
    const txns = generateMonthEndTransactions([lease], '2026-03');
    const hasInterest = txns.some((t) => t.transaction_type === 'interest');
    const hasAmortization = txns.some((t) => t.transaction_type === 'amortization');
    const hasOperatingExpense = txns.some((t) => t.transaction_type === 'operating_lease_expense');
    expect(hasInterest).toBe(false);
    expect(hasAmortization).toBe(false);
    expect(hasOperatingExpense).toBe(false);
  });

  it('recognized leases are unchanged (still post operating expense and payment)', () => {
    const lease = makeRecognizedLease();
    const stored = buildStoredSchedulesForLeases([lease]);
    const txns = generateMonthEndTransactions([lease], '2026-03', stored);
    const hasOperatingExpense = txns.some((t) => t.transaction_type === 'operating_lease_expense');
    const hasPayment = txns.some((t) => t.transaction_type === 'payment');
    expect(hasOperatingExpense).toBe(true);
    expect(hasPayment).toBe(true);
  });
});

describe('Month-end: prepaid case (payment > straight-line expense)', () => {
  it('creates Dr Expense + Dr Prepaid / Cr Cash entries when payment exceeds expense', () => {
    // 10-month lease, total payments = 10 * 1500 = 15000, straight-line = 1500
    // But with variable tranches: months 1-5 at 2000, months 6-10 at 1000
    // Total = 5*2000 + 5*1000 = 15000, straight-line = 1500
    // Period 1 (month 1): payment = 2000, expense = 1500 → prepaid = 500
    const tranches: PaymentTranche[] = [
      { fromMonth: 1, toMonth: 5, paymentAmount: 2000 },
      { fromMonth: 6, toMonth: 10, paymentAmount: 1000 },
    ];
    const lease = makeExemptLease({ payment_amount: 2000, paymentTranches: tranches });
    const txns = generateMonthEndTransactions([lease], '2026-01');

    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    expect(expenseTxn!.debit_amount).toBe(1500);

    const prepaidTxn = txns.find((t) => t.account_debited === 'Prepaid Short-Term Lease');
    expect(prepaidTxn).toBeDefined();
    expect(prepaidTxn!.debit_amount).toBe(500);

    // Total Cash credited = 1500 + 500 = 2000 = period payment
    const totalCashCredited = txns
      .filter((t) => t.account_credited === 'Cash')
      .reduce((s, t) => s + t.credit_amount, 0);
    expect(totalCashCredited).toBe(2000);

    // Total debits = total credits
    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(totalDebits).toBe(totalCredits);
  });
});

describe('Month-end: accrued case (expense > payment)', () => {
  it('creates Dr Expense / Cr Cash + Cr Accrued entries when expense exceeds payment', () => {
    // 10-month lease, variable tranches: months 1-5 at 500, months 6-10 at 2500
    // Total = 5*500 + 5*2500 = 15000, straight-line = 1500
    // Period 1 (month 1): payment = 500, expense = 1500 → accrued = 1000
    const tranches: PaymentTranche[] = [
      { fromMonth: 1, toMonth: 5, paymentAmount: 500 },
      { fromMonth: 6, toMonth: 10, paymentAmount: 2500 },
    ];
    const lease = makeExemptLease({ payment_amount: 500, paymentTranches: tranches });
    const txns = generateMonthEndTransactions([lease], '2026-01');

    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense' && t.account_credited === 'Cash');
    expect(expenseTxn).toBeDefined();
    expect(expenseTxn!.debit_amount).toBe(1500);
    expect(expenseTxn!.credit_amount).toBe(500);

    const accruedTxn = txns.find((t) => t.account_credited === 'Accrued Short-Term Lease Liability');
    expect(accruedTxn).toBeDefined();
    expect(accruedTxn!.credit_amount).toBe(1000);

    // Total Cash credited = 500 (the period payment)
    const totalCashCredited = txns
      .filter((t) => t.account_credited === 'Cash')
      .reduce((s, t) => s + t.credit_amount, 0);
    expect(totalCashCredited).toBe(500);

    // Total debits = total credits
    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(totalDebits).toBe(totalCredits);
  });
});

describe('Month-end: variable tranches with free-rent month', () => {
  it('posts accrued entry when payment is 0 (free-rent) but expense is straight-line', () => {
    // 10-month lease, months 1-2 free (0), months 3-10 at 1875
    // Total = 0*2 + 1875*8 = 15000, straight-line = 1500
    // Period 1 (month 1): payment = 0, expense = 1500 → accrued = 1500
    const tranches: PaymentTranche[] = [
      { fromMonth: 1, toMonth: 2, paymentAmount: 0 },
      { fromMonth: 3, toMonth: 10, paymentAmount: 1875 },
    ];
    const lease = makeExemptLease({ payment_amount: 0, paymentTranches: tranches });
    const txns = generateMonthEndTransactions([lease], '2026-01');

    // Expense entry: Dr Expense 1500, Cr Cash 0
    const expenseTxn = txns.find((t) => t.account_debited === 'Short-Term Lease Expense');
    expect(expenseTxn).toBeDefined();
    expect(expenseTxn!.debit_amount).toBe(1500);
    expect(expenseTxn!.credit_amount).toBe(0);

    // Accrued entry: Cr Accrued 1500
    const accruedTxn = txns.find((t) => t.account_credited === 'Accrued Short-Term Lease Liability');
    expect(accruedTxn).toBeDefined();
    expect(accruedTxn!.credit_amount).toBe(1500);

    // No prepaid
    const hasPrepaid = txns.some((t) => t.account_debited === 'Prepaid Short-Term Lease');
    expect(hasPrepaid).toBe(false);

    // Total debits = total credits
    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(totalDebits).toBe(totalCredits);
  });

  it('posts normal payment entry after free-rent period ends', () => {
    // Same lease as above, period 3 (month 3): payment = 1875, expense = 1500 → prepaid = 375
    const tranches: PaymentTranche[] = [
      { fromMonth: 1, toMonth: 2, paymentAmount: 0 },
      { fromMonth: 3, toMonth: 10, paymentAmount: 1875 },
    ];
    const lease = makeExemptLease({ payment_amount: 0, paymentTranches: tranches });
    const txns = generateMonthEndTransactions([lease], '2026-03');

    const prepaidTxn = txns.find((t) => t.account_debited === 'Prepaid Short-Term Lease');
    expect(prepaidTxn).toBeDefined();
    expect(prepaidTxn!.debit_amount).toBe(375);

    const totalCashCredited = txns
      .filter((t) => t.account_credited === 'Cash')
      .reduce((s, t) => s + t.credit_amount, 0);
    expect(totalCashCredited).toBe(1875);
  });
});

describe('Month-end: periods outside lease term', () => {
  it('creates no entries before lease commencement', () => {
    const lease = makeExemptLease({ lease_start_date: '2026-03-01' });
    const txns = generateMonthEndTransactions([lease], '2026-01');
    expect(txns.length).toBe(0);
  });

  it('creates no entries after lease end', () => {
    // 10-month lease starting 2026-01, ends after 2026-10
    const lease = makeExemptLease({ lease_start_date: '2026-01-01', lease_term_months: 10 });
    const txns = generateMonthEndTransactions([lease], '2026-12');
    expect(txns.length).toBe(0);
  });
});

describe('Month-end: 12-month short-term lease boundary', () => {
  it('12-month lease starting 2026-01 has entries in 2026-12 but none in 2027-01', () => {
    const lease = makeExemptLease({
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-12-31',
      lease_term_months: 12,
      payment_amount: 1000,
    });

    const decTxns = generateMonthEndTransactions([lease], '2026-12');
    expect(decTxns.length).toBeGreaterThan(0);

    const janTxns = generateMonthEndTransactions([lease], '2027-01');
    expect(janTxns.length).toBe(0);
  });

  it('sum of 12 months of expense equals total payments', () => {
    const lease = makeExemptLease({
      lease_start_date: '2026-01-01',
      lease_end_date: '2026-12-31',
      lease_term_months: 12,
      payment_amount: 1000,
    });

    let totalExpense = 0;
    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`;
      const txns = generateMonthEndTransactions([lease], period);
      const expense = txns
        .filter((t) => t.account_debited === 'Short-Term Lease Expense')
        .reduce((s, t) => s + t.debit_amount, 0);
      totalExpense += expense;
    }
    expect(totalExpense).toBe(12000);
  });
});

describe('Month-end: total debits = total credits across all entries', () => {
  it('total debits equal total credits for exempt lease', () => {
    const lease = makeExemptLease();
    const txns = generateMonthEndTransactions([lease], '2026-05');
    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(totalDebits).toBe(totalCredits);
  });

  it('total debits equal total credits for mixed portfolio', () => {
    const exempt = makeExemptLease();
    const recognized = makeRecognizedLease();
    const stored = buildStoredSchedulesForLeases([exempt, recognized]);
    const txns = generateMonthEndTransactions([exempt, recognized], '2026-03', stored);
    const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
    expect(totalDebits).toBe(totalCredits);
  });
});
