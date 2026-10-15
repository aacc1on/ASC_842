import { CheckCircle2, Clock, XCircle } from 'lucide-react';

export function CoverageBadge({ result, value }: { result: string; value: boolean | null }) {
  if (result === 'not_eligible') {
    return <span className="text-xs font-semibold text-slate-500">N/A</span>;
  }
  if (result === 'elected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">
        <CheckCircle2 className="w-3 h-3" />
        {value ? 'Elected' : 'Not Elected'}
      </span>
    );
  }
  if (result === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">
        <Clock className="w-3 h-3" />
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold">
      <XCircle className="w-3 h-3" />
      Not Configured
    </span>
  );
}
