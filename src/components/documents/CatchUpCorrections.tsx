import { useState } from 'react';
import { ChevronDown, ChevronRight, History, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { formatCurrency } from '../../utils/formatting';
import { formatPeriodDisplay } from '../../utils/monthEndTransactions';

import { useCatchUpBatches } from './useCatchUpBatches';
import { currentOrgId } from '../../utils/currentOrg';
import { useAsyncData } from '../../hooks/useAsyncData';
import { LoadError } from '../LoadError';

interface CatchUpLine {
  id: string;
  missed_period: string;
  component: 'interest' | 'amortization' | 'payment';
  account_debited: string;
  account_credited: string;
  amount: number;
}

const COMPONENT_LABEL: Record<CatchUpLine['component'], string> = {
  interest: 'Interest',
  amortization: 'ROU amortization',
  payment: 'Payment',
};

function BatchLines({ batchId }: { batchId: string }) {
  const { data: lines, error, retry } = useAsyncData<CatchUpLine[] | null>(async () => {
    const orgId = await currentOrgId();
    return fetchAll<CatchUpLine>('catch-up detail', (from, to) => supabase
      .from('month_end_catch_up_lines')
      .select('id, missed_period, component, account_debited, account_credited, amount')
      .eq('organization_id', orgId)
      .eq('batch_id', batchId)
      .order('missed_period')
      .order('component')
      .order('id')
      .range(from, to));
  }, [batchId], null, 'The month detail could not be loaded.');

  if (error) return <LoadError message={error} onRetry={retry} className="m-3" />;
  if (!lines) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
        <Loader className="w-4 h-4 animate-spin" /> Loading month detail...
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-slate-50 text-slate-500 sticky top-0">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">Missed month</th>
            <th className="text-left px-3 py-2 font-semibold">Component</th>
            <th className="text-left px-3 py-2 font-semibold">Debit account</th>
            <th className="text-left px-3 py-2 font-semibold">Credit account</th>
            <th className="text-right px-4 py-2 font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id} className="hover:bg-amber-50/40 transition-colors">
              <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatPeriodDisplay(l.missed_period)}</td>
              <td className="px-3 py-2 text-slate-600">{COMPONENT_LABEL[l.component] ?? l.component}</td>
              <td className="px-3 py-2 text-slate-700">{l.account_debited}</td>
              <td className="px-3 py-2 text-slate-700">{l.account_credited}</td>
              <td className="px-4 py-2 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(Number(l.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CatchUpCorrections({ period, compact = false }: { period: string; compact?: boolean }) {
  const { batches, loading, error, retry } = useCatchUpBatches(period);
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-500">
        <Loader className="w-4 h-4 animate-spin" /> Loading catch-up corrections...
      </div>
    );
  }
  if (error) return <LoadError message={error} onRetry={retry} className="m-4" />;
  if (batches.length === 0) return null;

  const months = batches.reduce((s, b) => s + b.missed_months, 0);
  const debits = batches.reduce((s, b) => s + Number(b.total_debits), 0);
  const credits = batches.reduce((s, b) => s + Number(b.total_credits), 0);
  const posted = batches.every((b) => b.status === 'posted');

  return (
    <section className={`border border-amber-200 bg-amber-50/40 rounded-xl overflow-hidden ${compact ? '' : 'm-4'}`}>
      <header className="px-4 py-3 border-b border-amber-200 bg-amber-50 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500 text-white"><History className="w-4 h-4" /></div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">Catch-up corrections</h4>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed max-w-xl">
              {batches.length} lease{batches.length === 1 ? '' : 's'} · {months} missed month{months === 1 ? '' : 's'} · booked in {formatPeriodDisplay(period)}.{' '}
              {posted
                ? 'Posted with this month-end.'
                : `Prepared, not posted yet. They post automatically when ${formatPeriodDisplay(period)} month-end is processed.`}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-600">
          <div>Debits <span className="font-bold text-slate-900 tabular-nums">{formatCurrency(debits)}</span></div>
          <div>Credits <span className="font-bold text-slate-900 tabular-nums">{formatCurrency(credits)}</span></div>
        </div>
      </header>

      <ul className="divide-y divide-amber-100 bg-white">
        {batches.map((b) => {
          const open = openId === b.id;
          return (
            <li key={b.id}>
              <button
                onClick={() => setOpenId(open ? null : b.id)}
                aria-expanded={open}
                className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-amber-50/60 transition-colors"
              >
                <span className="mt-0.5 text-slate-500">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900">{b.lease_name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${b.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                      {b.status === 'posted' ? 'Posted' : 'Prepared'}
                    </span>
                    <span className="text-xs text-slate-500">{b.missed_months} month{b.missed_months === 1 ? '' : 's'}</span>
                  </span>
                  <span className="block text-xs text-slate-600 mt-0.5">{b.description}</span>
                </span>
                <span className="hidden sm:grid grid-cols-4 gap-4 text-right text-xs shrink-0">
                  <span><span className="block text-slate-500">Interest</span><span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(Number(b.total_interest))}</span></span>
                  <span><span className="block text-slate-500">ROU amort.</span><span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(Number(b.total_amortization))}</span></span>
                  <span><span className="block text-slate-500">Payments</span><span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(Number(b.total_payment))}</span></span>
                  <span><span className="block text-slate-500">Debits = Credits</span><span className="font-bold text-slate-900 tabular-nums">{formatCurrency(Number(b.total_debits))}</span></span>
                </span>
              </button>
              {open && <div className="border-t border-amber-100"><BatchLines batchId={b.id} /></div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
