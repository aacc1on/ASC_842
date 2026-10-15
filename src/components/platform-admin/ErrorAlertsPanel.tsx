import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import {
  DELIVERY_LABELS,
  SOURCE_LABELS,
  fetchErrorAlertSettings,
  fetchErrorAlerts,
  saveErrorAlertThreshold,
  sendTestAlert,
  validateThreshold,
  type ErrorAlert,
  type ErrorAlertSettings,
} from '../../utils/errorAlerts';
import { toUserMessage } from '../../utils/errors';

const th = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500';
const td = 'px-3 py-2 text-sm text-slate-700';

const statusTone: Record<string, string> = {
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  not_configured: 'bg-amber-50 text-amber-800 border-amber-200',
  throttled: 'bg-slate-100 text-slate-700 border-slate-300',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ErrorAlertsPanel() {
  const [alerts, setAlerts] = useState<ErrorAlert[]>([]);
  const [settings, setSettings] = useState<ErrorAlertSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [thresholdInput, setThresholdInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, s] = await Promise.all([fetchErrorAlerts(), fetchErrorAlertSettings()]);
      setAlerts(list);
      setSettings(s);
      if (s) setThresholdInput(String(s.threshold));
    } catch (err) {
      setError(toUserMessage(err, 'Could not load error alerts.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const value = validateThreshold(thresholdInput);
    if (value === null) {
      setSaveMsg('Enter a whole number between 1 and 10000.');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      await saveErrorAlertThreshold(value);
      setSettings((prev) => (prev ? { ...prev, threshold: value } : prev));
      setSaveMsg('Saved.');
    } catch (err) {
      setSaveMsg(toUserMessage(err, 'Could not save the alert threshold.'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      setTestMsg({ ok: true, text: await sendTestAlert() });
    } catch (err) {
      setTestMsg({ ok: false, text: toUserMessage(err, 'Could not send the test alert.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div id="error-alerts" className="bg-white border border-slate-200 rounded-2xl overflow-hidden scroll-mt-6">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white"><BellRing className="w-5 h-5" /></div>
          <div>
            <h4 className="font-bold text-slate-900">Error alerts</h4>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
              Raised when more than {settings?.threshold ?? 10} errors are logged within {settings?.windowMinutes ?? 15} minutes,
              or when saving a lease, month-end or Stripe payments fail. At most one alert is sent every {settings?.debounceMinutes ?? 30} minutes,
              and at most one email per error type every 15 minutes.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition disabled:opacity-50"
          >
            <Send className={`w-3.5 h-3.5 ${testing ? 'animate-pulse' : ''}`} />
            {testing ? 'Sending...' : 'Send test alert'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-xs font-semibold text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {testMsg && (
        <div
          role="status"
          className={`mx-5 mt-5 p-3 rounded-xl border text-sm flex items-start gap-2 ${testMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}
        >
          {testMsg.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{testMsg.text}</span>
        </div>
      )}

      {settings && (
        <div className="px-5 pt-5 flex items-end gap-3 flex-wrap">
          <label className="text-xs font-semibold text-slate-600">
            Alert when errors in {settings.windowMinutes} minutes exceed
            <input
              type="number"
              min={1}
              max={10000}
              value={thresholdInput}
              onChange={(e) => { setThresholdInput(e.target.value); setSaveMsg(''); }}
              className="mt-1 block w-28 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saveMsg && <span className="text-xs text-slate-600" role="status">{saveMsg}</span>}
        </div>
      )}

      {loading ? (
        <div className="px-5 py-10 flex justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" /></div>
      ) : error ? (
        <div className="m-5 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : alerts.length === 0 ? (
        <div className="m-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">No alerts have been raised.</span>
        </div>
      ) : (
        <div className="overflow-x-auto p-5">
          <table className="min-w-full divide-y divide-slate-100">
            <thead><tr>
              <th className={th}>When</th><th className={th}>Type</th><th className={th}>Where</th>
              <th className={th}>Errors</th><th className={th}>Message</th><th className={th}>Delivery</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60 align-top">
                  <td className={`${td} whitespace-nowrap`}>{formatWhen(a.createdAt)}</td>
                  <td className={td}>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${a.reason === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                      {a.reason === 'critical' ? 'Critical' : 'Error spike'}
                    </span>
                  </td>
                  <td className={td}>{(a.source && SOURCE_LABELS[a.source]) ?? a.route ?? '\u2014'}</td>
                  <td className={td}>
                    {a.errorCount}
                    {a.suppressedCount > 0 && <span className="block text-xs text-slate-500">+{a.suppressedCount} while paused</span>}
                  </td>
                  <td className={`${td} text-slate-600 max-w-md break-words`}>{a.message ?? '\u2014'}</td>
                  <td className={td}>
                    <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${statusTone[a.deliveryStatus] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                      {DELIVERY_LABELS[a.deliveryStatus] ?? a.deliveryStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
