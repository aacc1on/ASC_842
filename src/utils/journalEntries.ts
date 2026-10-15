import { AmortizationSchedule, Lease } from '../types/lease';
import { round2 } from './leaseCalculations';

export interface JournalEntryRecord {
  entry_date: string;
  entry_type: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
}

export function generateOperatingLeaseJournalEntry(
  schedule: AmortizationSchedule
): JournalEntryRecord[] {
  const entries: JournalEntryRecord[] = [];
  const interest = schedule.interest_expense;
  const rouReduction = schedule.depreciation_expense;
  const leaseCost = round2(interest + rouReduction);
  const totalPayment = schedule.payment_amount;

  // Dr Operating Lease Expense = straight-line cost
  // Cr Lease Liability = interest accretion
  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Operating Lease Expense',
    account_name: 'Operating Lease Expense',
    debit_amount: leaseCost,
    credit_amount: 0,
    description: `Operating lease expense for period ${schedule.period_number}`,
  });

  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Operating Lease Expense',
    account_name: 'Lease Liability',
    debit_amount: 0,
    credit_amount: interest,
    description: `Interest accretion on lease liability for period ${schedule.period_number}`,
  });

  // Cr ROU Asset = straight-line cost - accretion
  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Operating Lease Expense',
    account_name: 'ROU Asset',
    debit_amount: 0,
    credit_amount: rouReduction,
    description: `ROU asset amortization for period ${schedule.period_number}`,
  });

  // Payment: Dr Lease Liability / Cr Cash
  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Operating Lease Payment',
    account_name: 'Lease Liability',
    debit_amount: totalPayment,
    credit_amount: 0,
    description: `Lease payment for period ${schedule.period_number}`,
  });

  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Operating Lease Payment',
    account_name: 'Cash',
    debit_amount: 0,
    credit_amount: totalPayment,
    description: `Cash paid for lease payment period ${schedule.period_number}`,
  });

  return entries;
}

export function generateFinanceLeaseJournalEntry(
  schedule: AmortizationSchedule
): JournalEntryRecord[] {
  const entries: JournalEntryRecord[] = [];

  // Interest accrual — booked every period regardless of payment
  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Finance Lease Interest',
    account_name: 'Interest Expense',
    debit_amount: schedule.interest_expense,
    credit_amount: 0,
    description: `Interest expense on finance lease for period ${schedule.period_number}`,
  });

  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Finance Lease Interest',
    account_name: 'Lease Liability',
    debit_amount: 0,
    credit_amount: schedule.interest_expense,
    description: `Interest accrual on lease liability for period ${schedule.period_number}`,
  });

  // Cash settlement — only when a payment is made this period
  if (schedule.payment_amount > 0) {
    entries.push({
      entry_date: schedule.period_date,
      entry_type: 'Finance Lease Payment',
      account_name: 'Lease Liability',
      debit_amount: schedule.principal_reduction,
      credit_amount: 0,
      description: `Principal portion of lease payment applied for period ${schedule.period_number}`,
    });

    entries.push({
      entry_date: schedule.period_date,
      entry_type: 'Finance Lease Payment',
      account_name: 'Lease Liability',
      debit_amount: schedule.interest_expense,
      credit_amount: 0,
      description: `Interest portion of lease payment settled for period ${schedule.period_number}`,
    });

    entries.push({
      entry_date: schedule.period_date,
      entry_type: 'Finance Lease Payment',
      account_name: 'Cash',
      debit_amount: 0,
      credit_amount: schedule.payment_amount,
      description: `Cash paid for lease payment period ${schedule.period_number}`,
    });
  }

  // Depreciation — booked every period
  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Finance Lease Depreciation',
    account_name: 'Depreciation Expense',
    debit_amount: schedule.depreciation_expense,
    credit_amount: 0,
    description: `Depreciation of ROU asset for period ${schedule.period_number}`,
  });

  entries.push({
    entry_date: schedule.period_date,
    entry_type: 'Finance Lease Depreciation',
    account_name: 'Accumulated Depreciation - ROU Asset',
    debit_amount: 0,
    credit_amount: schedule.depreciation_expense,
    description: `Accumulated depreciation for period ${schedule.period_number}`,
  });

  return entries;
}

export function generateModificationRemeasurementEntry(
  _leaseId: string,
  modificationDate: string,
  oldRouAsset: number,
  newRouAsset: number,
  oldLiability: number,
  newLiability: number,
  reason: string,
  _leaseClassification: 'operating' | 'finance'
): JournalEntryRecord[] {
  const entries: JournalEntryRecord[] = [];

  const liabilityChange = newLiability - oldLiability;
  const rouChange = newRouAsset - oldRouAsset;

  if (liabilityChange > 0) {
    entries.push({
      entry_date: modificationDate,
      entry_type: 'Lease Modification',
      account_name: 'Right-of-Use Asset',
      debit_amount: Math.abs(liabilityChange),
      credit_amount: 0,
      description: `Lease modification remeasurement — liability increase: ${reason}`,
    });
    entries.push({
      entry_date: modificationDate,
      entry_type: 'Lease Modification',
      account_name: 'Lease Liability',
      debit_amount: 0,
      credit_amount: Math.abs(liabilityChange),
      description: `Lease modification remeasurement — lease liability remeasured: ${reason}`,
    });
  } else if (liabilityChange < 0) {
    entries.push({
      entry_date: modificationDate,
      entry_type: 'Lease Modification',
      account_name: 'Lease Liability',
      debit_amount: Math.abs(liabilityChange),
      credit_amount: 0,
      description: `Lease modification remeasurement — liability decrease: ${reason}`,
    });
    entries.push({
      entry_date: modificationDate,
      entry_type: 'Lease Modification',
      account_name: 'Right-of-Use Asset',
      debit_amount: 0,
      credit_amount: Math.abs(liabilityChange),
      description: `Lease modification remeasurement — ROU asset adjusted: ${reason}`,
    });
  }

  const diff = rouChange - liabilityChange;
  if (Math.abs(diff) > 0.01) {
    if (diff > 0) {
      entries.push({
        entry_date: modificationDate,
        entry_type: 'Lease Modification',
        account_name: 'Right-of-Use Asset',
        debit_amount: Math.abs(diff),
        credit_amount: 0,
        description: `Lease modification — gain on remeasurement adjustment`,
      });
      entries.push({
        entry_date: modificationDate,
        entry_type: 'Lease Modification',
        account_name: 'Gain on Lease Modification',
        debit_amount: 0,
        credit_amount: Math.abs(diff),
        description: `Gain recognized on lease modification: ${reason}`,
      });
    } else {
      entries.push({
        entry_date: modificationDate,
        entry_type: 'Lease Modification',
        account_name: 'Lease Modification Loss',
        debit_amount: Math.abs(diff),
        credit_amount: 0,
        description: `Loss recognized on lease modification: ${reason}`,
      });
      entries.push({
        entry_date: modificationDate,
        entry_type: 'Lease Modification',
        account_name: 'Right-of-Use Asset',
        debit_amount: 0,
        credit_amount: Math.abs(diff),
        description: `Lease modification — ROU asset reduced by loss`,
      });
    }
  }

  return entries;
}

