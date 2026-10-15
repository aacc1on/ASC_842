import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import { currentOrgId } from '../utils/currentOrg';
import { fetchAll } from '../utils/fetchAll';
import type { AssetTypeInfo, EntityType, PolicyElection } from '../utils/policyElections';
import { useAsyncData } from './useAsyncData';

export interface CompanyPolicyData {
  elections: PolicyElection[];
  assetTypes: AssetTypeInfo[];
  entityType: EntityType | null;
}

export interface ShortTermConflictData {
  leases: Lease[];
  elections: PolicyElection[];
  assetTypes: AssetTypeInfo[];
}

const EMPTY_POLICY_DATA: CompanyPolicyData = { elections: [], assetTypes: [], entityType: null };
const EMPTY_CONFLICT_DATA: ShortTermConflictData = { leases: [], elections: [], assetTypes: [] };
const NO_ELECTIONS: PolicyElection[] = [];

async function fetchCompanyElections(orgId: string, companyId: string): Promise<PolicyElection[]> {
  return fetchAll<PolicyElection>('policy elections', (from, to) => supabase
    .from('accounting_policy_elections')
    .select('*')
    .eq('organization_id', orgId)
    .eq('company_id', companyId)
    .order('id')
    .range(from, to));
}

async function fetchAssetClasses(orgId: string, activeOnly: boolean): Promise<AssetTypeInfo[]> {
  let query = supabase
    .from('fixed_asset_types')
    .select('id, type_name, is_active')
    .eq('organization_id', orgId);
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query.order('type_name');
  if (error) throw error;
  return (data ?? []) as AssetTypeInfo[];
}

/** Elections, active asset classes and entity type for one company (policy checklist). */
export function usePolicyChecklistData(companyId: string | null | undefined) {
  return useAsyncData<CompanyPolicyData>(companyId ? async () => {
    const orgId = await currentOrgId();
    const [elections, assetTypes, company] = await Promise.all([
      fetchCompanyElections(orgId, companyId),
      fetchAssetClasses(orgId, true),
      supabase
        .from('companies')
        .select('id, entity_type')
        .eq('organization_id', orgId)
        .eq('id', companyId)
        .maybeSingle(),
    ]);
    if (company.error) throw company.error;
    const entityType = (company.data as { entity_type?: EntityType | null } | null)?.entity_type ?? null;
    return { elections, assetTypes, entityType };
  } : null, [companyId], EMPTY_POLICY_DATA, 'Failed to load the policy checklist.');
}

/** The company's open leases, elections and all asset classes (short-term / component conflict check). */
export function useShortTermConflictData(companyId: string | null | undefined) {
  return useAsyncData<ShortTermConflictData>(companyId ? async () => {
    const orgId = await currentOrgId();
    const [leases, elections, assetTypes] = await Promise.all([
      fetchAll<Lease>('leases', (from, to) => supabase
        .from('leases')
        .select('*')
        .eq('organization_id', orgId)
        .eq('company_id', companyId)
        .neq('status', 'cancelled')
        .order('id')
        .range(from, to)),
      fetchCompanyElections(orgId, companyId),
      fetchAssetClasses(orgId, false),
    ]);
    return { leases, elections, assetTypes };
  } : null, [companyId], EMPTY_CONFLICT_DATA, 'Failed to check leases against the accounting policies.');
}

/** Every policy election for one company (lease form discount-rate section). */
export function useCompanyElections(companyId: string | null | undefined) {
  return useAsyncData<PolicyElection[]>(companyId ? async () => {
    const orgId = await currentOrgId();
    return fetchCompanyElections(orgId, companyId);
  } : null, [companyId], NO_ELECTIONS, 'Failed to load the accounting policy elections.');
}
