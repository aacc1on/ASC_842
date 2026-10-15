import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useShortTermConflictData } from '../hooks/useCompanyPolicyData';
import { LoadError } from './LoadError';
import { getApplicablePolicy } from '../utils/policyElections';

interface ShortTermLeaseConflictCheckProps {
  companyId: string | null;
  asOfDate: string;
}

interface ConflictEntry {
  leaseName: string;
  assetClassName: string;
  policy: string;
  treatment: string;
  issue: string;
}

/**
 * Checks for conflicts between a lease's accounting treatment and the approved
 * accounting policy election effective at its commencement date.
 *
 * Short-term conflicts:
 * 1. Lease has exemption applied but the election at commencement was not approved/elected.
 * 2. Lease qualifies (term ≤ 12, no purchase option) and election was approved+elected,
 *    but the lease is recognized.
 *
 * Component conflicts:
 * 3. Lease is 'combined' but the election at commencement was not approved or not elected.
 * 4. Lease is 'separate' with nonlease > 0 but the election says combine.
 */
export function ShortTermLeaseConflictCheck({ companyId }: ShortTermLeaseConflictCheckProps) {
  const { data: { leases, elections, assetTypes }, loading, error, retry } = useShortTermConflictData(companyId);

  const conflicts = useMemo(() => {
    if (!companyId) return [];
    const assetMap = new Map(assetTypes.map((a) => [a.id, a.type_name]));

    const found: ConflictEntry[] = [];

    for (const lease of leases) {
      if (!lease.fixed_asset_type_id) continue;
      const assetClassName = assetMap.get(lease.fixed_asset_type_id) ?? 'Unknown';
      const commencementDate = lease.lease_start_date.split('T')[0];

      // Short-term conflict checks
      const stlPolicy = getApplicablePolicy(
        elections,
        companyId!,
        lease.fixed_asset_type_id,
        'SHORT_TERM_LEASE',
        commencementDate,
      );
      const electionApprovedAndElected = stlPolicy != null && stlPolicy.election_value === true;
      const isExempt = lease.accounting_treatment === 'short_term_exemption';
      const qualifies = (lease.lease_term_months <= 12) && !lease.purchase_option;

      if (isExempt && !electionApprovedAndElected) {
        found.push({
          leaseName: lease.lease_name,
          assetClassName,
          policy: 'SHORT_TERM_LEASE',
          treatment: 'short_term_exemption',
          issue: 'Lease has exemption applied but the election effective at commencement was not approved or not elected. Review and convert to recognized lease or approve the election.',
        });
      }

      if (!isExempt && qualifies && electionApprovedAndElected) {
        found.push({
          leaseName: lease.lease_name,
          assetClassName,
          policy: 'SHORT_TERM_LEASE',
          treatment: 'recognized',
          issue: 'Lease qualifies for short-term exemption and the election is approved+elected, but the lease is recognized. Review and apply the exemption or update the election.',
        });
      }

      // Component policy conflict checks (only for leases with nonlease > 0)
      const hasNonlease = (lease.nonlease_component_amount ?? 0) > 0;
      if (hasNonlease) {
        const combinePolicy = getApplicablePolicy(
          elections,
          companyId!,
          lease.fixed_asset_type_id,
          'COMBINE_LEASE_NONLEASE',
          commencementDate,
        );
        const combineElected = combinePolicy != null && combinePolicy.election_value === true;

        if (lease.component_policy === 'combined' && !combineElected) {
          found.push({
            leaseName: lease.lease_name,
            assetClassName,
            policy: 'COMBINE_LEASE_NONLEASE',
            treatment: 'combined',
            issue: 'Lease components are combined but the election effective at commencement was not approved or not elected. Review and separate the components or approve the election.',
          });
        }

        if (lease.component_policy === 'separate' && combineElected) {
          found.push({
            leaseName: lease.lease_name,
            assetClassName,
            policy: 'COMBINE_LEASE_NONLEASE',
            treatment: 'separate',
            issue: 'Lease components are separated but the approved election says combine. Review and combine the components or update the election.',
          });
        }
      }
    }

    return found;
  }, [companyId, leases, elections, assetTypes]);

  if (error) return <LoadError message={error} onRetry={retry} className="mt-3" />;
  if (loading || conflicts.length === 0) return null;

  return (
    <div className="mt-3 border border-red-300 bg-red-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <span className="text-sm font-bold text-red-700">
          Accounting treatment conflicts with approved accounting policy.
        </span>
      </div>
      <div className="space-y-2">
        {conflicts.map((c, i) => (
          <div key={i} className="text-xs text-red-700 bg-white/60 rounded px-2.5 py-2">
            <div className="font-semibold">{c.leaseName} — {c.assetClassName}</div>
            <div className="text-red-600 mt-0.5">Policy: {c.policy} · Treatment: {c.treatment}</div>
            <div className="mt-0.5">{c.issue}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
