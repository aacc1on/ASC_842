import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { PolicyElectionChecklist } from '../../PolicyElectionChecklist';
import { checklistItems, type DisclosureItem } from '../../../utils/reports/complianceDisclosures';

interface DisclosureChecklistProps {
  disclosures: DisclosureItem[];
  selectedCompanyId?: string | null;
  periodEnd: string;
}

export function DisclosureChecklist({ disclosures, selectedCompanyId, periodEnd }: DisclosureChecklistProps) {
  const { visible, populated, narrative } = checklistItems(disclosures);
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h4 className="font-bold text-slate-900">Qualitative Disclosure Checklist (ASC 842-20-50)</h4>
            <p className="text-xs text-slate-500 mt-0.5">Disclosures generated from recorded lease data. Items marked &ldquo;Narrative required&rdquo; need management-supplied wording.</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {populated} populated
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              {narrative} narrative
            </span>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {visible.map((item) => (
            <li key={item.ref} className="px-5 py-4 hover:bg-slate-50/60">
              <div className="flex items-start gap-3">
                {item.available
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                  : <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{item.title}</span>
                    <span className="text-[11px] font-mono text-slate-500">ASC {item.ref}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.requirement}</div>
                  <ul className="mt-2 space-y-1.5">
                    {item.findings.map((f, i) => (
                      <li key={i} className="text-sm text-slate-700 leading-relaxed pl-3 border-l-2 border-slate-200">{f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
          <PolicyElectionChecklist companyId={selectedCompanyId ?? null} asOfDate={periodEnd} />
        </ul>
      </div>
    </div>
  );
}
