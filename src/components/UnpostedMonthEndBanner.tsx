import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Lease } from '../types/lease';
import { findFirstUnpostedMonth } from '../utils/financialReports';

interface Props {
  leases: Lease[];
  asOf: string;
}

export function UnpostedMonthEndBanner({ leases, asOf }: Props) {
  const [firstUnposted, setFirstUnposted] = useState<string | null>(null);

  const earliestStart = useMemo(
    () => leases.map((l) => l.lease_start_date).filter(Boolean).sort()[0] ?? '',
    [leases]
  );

  useEffect(() => {
    let cancelled = false;
    if (!earliestStart) {
      setFirstUnposted(null);
      return;
    }
    findFirstUnpostedMonth(earliestStart, asOf)
      .then((m) => { if (!cancelled) setFirstUnposted(m); })
      .catch(() => { if (!cancelled) setFirstUnposted(null); });
    return () => { cancelled = true; };
  }, [earliestStart, asOf]);

  if (!firstUnposted) return null;
  const label = new Date(`${asOf}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const since = new Date(`${firstUnposted}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600" />
      <div>
        <p className="font-semibold">Month-end not posted through {label} — figures are calculated from lease schedules</p>
        <p className="mt-0.5 text-orange-800">The first month not yet posted is {since}.</p>
      </div>
    </div>
  );
}
