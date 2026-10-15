import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale, Stethoscope } from 'lucide-react';
import {
  DATA_HEALTH_LABELS,
  DataHealthIssue,
  RECONCILIATION_LABELS,
  ReconciliationDifference,
  fetchDataHealth,
  fetchLedgerReconciliation,
} from '../utils/ledgerHealth';
import { toYMD } from '../utils/formatting';
import { toUserMessage } from '../utils/errors';

function useAsync<T>(load: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await load());
    } catch (err) {
      setRows([]);
      setError(toUserMessage(err, 'The health check could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => { run(); }, [run]);
  return { rows, loading, error, run };
}

function PanelShell({ icon: Icon, title, subtitle, loading, onRefresh, children }: {
  icon: typeof Scale;
  title: string;
  subtitle: string;
  loading: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white"><Icon className="w-5 h-5" /></div>
          <div>
            <h4 className="font-bold text-slate-900">{title}</h4>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">{subtitle}</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-xs font-semibold text-slate-700 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Re-run
        </button>
      </div>
      {children}
    </div>
  );
}

function StatusBody({ loading, error, count, okText, children }: {
  loading: boolean;
  error: string;
  count: number;
  okText: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return <div className="px-5 py-10 flex justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" /></div>;
  }
  if (error) {
    return (
      <div className="m-5 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>The check could not be run. {error}</span>
      </div>
    );
  }
  if (count === 0) {
    return (
      <div className="m-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
        <span className="font-semibold">{okText}</span>
      </div>
    );
  }
  return (
    <>
      <div className="mx-5 mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="font-semibold">{count} item{count === 1 ? '' : 's'} need review</span>
      </div>
      <div className="overflow-x-auto p-5">{children}</div>
    </>
  );
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500';
const td = 'px-3 py-2 text-sm text-slate-700';

export function LedgerReconciliationPanel() {
  const [includeCatchUp, setIncludeCatchUp] = useState(false);
  const load = useCallback(
    () => fetchLedgerReconciliation('2000-01-01', toYMD(new Date()), includeCatchUp),
    [includeCatchUp],
  );
  const { rows, loading, error, run } = useAsync<ReconciliationDifference>(load);

  return (
    <PanelShell
      icon={Scale}
      title="Ledger reconciliation"
      subtitle="Read-only check of locked months: posted month-end entries (plus catch-up corrections) are compared with the amortization schedule for every lease, month and account, every lease-month inside its term must have a posting, and every posted entry is checked for equal debits and credits. Nothing is changed."
      loading={loading}
      onRefresh={run}
    >
      <label className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 text-xs font-semibold text-slate-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeCatchUp}
          onChange={(e) => setIncludeCatchUp(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        Treat prepared catch-up corrections as posted
      </label>
      <StatusBody loading={loading} error={error} count={rows.length} okText="No differences. Posted entries match the amortization schedule, projected journal and lease events for all locked months.">
        <table className="min-w-full divide-y divide-slate-100">
          <thead><tr>
            <th className={th}>Check</th><th className={th}>Lease</th><th className={th}>Period</th><th className={th}>Account</th>
            <th className={`${th} text-right`}>Posted</th><th className={`${th} text-right`}>Expected</th><th className={`${th} text-right`}>Difference</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className={td}>{RECONCILIATION_LABELS[r.checkType] ?? r.checkType}</td>
                <td className={`${td} font-semibold text-slate-900`}>{r.leaseName ?? '\u2014'}</td>
                <td className={td}>{r.period ?? '\u2014'}</td>
                <td className={td}>{r.account ?? '\u2014'}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.posted)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.expected)}</td>
                <td className={`${td} text-right tabular-nums font-semibold text-amber-700`}>{fmt(r.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StatusBody>
    </PanelShell>
  );
}

export function DataHealthPanel({ scope }: { scope: 'organization' | 'platform' }) {
  const load = useCallback(() => fetchDataHealth(scope), [scope]);
  const { rows, loading, error, run } = useAsync<DataHealthIssue>(load);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.checkKey, (m.get(r.checkKey) ?? 0) + 1));
    return [...m.entries()];
  }, [rows]);

  return (
    <PanelShell
      icon={Stethoscope}
      title={scope === 'platform' ? 'Data health (all organizations)' : 'Data health'}
      subtitle="Read-only scan for leases without schedules, schedules that do not run off to zero, rows linked to the wrong organization, unbalanced journal entries, finance leases missing inputs, initial recognition mismatches and organizations or subscriptions without an owner."
      loading={loading}
      onRefresh={run}
    >
      <StatusBody loading={loading} error={error} count={rows.length} okText="No issues found.">
        <div className="flex flex-wrap gap-2 mb-4">
          {counts.map(([key, n]) => (
            <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
              {DATA_HEALTH_LABELS[key] ?? key}<span className="px-1.5 rounded-full bg-white text-slate-900">{n}</span>
            </span>
          ))}
        </div>
        <table className="min-w-full divide-y divide-slate-100">
          <thead><tr>
            {scope === 'platform' && <th className={th}>Organization</th>}
            <th className={th}>Issue</th><th className={th}>Lease</th><th className={th}>Detail</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60 align-top">
                {scope === 'platform' && <td className={`${td} font-semibold text-slate-900`}>{r.organizationName ?? r.organizationId ?? '\u2014'}</td>}
                <td className={td}>{DATA_HEALTH_LABELS[r.checkKey] ?? r.checkKey}</td>
                <td className={td}>{r.leaseName ?? '\u2014'}</td>
                <td className={`${td} text-slate-600`}>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StatusBody>
    </PanelShell>
  );
}
