/**
 * Normalizes a raw transaction type string into a human-readable label.
 * Pure function.
 */
export function normalizeEntryType(rawType: string): string {
  const aliases: Record<string, string> = {
    initial_recognition: 'Initial Recognition',
    payment: 'Lease Payment',
    lease_payment: 'Lease Payment',
    interest: 'Interest Accrual',
    interest_accrual: 'Interest Accrual',
    interest_expense: 'Interest Accrual',
    amortization: 'Depreciation',
    depreciation: 'Depreciation',
    depreciation_expense: 'Depreciation',
    operating_lease_expense: 'Operating Lease Expense',
    month_end_catch_up: 'Month-End Catch-Up',
    modification: 'Modification',
    remeasurement: 'Remeasurement',
    termination: 'Termination',
    lease_cancellation: 'Lease Cancellation',
    derecognition: 'Derecognition',
    prepayment: 'Prepayment',
  };
  const key = (rawType || '').toLowerCase();
  return aliases[key] || rawType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}
