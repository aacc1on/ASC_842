import { describe, expect, it } from 'vitest';
import type { Lease } from '../../types/lease';
import {
  buildPaymentReminder,
  buildPaymentReminders,
  compareRemindersByDue,
  computeDaysUntil,
  computeNextPaymentDate,
  formatDaysUntil,
  formatReminderCurrency,
  formatReminderDate,
  frequencyLabel,
  getPaymentUrgency,
  groupRemindersByLessor,
  summarizeLessorGroup,
  summarizeReminders,
} from './paymentReminders';

const TODAY = new Date(2025, 5, 15); // Jun 15 2025, local midnight

function lease(overrides: Partial<Lease>): Lease {
  return {
    id: 'l1',
    lease_name: 'Lease',
    lessor_name: 'Lessor',
    lease_classification: 'operating',
    lease_start_date: '2024-01-01',
    lease_end_date: '2030-12-31',
    lease_term_months: 24,
    payment_amount: 1000,
    payment_frequency: 'monthly',
    payment_day_of_month: 20,
    ...overrides,
  } as Lease;
}

function ymd(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('frequencyLabel', () => {
  it('maps known frequencies and passes unknown through', () => {
    expect(frequencyLabel('monthly')).toBe('Monthly');
    expect(frequencyLabel('quarterly')).toBe('Quarterly');
    expect(frequencyLabel('semi_annually')).toBe('Semi-Annually');
    expect(frequencyLabel('annually')).toBe('Annually');
    expect(frequencyLabel('weekly')).toBe('Weekly');
    expect(frequencyLabel('biweekly')).toBe('biweekly');
  });
});

describe('computeNextPaymentDate', () => {
  it('returns this month when the day is today or later', () => {
    expect(ymd(computeNextPaymentDate(15, TODAY))).toBe('2025-06-15');
    expect(ymd(computeNextPaymentDate(20, TODAY))).toBe('2025-06-20');
  });

  it('rolls to next month when the day has passed', () => {
    expect(ymd(computeNextPaymentDate(10, TODAY))).toBe('2025-07-10');
  });

  it('returns null for missing or out-of-range days', () => {
    expect(computeNextPaymentDate(null, TODAY)).toBeNull();
    expect(computeNextPaymentDate(0, TODAY)).toBeNull();
    expect(computeNextPaymentDate(32, TODAY)).toBeNull();
  });

  it('keeps native Date overflow semantics for short months', () => {
    // Jun 31 overflows to Jul 1, which is not before today.
    expect(ymd(computeNextPaymentDate(31, TODAY))).toBe('2025-07-01');
    // Feb 30 overflows to Mar 2, which is not before Feb 10.
    expect(ymd(computeNextPaymentDate(30, new Date(2025, 1, 10)))).toBe('2025-03-02');
  });

  it('rolls a passed day into a shorter month using native overflow', () => {
    // Jan 30 has passed on Jan 31 -> Feb 30 overflows to Mar 2.
    expect(ymd(computeNextPaymentDate(30, new Date(2025, 0, 31)))).toBe('2025-03-02');
    // Apr 31 overflows to May 1, which is not before Apr 30.
    expect(ymd(computeNextPaymentDate(31, new Date(2025, 3, 30)))).toBe('2025-05-01');
  });
});

describe('computeDaysUntil and getPaymentUrgency', () => {
  it('computes whole days to the next date', () => {
    expect(computeDaysUntil(new Date(2025, 5, 20), TODAY)).toBe(5);
    expect(computeDaysUntil(new Date(2025, 5, 15), TODAY)).toBe(0);
    expect(computeDaysUntil(new Date(2025, 5, 12), TODAY)).toBe(-3);
    expect(computeDaysUntil(null, TODAY)).toBeNull();
  });

  it('buckets urgency by 0/3/14 day thresholds', () => {
    expect(getPaymentUrgency(null)).toBe('none');
    expect(getPaymentUrgency(-1)).toBe('overdue');
    expect(getPaymentUrgency(0)).toBe('soon');
    expect(getPaymentUrgency(3)).toBe('soon');
    expect(getPaymentUrgency(4)).toBe('upcoming');
    expect(getPaymentUrgency(14)).toBe('upcoming');
    expect(getPaymentUrgency(15)).toBe('none');
  });
});

describe('buildPaymentReminder(s)', () => {
  it('builds a reminder with labels, numbers and urgency', () => {
    const l = lease({ payment_day_of_month: 17, payment_amount: '250.5' as unknown as number, payment_frequency: 'quarterly' });
    const r = buildPaymentReminder(l, TODAY);
    expect(r.lease).toBe(l);
    expect(r.paymentDay).toBe(17);
    expect(r.paymentAmount).toBe(250.5);
    expect(r.frequency).toBe('Quarterly');
    expect(ymd(r.nextDate)).toBe('2025-06-17');
    expect(r.daysUntil).toBe(2);
    expect(r.urgency).toBe('soon');
  });

  it('handles missing day and invalid amount', () => {
    const r = buildPaymentReminder(lease({ payment_day_of_month: undefined, payment_amount: NaN }), TODAY);
    expect(r.paymentDay).toBeNull();
    expect(r.paymentAmount).toBe(0);
    expect(r.nextDate).toBeNull();
    expect(r.daysUntil).toBeNull();
    expect(r.urgency).toBe('none');
  });

  it('sorts by days until with no-date reminders last, stable for ties', () => {
    const list = buildPaymentReminders([
      lease({ id: 'nodate', payment_day_of_month: null }),
      lease({ id: 'far', payment_day_of_month: 1 }),
      lease({ id: 'near', payment_day_of_month: 16 }),
      lease({ id: 'near2', payment_day_of_month: 16 }),
    ], TODAY);
    expect(list.map(r => r.lease.id)).toEqual(['near', 'near2', 'far', 'nodate']);
  });

  it('compareRemindersByDue treats null as 999', () => {
    const a = buildPaymentReminder(lease({ payment_day_of_month: null }), TODAY);
    const b = buildPaymentReminder(lease({ payment_day_of_month: 20 }), TODAY);
    expect(compareRemindersByDue(a, b)).toBe(999 - 5);
  });
});

describe('summaries and grouping', () => {
  const reminders = [
    { ...buildPaymentReminder(lease({ id: 'a', lessor_name: 'Zeta', payment_amount: 100 }), TODAY), urgency: 'overdue' as const },
    { ...buildPaymentReminder(lease({ id: 'b', lessor_name: 'Acme', payment_amount: 200, payment_day_of_month: 16 }), TODAY) },
    { ...buildPaymentReminder(lease({ id: 'c', lessor_name: '', payment_amount: 400, payment_day_of_month: null }), TODAY) },
    { ...buildPaymentReminder(lease({ id: 'd', lessor_name: 'Acme', payment_amount: 800, payment_day_of_month: 25 }), TODAY) },
  ];

  it('summarizeReminders splits by urgency and totals overdue + soon', () => {
    const s = summarizeReminders(reminders);
    expect(s.overdue.map(r => r.lease.id)).toEqual(['a']);
    expect(s.soon.map(r => r.lease.id)).toEqual(['b']);
    expect(s.noDate.map(r => r.lease.id)).toEqual(['c']);
    expect(s.totalDue).toBe(300);
  });

  it('groupRemindersByLessor groups, labels blanks and sorts by name', () => {
    const groups = groupRemindersByLessor(reminders);
    expect(groups.map(([name]) => name)).toEqual(['Acme', 'Unknown Lessor', 'Zeta']);
    expect(groups[0][1].map(r => r.lease.id)).toEqual(['b', 'd']);
  });

  it('summarizeLessorGroup totals amounts and counts overdue/soon', () => {
    expect(summarizeLessorGroup(reminders)).toEqual({ groupTotal: 1500, groupOverdue: 1, groupSoon: 1 });
    expect(summarizeLessorGroup([])).toEqual({ groupTotal: 0, groupOverdue: 0, groupSoon: 0 });
  });
});

describe('formatting', () => {
  it('formats dates or an em dash', () => {
    expect(formatReminderDate(new Date(2025, 0, 5))).toBe('Jan 5, 2025');
    expect(formatReminderDate(null)).toBe('—');
  });

  it('formats currency without cents and treats NaN as zero', () => {
    expect(formatReminderCurrency(1234.56)).toBe('$1,235');
    expect(formatReminderCurrency(NaN)).toBe('$0');
  });

  it('formats days until', () => {
    expect(formatDaysUntil(5)).toBe('5d');
    expect(formatDaysUntil(0)).toBe('0d');
    expect(formatDaysUntil(-3)).toBe('3d ago');
  });
});
