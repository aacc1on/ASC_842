import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PolicyElection, PolicyType, EntityType } from '../utils/policyElections';
import type { AssetTypeInfo } from '../utils/policyElections';
import { toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';

interface CompanyInfo {
  id: string;
  company_name: string;
  entity_type: EntityType | null;
}

export interface UsePolicyElectionsResult {
  elections: PolicyElection[];
  assetTypes: AssetTypeInfo[];
  companies: CompanyInfo[];
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  selectedCompany: CompanyInfo | null;
  loading: boolean;
  error: string | null;
  saveElection: (params: {
    fixedAssetTypeId: string;
    policyType: PolicyType;
    electionValue: boolean;
    effectiveFrom: string;
    notes?: string;
    changeReason?: string;
    supportingDocumentId?: string | null;
  }) => Promise<{ success: boolean; id?: string; status?: string }>;
  submitForApproval: (id: string) => Promise<boolean>;
  setCompanyEntityType: (companyId: string, entityType: EntityType | null) => Promise<boolean>;
  createAssetClassWithPolicies: (params: NewAssetClassParams) => Promise<CreateAssetClassResult>;
  reload: () => void;
}

export interface NewAssetClassParams {
  typeName: string;
  typeCode: string;
  effectiveFrom: string;
  notes?: string;
  policies: { policyType: PolicyType; electionValue: boolean }[];
}

export type CreateAssetClassResult =
  | { ok: true; policiesSaved: boolean }
  | { ok: false; duplicate: boolean; message: string };

export function findDuplicateAssetClass(assetTypes: AssetTypeInfo[], name: string): AssetTypeInfo | undefined {
  const key = name.trim().toLowerCase();
  return assetTypes.find((a) => a.type_name.trim().toLowerCase() === key);
}

export function usePolicyElections(): UsePolicyElectionsResult {
  const [elections, setElections] = useState<PolicyElection[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetTypeInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadFlag, setReloadFlag] = useState(0);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const orgId = await currentOrgId();
        const [companiesRes, assetTypesRes] = await Promise.all([
          supabase.from('companies').select('id, company_name, entity_type').eq('organization_id', orgId).eq('is_active', true).order('company_name'),
          supabase.from('fixed_asset_types').select('id, type_name, is_active').eq('organization_id', orgId).order('type_name'),
        ]);
        if (companiesRes.error) throw companiesRes.error;
        if (assetTypesRes.error) throw assetTypesRes.error;
        if (cancelled) return;

        const comps = (companiesRes.data ?? []) as CompanyInfo[];
        setCompanies(comps);
        setAssetTypes((assetTypesRes.data ?? []) as AssetTypeInfo[]);

        if (comps.length > 0) {
          setSelectedCompanyId((current) => current || comps[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Failed to load data'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) {
      setElections([]);
      return;
    }
    let cancelled = false;
    async function loadElections() {
      try {
        const orgId = await currentOrgId();
        const elecRes = await supabase
          .from('accounting_policy_elections')
          .select('*')
          .eq('organization_id', orgId)
          .eq('company_id', selectedCompanyId)
          .order('created_at', { ascending: false });
        if (elecRes.error) throw elecRes.error;
        if (!cancelled) setElections((elecRes.data ?? []) as PolicyElection[]);
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Failed to load elections'));
      }
    }
    loadElections();
    return () => { cancelled = true; };
  }, [selectedCompanyId, reloadFlag]);

  const reload = useCallback(() => setReloadFlag((f) => f + 1), []);

  const saveElection = useCallback(async (params: {
    fixedAssetTypeId: string;
    policyType: PolicyType;
    electionValue: boolean;
    effectiveFrom: string;
    notes?: string;
    changeReason?: string;
    supportingDocumentId?: string | null;
  }) => {
    if (!selectedCompanyId) return { success: false };
    try {
      const { data, error: e } = await supabase.from('accounting_policy_elections').insert({
        company_id: selectedCompanyId,
        fixed_asset_type_id: params.fixedAssetTypeId,
        policy_type: params.policyType,
        election_value: params.electionValue,
        effective_from: params.effectiveFrom,
        status: 'pending_approval',
        policy_version: 0,
        notes: params.notes ?? null,
        change_reason: params.changeReason ?? null,
        supporting_document_id: params.supportingDocumentId ?? null,
      }).select('id, status').single();
      if (e) {
        setError(toUserMessage(e));
        return { success: false };
      }
      reload();
      const saved = data as { id: string; status: string };
      return { success: true, id: saved.id, status: saved.status };
    } catch (err) {
      setError(toUserMessage(err, 'Failed to save election'));
      return { success: false };
    }
  }, [selectedCompanyId, reload]);

  const submitForApproval = useCallback(async (id: string) => {
    try {
      const { error: e } = await supabase
        .from('accounting_policy_elections')
        .update({ status: 'pending_approval' })
        .eq('id', id);
      if (e) {
        setError(toUserMessage(e));
        return false;
      }
      reload();
      return true;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to submit'));
      return false;
    }
  }, [reload]);

  const setCompanyEntityType = useCallback(async (companyId: string, entityType: EntityType | null) => {
    try {
      const { error: e } = await supabase
        .from('companies')
        .update({ entity_type: entityType })
        .eq('id', companyId);
      if (e) {
        setError(toUserMessage(e));
        return false;
      }
      setCompanies((prev) => prev.map((c) => c.id === companyId ? { ...c, entity_type: entityType } : c));
      return true;
    } catch (err) {
      setError(toUserMessage(err, 'Failed to update entity type'));
      return false;
    }
  }, []);

  const createAssetClassWithPolicies = useCallback(async (params: NewAssetClassParams): Promise<CreateAssetClassResult> => {
    const name = params.typeName.trim();
    if (!selectedCompanyId) return { ok: false, duplicate: false, message: 'Select a company first.' };
    const existing = findDuplicateAssetClass(assetTypes, name);
    if (existing) {
      return { ok: false, duplicate: true, message: `Asset class "${existing.type_name}" already exists${existing.is_active ? '' : ' (inactive)'}.` };
    }
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return { ok: false, duplicate: false, message: 'Your session has expired. Please sign in again.' };

      const { data: created, error: insertError } = await supabase
        .from('fixed_asset_types')
        .insert({ user_id: userId, type_name: name, type_code: params.typeCode.trim(), is_active: true })
        .select('id, type_name, is_active')
        .single();
      if (insertError) {
        if (insertError.code === '23505') {
          return { ok: false, duplicate: true, message: `Asset class "${name}" already exists.` };
        }
        return { ok: false, duplicate: false, message: toUserMessage(insertError, 'Failed to create asset class') };
      }
      const asset = created as AssetTypeInfo;
      setAssetTypes((prev) => [...prev, asset].sort((a, b) => a.type_name.localeCompare(b.type_name)));

      if (params.policies.length === 0) return { ok: true, policiesSaved: true };
      const { error: elecError } = await supabase.from('accounting_policy_elections').insert(
        params.policies.map((p) => ({
          company_id: selectedCompanyId,
          fixed_asset_type_id: asset.id,
          policy_type: p.policyType,
          election_value: p.electionValue,
          effective_from: params.effectiveFrom,
          status: 'pending_approval',
          policy_version: 0,
          notes: params.notes?.trim() || null,
        }))
      );
      reload();
      return { ok: true, policiesSaved: !elecError };
    } catch (err) {
      return { ok: false, duplicate: false, message: toUserMessage(err, 'Failed to create asset class') };
    }
  }, [selectedCompanyId, assetTypes, reload]);

  return {
    elections,
    assetTypes,
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    loading,
    error,
    saveElection,
    submitForApproval,
    setCompanyEntityType,
    createAssetClassWithPolicies,
    reload,
  };
}
