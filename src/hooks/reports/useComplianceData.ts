import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { currentOrgId } from '../../utils/currentOrg';
import { toUserMessage } from '../../utils/errors';
import { fetchAllIn } from '../../utils/fetchAll';
import { type Lease } from '../../types/lease';
import {
  computeLeaseCostDisclosure,
  computeLeaseBalancesByType,
  fetchRemainingLiabilityFromSchedule,
  computeMaturityAnalysis,
  type MaturityAnalysis,
  type LeaseCostDisclosure,
  type LeaseBalancesByType,
} from '../../utils/financialReports';
import { eligibleLeases, filterActiveLeases, type Reassessment } from '../../utils/reports/complianceCalculations';

export interface ComplianceData {
  /** Active leases overlapping the period. Memoised: a new array every render would refetch forever. */
  activeLeases: Lease[];
  reassessments: Map<string, Reassessment>;
  leaseCostDisclosure: LeaseCostDisclosure | null;
  leaseBalancesByType: LeaseBalancesByType | null;
  remainingLiabilityMap: Map<string, number>;
  maturity: MaturityAnalysis | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

interface ReassessmentRow extends Reassessment {
  created_at: string;
}

const byModificationOrder = (a: ReassessmentRow, b: ReassessmentRow) =>
  a.modification_date.localeCompare(b.modification_date) || a.created_at.localeCompare(b.created_at);

async function fetchReassessments(leaseIds: string[]): Promise<Map<string, Reassessment>> {
  const orgId = await currentOrgId();
  const rows = await fetchAllIn<ReassessmentRow>('contract modifications', leaseIds, (batch, from, to) =>
    supabase
      .from('contract_modifications')
      .select('id, lease_id, modification_date, created_at, reassessed_classification, new_lease_liability, new_lease_term, fair_value_at_modification')
      .eq('organization_id', orgId)
      .in('lease_id', batch)
      .eq('status', 'approved')
      .eq('accounting_posted', true)
      .not('reassessed_classification', 'is', null)
      .order('modification_date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));
  // Later rows overwrite earlier ones, so the map holds the latest reassessment per lease.
  const map = new Map<string, Reassessment>();
  [...rows].sort(byModificationOrder).forEach((m) => map.set(m.lease_id, m));
  return map;
}

export function useComplianceData(leases: Lease[], periodStart: string, periodEnd: string): ComplianceData {
  const [leaseCostDisclosure, setLeaseCostDisclosure] = useState<LeaseCostDisclosure | null>(null);
  const [leaseBalancesByType, setLeaseBalancesByType] = useState<LeaseBalancesByType | null>(null);
  const [remainingLiabilityMap, setRemainingLiabilityMap] = useState<Map<string, number>>(new Map());
  const [maturity, setMaturity] = useState<MaturityAnalysis | null>(null);
  const [reassessments, setReassessments] = useState<Map<string, Reassessment>>(new Map());
  const [reassessLoading, setReassessLoading] = useState(false);
  const [disclosureLoading, setDisclosureLoading] = useState(false);
  const [reassessError, setReassessError] = useState<string | null>(null);
  const [disclosureError, setDisclosureError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let ignore = false;
    const ids = leases.map((l) => l.id);
    setReassessError(null);
    if (ids.length === 0) { setReassessments(new Map()); setReassessLoading(false); return; }
    setReassessLoading(true);
    fetchReassessments(ids)
      .then((map) => { if (!ignore) setReassessments(map); })
      .catch((err) => {
        if (ignore) return;
        setReassessments(new Map());
        setReassessError(toUserMessage(err, 'Failed to load lease reassessments.'));
      })
      .finally(() => { if (!ignore) setReassessLoading(false); });
    return () => { ignore = true; };
  }, [leases, attempt]);

  const activeLeases = useMemo(
    () => filterActiveLeases(leases, periodStart, periodEnd),
    [leases, periodStart, periodEnd],
  );

  useEffect(() => {
    let ignore = false;
    setDisclosureError(null);
    if (activeLeases.length === 0) {
      setLeaseCostDisclosure(null);
      setLeaseBalancesByType(null);
      setRemainingLiabilityMap(new Map());
      setMaturity(null);
      setDisclosureLoading(false);
      return;
    }
    setDisclosureLoading(true);
    const pStart = new Date(periodStart + 'T00:00:00');
    const pEnd = new Date(periodEnd + 'T00:00:00');
    const eligible = eligibleLeases(activeLeases);
    Promise.all([
      computeLeaseCostDisclosure(activeLeases, pStart, pEnd),
      computeLeaseBalancesByType(activeLeases, pEnd),
      fetchRemainingLiabilityFromSchedule(eligible, pEnd),
      computeMaturityAnalysis(eligible, pEnd),
    ]).then(([cost, balances, liabMap, mat]) => {
      if (ignore) return;
      setLeaseCostDisclosure(cost);
      setLeaseBalancesByType(balances);
      setRemainingLiabilityMap(liabMap);
      setMaturity(mat);
    }).catch((err) => {
      if (ignore) return;
      setLeaseCostDisclosure(null);
      setLeaseBalancesByType(null);
      setRemainingLiabilityMap(new Map());
      setMaturity(null);
      setDisclosureError(toUserMessage(err, 'Failed to load compliance disclosures.'));
    }).finally(() => { if (!ignore) setDisclosureLoading(false); });
    return () => { ignore = true; };
  }, [activeLeases, periodStart, periodEnd, attempt]);

  return {
    activeLeases, reassessments, leaseCostDisclosure, leaseBalancesByType, remainingLiabilityMap, maturity,
    loading: reassessLoading || disclosureLoading,
    error: reassessError ?? disclosureError,
    retry,
  };
}
