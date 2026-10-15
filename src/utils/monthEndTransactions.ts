import { Lease } from '../types/lease';
import { buildPaymentStream, type PaymentFrequency } from './leaseCalculations';
import { computeShortTermLeaseCost } from './shortTermLease';
import type { StoredScheduleMap, MonthEndTransaction, MonthEndResult, SkippedLease } from './monthEndTypes';

export type { StoredScheduleRow, StoredScheduleMap, MonthEndTransaction, MonthEndResult, SkippedLease } from './monthEndTypes';

function round2Diff(value: number): number {
  if (!isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Date a lease payment is actually made within a posting month: the lease's
 * payment day when set, otherwise the commencement day (payments in advance) or
 * the last day of the month (payments in arrears). Clamped to the month length
 * so a 31st or Feb 29 commencement pays on the last day of shorter months.
 */
export function paymentDateForPeriod(
  lease: Pick<Lease, 'lease_start_date' | 'payment_day_of_month' | 'payment_timing'>,
  periodYear: number,
  periodMonth: number,
): string {
  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  const startDay = Number(String(lease.lease_start_date).slice(8, 10)) || 1;
  const preferred = lease.payment_day_of_month
    ? Number(lease.payment_day_of_month)
    : lease.payment_timing === 'end' ? lastDay : startDay;
  const day = Math.min(Math.max(1, preferred), lastDay);
  return `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function generateMonthEndTransactions(
  leases: Lease[],
  period: string,
  storedSchedules?: StoredScheduleMap
): MonthEndTransaction[] {
  return generateMonthEndTransactionsWithSkips(leases, period, storedSchedules).transactions;
}

export function generateMonthEndTransactionsWithSkips(
  leases: Lease[],
  period: string,
  storedSchedules?: StoredScheduleMap
): MonthEndResult {
  const transactions: MonthEndTransaction[] = [];
  const skippedLeases: SkippedLease[] = [];

  const [yearStr, monthStr] = period.split('-');
  const periodYear = parseInt(yearStr);
  const periodMonth = parseInt(monthStr);

  const lastDayOfMonth = new Date(periodYear, periodMonth, 0).getDate();
  const transactionDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const seenLeaseIds = new Set<string>();

  leases.forEach((lease) => {
    if (lease.status !== 'active') return;
    if (seenLeaseIds.has(lease.id)) return;
    seenLeaseIds.add(lease.id);

    const [startYear, startMonth] = lease.lease_start_date.split('-').map(Number);
    const leaseStartYear = startYear;
    const leaseStartMonth = startMonth;

    const leaseEndYear = leaseStartYear + Math.floor((leaseStartMonth + lease.lease_term_months - 1) / 12);
    const leaseEndMonth = ((leaseStartMonth + lease.lease_term_months - 1) % 12) + 1;

    const periodYearMonth = periodYear * 12 + periodMonth;
    const startYearMonth = leaseStartYear * 12 + leaseStartMonth;
    const endYearMonth = leaseEndYear * 12 + leaseEndMonth;

    if (periodYearMonth < startYearMonth) return;

    // Short-term leases stop entirely at lease end (no depreciation to extend).
    if (lease.accounting_treatment === 'short_term_exemption') {
      if (periodYearMonth > endYearMonth) return;
    }

    const monthsSinceStart = periodYearMonth - startYearMonth;

    // Short-term lease exemption: straight-line expense + payment, no ROU or interest
    if (lease.accounting_treatment === 'short_term_exemption') {
      if (monthsSinceStart >= lease.lease_term_months) return;
      const stNonleaseAmt = Number(lease.nonlease_component_amount) || 0;
      const stIsCombined = lease.component_policy === 'combined';
      // When combined with tranches, add nonlease to each tranche (tranches are
      // stored lease-component-only; payment_amount already includes nonlease).
      let stEffectiveTranches = lease.paymentTranches;
      if (stIsCombined && stEffectiveTranches && stEffectiveTranches.length > 0 && stNonleaseAmt > 0) {
        stEffectiveTranches = stEffectiveTranches.map((t) => ({
          ...t,
          paymentAmount: t.paymentAmount + stNonleaseAmt,
        }));
      }
      const stFreq: PaymentFrequency = (['monthly','quarterly','semi_annually','annually','weekly'] as string[]).includes(lease.payment_frequency)
        ? (lease.payment_frequency as PaymentFrequency) : 'monthly';
      const paymentStream = buildPaymentStream(
        lease.lease_term_months,
        lease.payment_amount,
        stEffectiveTranches,
        stFreq,
        lease.payment_timing || 'beginning',
      );
      const totalPayments = paymentStream.reduce((s, p) => s + p, 0);
      const straightLineCost = computeShortTermLeaseCost(totalPayments, lease.lease_term_months);
      const shortTermId = lease.id.substring(0, 8);

      const periodPayment = paymentStream[monthsSinceStart] ?? 0;
      const expense = straightLineCost;
      const difference = round2Diff(expense - periodPayment);

      if (difference >= 0) {
        // Expense >= payment:
        // Dr Short-Term Lease Expense (expense)
        // Cr Cash (payment)
        // Cr Accrued Short-Term Lease Liability (expense - payment)
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'short_term_lease_expense',
          account_debited: 'Short-Term Lease Expense',
          account_credited: 'Cash',
          debit_amount: expense,
          credit_amount: periodPayment,
          description: `${lease.lease_name} - Short-term lease expense for ${period}`,
          reference_number: `ME-STL-EXP-${period}-${shortTermId}`,
          period: period,
        });
        if (difference > 0) {
          transactions.push({
            lease_id: lease.id,
            lease_name: lease.lease_name,
            transaction_date: transactionDate,
            transaction_type: 'short_term_lease_expense',
            account_debited: 'Short-Term Lease Expense',
            account_credited: 'Accrued Short-Term Lease Liability',
            debit_amount: 0,
            credit_amount: difference,
            description: `${lease.lease_name} - Accrued short-term lease liability for ${period}`,
            reference_number: `ME-STL-ACC-${period}-${shortTermId}`,
            period: period,
          });
        }
      } else {
        // Payment > expense:
        // Dr Short-Term Lease Expense (expense), Cr Cash (expense)
        // Dr Prepaid Short-Term Lease (prepaid), Cr Cash (prepaid)
        // Total Cash credited = expense + prepaid = payment
        const prepaid = -difference;
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'short_term_lease_expense',
          account_debited: 'Short-Term Lease Expense',
          account_credited: 'Cash',
          debit_amount: expense,
          credit_amount: expense,
          description: `${lease.lease_name} - Short-term lease expense for ${period}`,
          reference_number: `ME-STL-EXP-${period}-${shortTermId}`,
          period: period,
        });
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'short_term_lease_expense',
          account_debited: 'Prepaid Short-Term Lease',
          account_credited: 'Cash',
          debit_amount: prepaid,
          credit_amount: prepaid,
          description: `${lease.lease_name} - Prepaid short-term lease for ${period}`,
          reference_number: `ME-STL-PRE-${period}-${shortTermId}`,
          period: period,
        });
      }

      // Post nonlease component expense for separate-policy short-term leases
      if (lease.component_policy === 'separate' && stNonleaseAmt > 0) {
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'nonlease_component_expense',
          account_debited: 'Nonlease Component Expense',
          account_credited: 'Cash',
          debit_amount: stNonleaseAmt,
          credit_amount: stNonleaseAmt,
          description: `${lease.lease_name} - Nonlease component expense for ${period}`,
          reference_number: `ME-NLC-${period}-${lease.id.substring(0, 8)}`,
          period: period,
        });
      }

      return;
    }

    // For recognized leases, use the stored amortization schedule row
    // matched by period_number (months since lease start + 1), never by
    // date — date matching shifts in time zones east of UTC.
    const storedRows = storedSchedules?.get(lease.id);
    const targetPeriodNumber = monthsSinceStart + 1;
    const storedRow = storedRows?.find((r) => r.period_number === targetPeriodNumber);

    let interestExpense: number;
    let payment: number;
    let depreciation: number;

    if (storedRow) {
      interestExpense = Number(storedRow.interest_expense);
      payment = Number(storedRow.payment_amount);
      depreciation = Number(storedRow.depreciation_expense);
    } else if (!storedRows) {
      // No stored schedule rows exist at all. Skip this lease and record
      // the reason so the UI can show which leases were skipped.
      skippedLeases.push({
        lease_id: lease.id,
        lease_name: lease.lease_name,
        reason: 'No amortization schedule found. Please regenerate the schedule.',
      });
      return;
    } else {
      // Past the last stored row the lease is fully run off; nothing to post.
      const lastPeriodNumber = storedRows.reduce((m, r) => Math.max(m, Number(r.period_number)), 0);
      if (targetPeriodNumber > lastPeriodNumber && monthsSinceStart >= lease.lease_term_months) return;
      skippedLeases.push({
        lease_id: lease.id,
        lease_name: lease.lease_name,
        reason: `Schedule period ${targetPeriodNumber} for ${period} is missing. Please regenerate the schedule.`,
      });
      return;
    }

    const isOperating = lease.lease_classification === 'operating';

    if (isOperating) {
      // Operating lease: single lease expense + payment.
      // Interest and payment only accrue within the lease term.
      const withinLeaseTerm = monthsSinceStart < lease.lease_term_months;

      if (withinLeaseTerm) {
        // Entry 1: Dr Operating Lease Expense = interest accretion, Cr Lease Liability = interest
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'operating_lease_expense',
          account_debited: 'Operating Lease Expense',
          account_credited: 'Lease Liability',
          debit_amount: interestExpense,
          credit_amount: interestExpense,
          description: `${lease.lease_name} - Interest accretion on lease liability for ${period}`,
          reference_number: `ME-OLE-INT-${period}-${lease.id.substring(0, 8)}`,
          period: period,
        });

        // Entry 2: Dr Operating Lease Expense = ROU reduction, Cr ROU Asset = ROU reduction
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'operating_lease_expense',
          account_debited: 'Operating Lease Expense',
          account_credited: 'ROU Asset',
          debit_amount: depreciation,
          credit_amount: depreciation,
          description: `${lease.lease_name} - ROU asset amortization for ${period}`,
          reference_number: `ME-OLE-ROU-${period}-${lease.id.substring(0, 8)}`,
          period: period,
        });

        // Entry 3: Payment: Dr Lease Liability / Cr Cash (only when cash is paid this period)
        if (payment > 0) {
          transactions.push({
            lease_id: lease.id,
            lease_name: lease.lease_name,
            transaction_date: paymentDateForPeriod(lease, periodYear, periodMonth),
            transaction_type: 'payment',
            account_debited: 'Lease Liability',
            account_credited: 'Cash',
            debit_amount: payment,
            credit_amount: payment,
            description: `${lease.lease_name} - Lease payment for ${period}`,
            reference_number: `ME-PMT-${period}-${lease.id.substring(0, 8)}`,
            period: period,
          });
        }
      } else {
        // Post-lease-term: only depreciation (from stored schedule, if any)
        if (depreciation > 0) {
          transactions.push({
            lease_id: lease.id,
            lease_name: lease.lease_name,
            transaction_date: transactionDate,
            transaction_type: 'operating_lease_expense',
            account_debited: 'Operating Lease Expense',
            account_credited: 'ROU Asset',
            debit_amount: depreciation,
            credit_amount: depreciation,
            description: `${lease.lease_name} - ROU asset amortization for ${period}`,
            reference_number: `ME-OLE-ROU-${period}-${lease.id.substring(0, 8)}`,
            period: period,
          });
        }
      }
    } else {
      // Finance lease: interest + payment + depreciation.
      // Interest and payment only accrue within the lease term. When the
      // schedule extends beyond the lease term (finance lease amortized over
      // the useful life), post-lease-term rows carry only depreciation.
      const withinLeaseTerm = monthsSinceStart < lease.lease_term_months;

      if (withinLeaseTerm) {
        transactions.push({
          lease_id: lease.id,
          lease_name: lease.lease_name,
          transaction_date: transactionDate,
          transaction_type: 'interest',
          account_debited: 'Interest Expense',
          account_credited: 'Lease Liability',
          debit_amount: interestExpense,
          credit_amount: interestExpense,
          description: `${lease.lease_name} - Interest expense for ${period}`,
          reference_number: `ME-INT-${period}-${lease.id.substring(0, 8)}`,
          period: period,
        });

        if (payment > 0) {
          transactions.push({
            lease_id: lease.id,
            lease_name: lease.lease_name,
            transaction_date: paymentDateForPeriod(lease, periodYear, periodMonth),
            transaction_type: 'payment',
            account_debited: 'Lease Liability',
            account_credited: 'Cash',
            debit_amount: payment,
            credit_amount: payment,
            description: `${lease.lease_name} - Lease payment for ${period}`,
            reference_number: `ME-PMT-${period}-${lease.id.substring(0, 8)}`,
            period: period,
          });
        }
      }

      transactions.push({
        lease_id: lease.id,
        lease_name: lease.lease_name,
        transaction_date: transactionDate,
        transaction_type: 'amortization',
        account_debited: 'Depreciation Expense',
        account_credited: 'Accumulated Depreciation - ROU Asset',
        debit_amount: depreciation,
        credit_amount: depreciation,
        description: `${lease.lease_name} - ROU asset depreciation for ${period}`,
        reference_number: `ME-DEP-${period}-${lease.id.substring(0, 8)}`,
        period: period,
      });
    }

    // Nonlease component expense for separate-policy leases with nonlease amount > 0
    if (lease.component_policy === 'separate' && (lease.nonlease_component_amount ?? 0) > 0) {
      if (monthsSinceStart < lease.lease_term_months) {
        const nlcAmount = Number(lease.nonlease_component_amount) || 0;
        if (nlcAmount > 0) {
          transactions.push({
            lease_id: lease.id,
            lease_name: lease.lease_name,
            transaction_date: transactionDate,
            transaction_type: 'nonlease_component_expense',
            account_debited: 'Nonlease Component Expense',
            account_credited: 'Cash',
            debit_amount: nlcAmount,
            credit_amount: nlcAmount,
            description: `${lease.lease_name} - Nonlease component expense for ${period}`,
            reference_number: `ME-NLC-${period}-${lease.id.substring(0, 8)}`,
            period: period,
          });
        }
      }
    }
  });

  return { transactions, skippedLeases };
}

export {
  validateMonthEndPeriod,
  periodHasEnded,
  latestPostedBlocker,
  getCurrentPeriod,
  getPreviousPeriod,
  getNextPeriod,
  formatPeriodDisplay,
  summarizeMonthEndTransactions,
} from './monthEndPeriods';
