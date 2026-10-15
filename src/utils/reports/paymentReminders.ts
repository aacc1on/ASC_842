import type { Lease } from '../../types/lease';

export type PaymentUrgency = 'overdue' | 'soon' | 'upcoming' | 'none';

export interface PaymentReminder {
  lease: Lease;
  lessorName: string;
  leaseName: string;
  paymentDay: number | null;
  paymentAmount: number;
  frequency: string;
  nextDate: Date | null;
  daysUntil: number | null;
  urgency: PaymentUrgency;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const PAYMENT_FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', semi_annually: 'Semi-Annually',
  annually: 'Annually', weekly: 'Weekly',
};

/** Human label for a payment frequency; unknown values pass through unchanged. */
export function frequencyLabel(freq: string): string {
  return PAYMENT_FREQUENCY_LABELS[freq] || freq;
}

/**
 * Next payment date on or after `today` (local midnight) for a day-of-month.
 * Returns null when the day is missing or outside 1..31.
 */
export function computeNextPaymentDate(day: number | null, today: Date): Date | null {
  if (day && day >= 1 && day <= 31) {
    const d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d < today) d.setMonth(d.getMonth() + 1);
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (day > lastDayOfMonth) d.setDate(lastDayOfMonth);
    return d;
  }
  return null;
}

export function computeDaysUntil(nextDate: Date | null, today: Date): number | null {
  return nextDate ? Math.ceil((nextDate.getTime() - today.getTime()) / MS_PER_DAY) : null;
}

export function getPaymentUrgency(daysUntil: number | null): PaymentUrgency {
  let urgency: PaymentUrgency = 'none';
  if (daysUntil !== null) {
    if (daysUntil < 0) urgency = 'overdue';
    else if (daysUntil <= 3) urgency = 'soon';
    else if (daysUntil <= 14) urgency = 'upcoming';
  }
  return urgency;
}

export function buildPaymentReminder(l: Lease, today: Date): PaymentReminder {
  const day = l.payment_day_of_month ?? null;
  const paymentAmount = Number(l.payment_amount) || 0;
  const nextDate = computeNextPaymentDate(day, today);
  const daysUntil = computeDaysUntil(nextDate, today);
  return {
    lease: l,
    lessorName: l.lessor_name,
    leaseName: l.lease_name,
    paymentDay: day,
    paymentAmount,
    frequency: frequencyLabel(l.payment_frequency),
    nextDate,
    daysUntil,
    urgency: getPaymentUrgency(daysUntil),
  };
}

/** Sorts by days until due ascending; reminders without a date (null) sort as 999. */
export function compareRemindersByDue(a: PaymentReminder, b: PaymentReminder): number {
  const aVal = a.daysUntil ?? 999;
  const bVal = b.daysUntil ?? 999;
  return aVal - bVal;
}

/** Builds reminders for the given (already active-filtered) leases, sorted by due date. */
export function buildPaymentReminders(activeLeases: Lease[], today: Date): PaymentReminder[] {
  return activeLeases.map((l) => buildPaymentReminder(l, today)).sort(compareRemindersByDue);
}

export function summarizeReminders(reminders: PaymentReminder[]): {
  overdue: PaymentReminder[];
  soon: PaymentReminder[];
  noDate: PaymentReminder[];
  totalDue: number;
} {
  const overdue = reminders.filter((r) => r.urgency === 'overdue');
  const soon = reminders.filter((r) => r.urgency === 'soon');
  const noDate = reminders.filter((r) => r.urgency === 'none');
  const totalDue = [...overdue, ...soon].reduce((s, r) => s + r.paymentAmount, 0);
  return { overdue, soon, noDate, totalDue };
}

/** Groups reminders by lessor name ('Unknown Lessor' if blank), sorted by lessor name. */
export function groupRemindersByLessor(reminders: PaymentReminder[]): [string, PaymentReminder[]][] {
  const groupedByLessor = reminders.reduce<Record<string, PaymentReminder[]>>((acc, r) => {
    const key = r.lessorName || 'Unknown Lessor';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});
  return Object.entries(groupedByLessor).sort((a, b) => a[0].localeCompare(b[0]));
}

export function summarizeLessorGroup(groupReminders: PaymentReminder[]): {
  groupTotal: number;
  groupOverdue: number;
  groupSoon: number;
} {
  return {
    groupTotal: groupReminders.reduce((s, r) => s + r.paymentAmount, 0),
    groupOverdue: groupReminders.filter((r) => r.urgency === 'overdue').length,
    groupSoon: groupReminders.filter((r) => r.urgency === 'soon').length,
  };
}

export function formatReminderDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export function formatReminderCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

/** Days-until cell text: "5d" or "3d ago". */
export function formatDaysUntil(daysUntil: number): string {
  return daysUntil < 0 ? `${Math.abs(daysUntil)}d ago` : `${daysUntil}d`;
}
