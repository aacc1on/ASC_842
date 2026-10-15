import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Company, FixedAssetType } from '../types/lease';
import { currentOrgId } from '../utils/currentOrg';
import { toUserMessage } from '../utils/errors';
import { useAsyncData } from './useAsyncData';
import type { Lessor } from './useLessors';

interface BranchOption {
  id: string;
  branch_name: string;
  branch_code: string | null;
}

export interface UseLeaseFormDataResult {
  branches: BranchOption[];
  fixedAssetTypes: FixedAssetType[];
  companies: Company[];
  lessors: Lessor[];
  setBranches: React.Dispatch<React.SetStateAction<BranchOption[]>>;
  setFixedAssetTypes: React.Dispatch<React.SetStateAction<FixedAssetType[]>>;
  error: string | null;
  retry: () => void;
}

/**
 * Loads the reference data shared across the lease form: companies (for the
 * company selector), lessors and, scoped to the selected company, branches and fixed
 * asset types. Branches/asset types are returned with setters so the form can
 * optimistically append newly-created rows without a full reload.
 */
export function useLeaseFormData(formCompanyId: string): UseLeaseFormDataResult {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [fixedAssetTypes, setFixedAssetTypes] = useState<FixedAssetType[]>([]);
  const [scopedError, setScopedError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const companiesLoad = useAsyncData<Company[]>(async () => {
    const orgId = await currentOrgId();
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('company_name');
    if (error) throw error;
    return (data ?? []) as Company[];
  }, [], [], 'Failed to load companies.');

  const lessorsLoad = useAsyncData<Lessor[]>(async () => {
    const orgId = await currentOrgId();
    const { data, error } = await supabase
      .from('lessors')
      .select('*')
      .eq('organization_id', orgId)
      .order('lessor_name');
    if (error) throw error;
    return (data ?? []) as Lessor[];
  }, [], [], 'Failed to load lessors.');

  // Branches and asset types are organization-scoped (no company_id column), so the full active set is
  // loaded; the company only gates whether the selectors are populated.
  useEffect(() => {
    let stale = false;
    setScopedError(null);
    if (!formCompanyId) {
      setBranches([]);
      setFixedAssetTypes([]);
      return;
    }
    (async () => {
      try {
        const orgId = await currentOrgId();
        const [branchesRes, assetTypesRes] = await Promise.all([
          supabase
            .from('branches')
            .select('id, branch_name, branch_code')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('branch_name'),
          supabase
            .from('fixed_asset_types')
            .select('*')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('type_name'),
        ]);
        if (branchesRes.error) throw branchesRes.error;
        if (assetTypesRes.error) throw assetTypesRes.error;
        if (stale) return;
        setBranches((branchesRes.data ?? []) as BranchOption[]);
        setFixedAssetTypes((assetTypesRes.data ?? []) as FixedAssetType[]);
      } catch (err) {
        if (!stale) setScopedError(toUserMessage(err, 'Failed to load branches and asset types.'));
      }
    })();
    return () => { stale = true; };
  }, [formCompanyId, attempt]);

  const { retry: retryCompanies } = companiesLoad;
  const { retry: retryLessors } = lessorsLoad;
  const retry = useCallback(() => {
    retryCompanies();
    retryLessors();
    setAttempt((n) => n + 1);
  }, [retryCompanies, retryLessors]);

  return {
    branches,
    fixedAssetTypes,
    companies: companiesLoad.data,
    lessors: lessorsLoad.data,
    setBranches,
    setFixedAssetTypes,
    error: companiesLoad.error ?? lessorsLoad.error ?? scopedError,
    retry,
  };
}
