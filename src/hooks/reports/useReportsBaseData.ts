import { useCallback, useEffect, useRef, useState } from 'react';
import { type AssetTypeOption, type BranchOption } from '../../components/reports/types';
import { supabase } from '../../lib/supabase';
import { type Lease, type LeaseReport } from '../../types/lease';
import { batchCalculateCurrentBalances } from '../../utils/currentBalances';
import { fetchAll } from '../../utils/fetchAll';
import { summarizePortfolio } from '../../utils/portfolioOverview';
import { currentOrgId } from '../../utils/currentOrg';
import { toUserMessage } from '../../utils/errors';

export function useReportsBaseData(selectedCompanyId?: string | null) {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [report, setReport] = useState<LeaseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [assetTypeOptions, setAssetTypeOptions] = useState<AssetTypeOption[]>([]);
  const latestRequest = useRef(0);

  const loadData = useCallback(async () => {
    const request = ++latestRequest.current;
    const isStale = () => request !== latestRequest.current;
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (isStale()) return;
      if (!user) throw Object.assign(new Error('Your session has expired.'), { status: 401 });
      setUserId(user.id);
      const orgId = await currentOrgId();
      if (isStale()) return;

      const [leasesData, branchesRes, typesRes] = await Promise.all([
        fetchAll<Lease>('leases', (from, to) => {
          let query = supabase.from('leases').select('*').eq('organization_id', orgId);
          if (selectedCompanyId) query = query.eq('company_id', selectedCompanyId);
          return query
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to);
        }),
        supabase.from('branches').select('id, branch_name, branch_code').eq('organization_id', orgId).eq('is_active', true).order('branch_name'),
        supabase.from('fixed_asset_types').select('id, type_name, type_code').eq('organization_id', orgId).eq('is_active', true).order('type_name'),
      ]);
      if (isStale()) return;
      if (branchesRes.error) throw branchesRes.error;
      if (typesRes.error) throw typesRes.error;

      setBranchOptions((branchesRes.data ?? []) as BranchOption[]);
      setAssetTypeOptions((typesRes.data ?? []) as AssetTypeOption[]);

      let leasesWithBalances: Lease[] = [];
      if (leasesData.length > 0) {
        const balancesMap = await batchCalculateCurrentBalances(leasesData);
        if (isStale()) return;
        leasesWithBalances = leasesData.map((lease) => ({
          ...lease,
          currentBalances: balancesMap.get(lease.id),
        }));
      }
      setLeases(leasesWithBalances);
      setReport(summarizePortfolio(leasesWithBalances));
    } catch (err) {
      if (isStale()) return;
      setLeases([]);
      setReport(null);
      setError(toUserMessage(err, 'The report data could not be loaded.'));
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    const requests = latestRequest;
    loadData();
    return () => { requests.current++; };
  }, [loadData]);

  return { leases, report, loading, error, userId, branchOptions, assetTypeOptions, reload: loadData };
}
