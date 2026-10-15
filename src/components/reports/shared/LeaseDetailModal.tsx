import { formatCurrencyVal } from './formatters';
import { type Lease } from '../../../types/lease';
import { X, Pencil } from 'lucide-react';

interface LeaseDetailModalProps {
  lease: Lease;
  onClose: () => void;
  onEdit: () => void;
}

export function LeaseDetailModal({ lease, onClose, onEdit }: LeaseDetailModalProps) {
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';
  const fmtBool = (b?: boolean | null) => b ? 'Yes' : 'No';
  const fmtMoney = (v?: number | null) => formatCurrencyVal(Number(v) || 0);
  const fmtPct = (v?: number | null) => `${(Number(v) || 0).toFixed(2)}%`;

  const sections: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: 'Lease Information',
      rows: [
        ['Lease Name', lease.lease_name],
        ['Description', lease.lease_description || '—'],
        ['Lessor', lease.lessor_name],
        ['Lessor Type', lease.lessor_type],
        ['Status', lease.status],
        ['Classification', lease.lease_classification],
      ],
    },
    {
      title: 'Term & Payments',
      rows: [
        ['Start Date', fmtDate(lease.lease_start_date)],
        ['End Date', fmtDate(lease.lease_end_date)],
        ['Term (months)', lease.lease_term_months],
        ['Payment Amount', fmtMoney(lease.payment_amount)],
        ['Payment Frequency', lease.payment_frequency],
        ['Payment Timing', lease.payment_timing],
        ['IBR', fmtPct(lease.incremental_borrowing_rate)],
        ['Discount Rate Method', lease.discount_rate_method || 'ibr'],
        ['Discount Rate', fmtPct(lease.discount_rate)],
        ['Rate Source', lease.rate_source || '—'],
      ],
    },
    {
      title: 'Asset & Options',
      rows: [
        ['Asset Fair Value', fmtMoney(lease.asset_fair_value)],
        ['Asset Market Value', fmtMoney(lease.asset_market_value)],
        ['Economic Life (months)', lease.asset_economic_life_months],
        ['Specialized Asset', fmtBool(lease.specialized_asset)],
        ['Transfer Ownership', fmtBool(lease.transfer_ownership)],
        ['Purchase Option', fmtBool(lease.purchase_option)],
        ['Purchase Option Price', fmtMoney(lease.purchase_option_price)],
        ['Residual Value Guarantee', fmtMoney(lease.residual_value_guarantee)],
      ],
    },
    {
      title: 'Recognition',
      rows: [
        ['Initial Direct Costs', fmtMoney(lease.initial_direct_costs)],
        ['Lease Incentives', fmtMoney(lease.lease_incentives)],
        ['ROU Asset', fmtMoney(lease.rou_asset)],
        ['Lease Liability', fmtMoney(lease.lease_liability)],
        ['Auto-Classified', fmtBool(lease.auto_classified)],
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-blue-900 text-white flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Lease Details</div>
            <h3 className="text-xl font-bold mt-0.5">{lease.lease_name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {sections.map((s) => (
            <div key={s.title} className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase">{s.title}</div>
              <dl className="divide-y divide-slate-200">
                {s.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between px-4 py-2.5 gap-4">
                    <dt className="text-xs font-semibold text-slate-500">{k}</dt>
                    <dd className="text-sm text-slate-900 text-right break-words">{v as React.ReactNode}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
