import type { Lease, AmortizationSchedule } from '../types/lease';
import {
  generateOperatingLeaseJournalEntry,
  generateFinanceLeaseJournalEntry,
  generateInitialRecognitionEntry,
  generateModificationRemeasurementEntry,
  type JournalEntryRecord,
} from './journalEntries';
import { calculatePresentValue } from './leaseCalculations';

export interface ApprovedModification {
  id: string;
  modification_date: string;
  old_monthly_payment: number;
  new_monthly_payment: number;
  old_lease_term: number;
  new_lease_term: number;
  old_discount_rate: number;
  new_discount_rate: number;
  reason: string;
  old_rou_asset: number | null;
  new_rou_asset: number | null;
  old_lease_liability: number | null;
  new_lease_liability: number | null;
}

export function computeRemeasuredValues(
  mod: ApprovedModification,
  priorEndingLiability: number,
  priorRouAsset: number
) {
  if (mod.new_lease_liability != null && mod.new_rou_asset != null) {
    return {
      remeasuredLiability: Number(mod.new_lease_liability),
      remeasuredRouAsset: Number(mod.new_rou_asset),
    };
  }

  const remainingMonths = mod.new_lease_term;
  const payment = mod.new_monthly_payment;

  const remeasuredLiability = calculatePresentValue(
    payment,
    remainingMonths,
    mod.new_discount_rate,
    'beginning'
  );

  const remeasuredRouAsset = priorRouAsset + (remeasuredLiability - priorEndingLiability);

  return { remeasuredLiability, remeasuredRouAsset };
}

export function buildLeaseJournalEntries(
  lease: Lease,
  schedule: AmortizationSchedule[],
  approvedMods: ApprovedModification[],
): (JournalEntryRecord & { amortization_id?: string })[] {
  const allEntries: (JournalEntryRecord & { amortization_id?: string })[] = [];

  // After a modification the lease row holds remeasured values, so derive the original ones from period 1.
  const firstRow = schedule[0];
  const useScheduleOrigin = approvedMods.length > 0 && firstRow;
  const initialRou = useScheduleOrigin
    ? Number(firstRow.rou_asset_balance) + Number(firstRow.depreciation_expense)
    : lease.rou_asset || 0;
  const initialLiability = useScheduleOrigin
    ? Number(firstRow.beginning_liability)
    : lease.lease_liability || 0;

  const initialEntries = generateInitialRecognitionEntry(
    lease.id,
    initialRou,
    initialLiability,
    lease.lease_start_date,
    lease.lease_classification,
    lease
  );
  allEntries.push(...initialEntries);

  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];

    for (const mod of approvedMods) {
      const modDate = mod.modification_date.split('T')[0];
      const rowDate = row.period_date.split('T')[0];

      const prevRow = i > 0 ? schedule[i - 1] : null;
      const prevDate = prevRow ? prevRow.period_date.split('T')[0] : null;

      const modIsOnThisBoundary =
        prevDate !== null && modDate > prevDate && modDate <= rowDate;
      const modIsBeforeFirstRow = i === 0 && modDate <= rowDate;

      if (modIsOnThisBoundary || modIsBeforeFirstRow) {
        const priorLiability = mod.old_lease_liability != null
          ? Number(mod.old_lease_liability)
          : prevRow ? parseFloat(String(prevRow.ending_liability)) : initialLiability;
        const priorRou = mod.old_rou_asset != null
          ? Number(mod.old_rou_asset)
          : prevRow ? parseFloat(String(prevRow.rou_asset_balance)) : initialRou;

        const { remeasuredLiability, remeasuredRouAsset } = computeRemeasuredValues(
          mod,
          priorLiability,
          priorRou
        );

        const modEntries = generateModificationRemeasurementEntry(
          lease.id,
          modDate,
          priorRou,
          remeasuredRouAsset,
          priorLiability,
          remeasuredLiability,
          mod.reason,
          lease.lease_classification
        );

        allEntries.push(...modEntries);
      }
    }

    const journalEntries =
      lease.lease_classification === 'finance'
        ? generateFinanceLeaseJournalEntry(row)
        : generateOperatingLeaseJournalEntry(row);

    journalEntries.forEach((entry) => {
      allEntries.push({
        amortization_id: row.id,
        ...entry,
      });
    });
  }

  return allEntries;
}
