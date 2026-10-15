import { type Lease } from '../../../types/lease';
import { isActiveLease } from '../../../utils/leaseLifecycle';
import {
  buildPaymentReminders,
  formatDaysUntil,
  formatReminderCurrency,
  formatReminderDate,
  groupRemindersByLessor,
  summarizeLessorGroup,
  summarizeReminders,
} from '../../../utils/reports/paymentReminders';
import { DollarSign, Building2, Calendar, AlertTriangle, Bell } from 'lucide-react';

export function PaymentReminderReport({ leases }: { leases: Lease[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeLeases = leases.filter((l) => isActiveLease(l));

  const reminders = buildPaymentReminders(activeLeases, today);

  const { overdue, soon, noDate, totalDue } = summarizeReminders(reminders);

  const lessorGroups = groupRemindersByLessor(reminders);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Total Active</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{reminders.length}</p>
          <p className="text-xs text-slate-500 mt-1">leases with payments</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <span className="text-xs font-bold uppercase tracking-wide text-red-600">Overdue</span>
          </div>
          <p className="text-2xl font-bold text-red-700">{overdue.length}</p>
          <p className="text-xs text-red-500 mt-1">payments past due</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-amber-600" />
            <span className="text-xs font-bold uppercase tracking-wide text-amber-600">Due Soon</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">{soon.length}</p>
          <p className="text-xs text-amber-500 mt-1">within 3 days</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-bold uppercase tracking-wide text-emerald-600">Amount Due</span>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{formatReminderCurrency(totalDue)}</p>
          <p className="text-xs text-emerald-500 mt-1">overdue + due soon</p>
        </div>
      </div>

      {reminders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No active leases</p>
          <p className="text-sm text-slate-500 mt-1">Payment reminders will appear here once you have active leases with a payment date set.</p>
        </div>
      ) : (
        <>
          {/* Payment schedule table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Bell className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Payment Schedule</h3>
                  <p className="text-xs text-slate-500">Upcoming lease payments sorted by due date</p>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Lessor</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Lease</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Frequency</th>
                    <th className="text-center px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Payment Day</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Next Payment</th>
                    <th className="text-center px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Days Until</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Amount</th>
                    <th className="text-center px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reminders.map((r) => (
                    <tr key={r.lease.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900">{r.lessorName || '—'}</td>
                      <td className="px-5 py-3 text-slate-700">{r.leaseName}</td>
                      <td className="px-5 py-3 text-slate-600">{r.frequency}</td>
                      <td className="px-5 py-3 text-center text-slate-700">
                        {r.paymentDay ? `Day ${r.paymentDay}` : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-700 whitespace-nowrap">{formatReminderDate(r.nextDate)}</td>
                      <td className="px-5 py-3 text-center">
                        {r.daysUntil !== null ? (
                          <span className={
                            r.urgency === 'overdue' ? 'text-red-700 font-bold' :
                            r.urgency === 'soon' ? 'text-amber-700 font-bold' :
                            'text-slate-700'
                          }>
                            {formatDaysUntil(r.daysUntil)}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatReminderCurrency(r.paymentAmount)}</td>
                      <td className="px-5 py-3 text-center">
                        {r.urgency === 'overdue' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                            <AlertTriangle className="w-3 h-3" /> Overdue
                          </span>
                        ) : r.urgency === 'soon' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                            <Bell className="w-3 h-3" /> Due Soon
                          </span>
                        ) : r.urgency === 'upcoming' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                            <Calendar className="w-3 h-3" /> Upcoming
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold">
                            No Date
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Grouped by Lessor */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-600 p-2 rounded-lg">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Payment Reminders by Lessor</h3>
                  <p className="text-xs text-slate-500">Lease payments grouped by lessor for easy reference</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {lessorGroups.map(([lessorName, groupReminders]) => {
                const { groupTotal, groupOverdue, groupSoon } = summarizeLessorGroup(groupReminders);
                return (
                  <div key={lessorName} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-500" />
                        <h4 className="font-bold text-slate-900">{lessorName}</h4>
                        <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                          {groupReminders.length} lease{groupReminders.length === 1 ? '' : 's'}
                        </span>
                        {groupOverdue > 0 && (
                          <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                            {groupOverdue} overdue
                          </span>
                        )}
                        {groupSoon > 0 && (
                          <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            {groupSoon} due soon
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        Total: {formatReminderCurrency(groupTotal)}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {groupReminders.map((r) => (
                        <div key={r.lease.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3">
                            <div className={
                              r.urgency === 'overdue' ? 'w-2 h-2 rounded-full bg-red-500' :
                              r.urgency === 'soon' ? 'w-2 h-2 rounded-full bg-amber-500' :
                              r.urgency === 'upcoming' ? 'w-2 h-2 rounded-full bg-blue-400' :
                              'w-2 h-2 rounded-full bg-slate-300'
                            } />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{r.leaseName}</p>
                              <p className="text-xs text-slate-500">
                                {r.frequency} &middot; {r.paymentDay ? `Day ${r.paymentDay}` : 'No date set'} &middot; Next: {formatReminderDate(r.nextDate)}
                                {r.daysUntil !== null && r.daysUntil >= 0 && ` (${r.daysUntil}d)`}
                                {r.daysUntil !== null && r.daysUntil < 0 && ` (${Math.abs(r.daysUntil)}d overdue)`}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-slate-900">{formatReminderCurrency(r.paymentAmount)}</p>
                            {r.urgency === 'overdue' ? (
                              <p className="text-xs font-semibold text-red-600">Pay now</p>
                            ) : r.urgency === 'soon' ? (
                              <p className="text-xs font-semibold text-amber-600">Due soon</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {noDate.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
              <strong>{noDate.length}</strong> lease{noDate.length === 1 ? '' : 's'} have no payment date set. Edit the lease to specify a payment day of the month for accurate reminders.
            </div>
          )}
        </>
      )}
    </div>
  );
}