export function generateInitialRecognitionEntry(
  _leaseId: string,
  rouAsset: number,
  leaseLiability: number,
  startDate: string,
  leaseClassification: 'operating' | 'finance',
  lease?: Lease
): JournalEntryRecord[] {
  const entries: JournalEntryRecord[] = [];
  const idc = Number(lease?.initial_direct_costs) || 0;
  const incentives = Number(lease?.lease_incentives) || 0;
  const prepaid = Number(lease?.prepaid_lease_payments) || 0;

  entries.push({
    entry_date: startDate,
    entry_type: 'Initial Recognition',
    account_name: 'Right-of-Use Asset',
    debit_amount: rouAsset,
    credit_amount: 0,
    description: `Initial recognition of ${leaseClassification} lease ROU asset`,
  });

  entries.push({
    entry_date: startDate,
    entry_type: 'Initial Recognition',
    account_name: 'Lease Liability',
    debit_amount: 0,
    credit_amount: leaseLiability,
    description: `Initial recognition of ${leaseClassification} lease liability (PV of future payments)`,
  });

  if (idc > 0) {
    entries.push({
      entry_date: startDate,
      entry_type: 'Initial Recognition',
      account_name: 'Cash / Accounts Payable',
      debit_amount: 0,
      credit_amount: idc,
      description: `Initial direct costs capitalized into ROU asset`,
    });
  }

  // Payments made at or before commencement: one combined line, a reclass out of Prepaid Rent if it
  // was already recorded as an asset, otherwise the cash paid (same convention as the event ledger).
  if (prepaid > 0) {
    entries.push({
      entry_date: startDate,
      entry_type: 'Initial Recognition',
      account_name: 'Prepaid Rent (Cash)',
      debit_amount: 0,
      credit_amount: prepaid,
      description: `Prepaid lease payments capitalized into ROU asset`,
    });
  }

  if (incentives > 0) {
    entries.push({
      entry_date: startDate,
      entry_type: 'Initial Recognition',
      account_name: 'Cash / Lease Incentive Receivable',
      debit_amount: incentives,
      credit_amount: 0,
      description: `Lease incentives received reduce ROU asset`,
    });
  }

  // Mirrors the event ledger's ROU adjustment so the entry balances when the ROU differs from its parts.
  const diff = round2(rouAsset - (leaseLiability + idc + prepaid - incentives));
  if (diff > 0) {
    entries.push({
      entry_date: startDate,
      entry_type: 'Initial Recognition',
      account_name: 'Lease Liability',
      debit_amount: 0,
      credit_amount: diff,
      description: `ROU asset adjustment`,
    });
  } else if (diff < 0) {
    entries.push({
      entry_date: startDate,
      entry_type: 'Initial Recognition',
      account_name: 'Lease Expense',
      debit_amount: -diff,
      credit_amount: 0,
      description: `ROU asset adjustment`,
    });
  }

  return entries;
}

export type JournalEntryStatus = 'posted' | 'projected';

const EVENT_ENTRY_TYPES = new Set(['Initial Recognition', 'Lease Modification', 'Lease Cancellation']);

/**
 * Event entries are recorded when the event is saved or approved. Periodic
 * entries are posted once a month-end close has been posted for that month.
 */
export function journalEntryStatus(
  entry: { entry_date: string; entry_type: string },
  postedMonths: ReadonlySet<string>,
): JournalEntryStatus {
  if (EVENT_ENTRY_TYPES.has(entry.entry_type)) return 'posted';
  return postedMonths.has(entry.entry_date.slice(0, 7)) ? 'posted' : 'projected';
}

export function totalsByStatus(
  entries: { entry_date: string; entry_type: string; debit_amount: number; credit_amount: number }[],
  postedMonths: ReadonlySet<string>,
): Record<JournalEntryStatus, { count: number; debits: number; credits: number }> {
  const totals = {
    posted: { count: 0, debits: 0, credits: 0 },
    projected: { count: 0, debits: 0, credits: 0 },
  };
  for (const e of entries) {
    const t = totals[journalEntryStatus(e, postedMonths)];
    t.count++;
    t.debits += Number(e.debit_amount) || 0;
    t.credits += Number(e.credit_amount) || 0;
  }
  return totals;
}
