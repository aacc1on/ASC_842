import { CreditCard, ExternalLink, FileText } from 'lucide-react';
import type { StripeInvoice } from '../../hooks/useBillingData';
import { formatBillingDate } from '../../utils/formatting';

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount == null || !currency) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
}

const STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  paid: { label: 'Paid', classes: 'bg-emerald-50 text-emerald-700' },
  open: { label: 'Open', classes: 'bg-amber-50 text-amber-700' },
  uncollectible: { label: 'Failed', classes: 'bg-red-50 text-red-700' },
  void: { label: 'Void', classes: 'bg-slate-100 text-slate-600' },
};

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export function PaymentHistory({ invoices }: { invoices: StripeInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">No payment history yet</p>
        <p className="text-xs text-slate-500 mt-1">Your invoices and receipts will appear here after subscribing.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-base font-extrabold text-slate-900">Payment History</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Plan</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Period</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Amount</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map(invoice => {
              const statusCfg = STATUS_LABELS[invoice.status] ?? { label: invoice.status, classes: 'bg-slate-100 text-slate-600' };
              return (
                <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-700">{formatBillingDate(invoice.invoice_date)}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {invoice.plan_key ? PLAN_LABELS[invoice.plan_key] ?? invoice.plan_key : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {invoice.period_start && invoice.period_end
                      ? `${formatBillingDate(invoice.period_start)} – ${formatBillingDate(invoice.period_end)}`
                      : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(invoice.amount_due, invoice.currency)}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusCfg.classes}`}>
                      {statusCfg.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {invoice.hosted_invoice_url && (
                      <a
                        href={invoice.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View
                      </a>
                    )}
                    {invoice.invoice_pdf_url && (
                      <a
                        href={invoice.invoice_pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium ml-3"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
