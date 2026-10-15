import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Copy, FileText, ChevronDown, ChevronUp, UserCheck } from 'lucide-react';
import { usePolicyChecklistData } from '../hooks/useCompanyPolicyData';
import { LoadError } from './LoadError';
import { ShortTermLeaseConflictCheck } from './ShortTermLeaseConflictCheck';
import {
  ASC_POLICY_REFERENCES, POLICY_TYPES, getPolicyCoverage, generateDisclosureNarrative,
  isFullyConfigured,
  type PolicyType,
} from '../utils/policyElections';

interface PolicyElectionChecklistProps {
  companyId: string | null;
  asOfDate: string;
}

const POLICY_LABELS: Record<PolicyType, string> = {
  SHORT_TERM_LEASE: 'Short-Term Lease Election',
  COMBINE_LEASE_NONLEASE: 'Lease and Nonlease Components',
  RISK_FREE_RATE: 'Risk-Free Rate Election',
};

export function PolicyElectionChecklist({ companyId, asOfDate }: PolicyElectionChecklistProps) {
  const { data: { elections, assetTypes, entityType }, loading, error, retry } = usePolicyChecklistData(companyId);
  const [narrativeExpanded, setNarrativeExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const coverage = useMemo(() => {
    if (assetTypes.length === 0) return [];
    return getPolicyCoverage(assetTypes, elections, asOfDate, companyId ?? '', entityType);
  }, [assetTypes, elections, asOfDate, companyId, entityType]);

  const fullyConfigured = isFullyConfigured(coverage);
  const narrative = useMemo(() => generateDisclosureNarrative(coverage, entityType), [coverage, entityType]);

  const handleCopy = () => {
    const text = narrative.map((p, i) => `${i + 1}. ${p}`).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(false);
    });
  };

  if (error) {
    return (
      <li className="px-5 py-4">
        <LoadError message={error} onRetry={retry} />
      </li>
    );
  }

  if (loading) {
    return (
      <li className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-300" />
          <span className="text-sm text-slate-500">Loading policy elections...</span>
        </div>
      </li>
    );
  }

  return (
    <li className="px-5 py-4 hover:bg-slate-50/60">
      <div className="flex items-start gap-3">
        {fullyConfigured ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">Accounting Policy Elections</span>
            <span className="text-[11px] font-mono text-slate-500">ASC 842-20-50-5</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Disclose practical expedients and accounting policy elections (short-term lease exemption, non-separation of lease/non-lease components, risk-free rate election).
          </div>

          {/* Three sub-sections */}
          <div className="mt-3 space-y-3">
            {POLICY_TYPES.map((pt) => {
              const entries = coverage.filter((c) => c.policyType === pt);
              const hasMissing = entries.some((c) => c.result === 'not_configured' || c.result === 'pending');
              const ref = ASC_POLICY_REFERENCES[pt];
              return (
                <div key={pt} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-sm font-semibold text-slate-700">{POLICY_LABELS[pt]}</span>
                      <span className="text-[10px] font-mono text-slate-500">ASC {ref}</span>
                    </div>
                    {hasMissing ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {entries.length === 0 ? (
                      <span className="text-xs text-slate-500">No active asset classes configured.</span>
                    ) : (
                      entries.map((e) => (
                        <div key={`${e.assetTypeId}-${e.policyType}`} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">{e.assetTypeName}</span>
                          <span className={`font-semibold ${
                            e.result === 'elected' ? 'text-emerald-600' :
                            e.result === 'not_eligible' ? 'text-slate-500' :
                            e.result === 'pending' ? 'text-orange-600' :
                            'text-slate-500'
                          }`}>
                            {e.result === 'elected' ? (e.electionValue ? 'Elected' : 'Not Elected') :
                             e.result === 'not_eligible' ? 'N/A' :
                             e.result === 'pending' ? 'Pending approval' :
                             'Not Configured'}
                          </span>
                          {elections.find(el => el.fixed_asset_type_id === e.assetTypeId && el.policy_type === e.policyType && el.status === 'approved' && el.self_approved) && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold" title="Approved by the preparer">
                              <UserCheck className="w-3 h-3" />
                              Auto
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Warning or success */}
          {fullyConfigured ? (
            <div className="mt-2 text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              All active asset classes have approved policy elections.
            </div>
          ) : (
            <div className="mt-2 text-xs text-amber-600 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Accounting policy election has not been configured for one or more asset classes.
            </div>
          )}

          {/* Configure button */}
          <div className="mt-3 flex items-center gap-2">
            <Link
              to="/settings/accounting-policies"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition"
            >
              Configure Accounting Policies
            </Link>
            <button
              onClick={() => setNarrativeExpanded(!narrativeExpanded)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition"
            >
              {narrativeExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Disclosure Narrative
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy Disclosure'}
            </button>
          </div>

          {/* Conflict check */}
          <ShortTermLeaseConflictCheck companyId={companyId} asOfDate={asOfDate} />

          {/* Narrative */}
          {narrativeExpanded && (
            <div className="mt-3 space-y-2 bg-white border border-slate-200 rounded-lg p-3">
              {narrative.map((para, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed">{para}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
