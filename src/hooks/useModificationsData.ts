import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type { CancellationRow, ModificationRow } from '../components/modifications/types';
import { toUserMessage } from '../utils/errors';
import { fetchAll, fetchAllIn } from '../utils/fetchAll';
import { currentOrgId } from '../utils/currentOrg';

interface RawLeaseRow {
  id: string;
  user_id: string;
  lease_name: string;
  lease_description: string;
  lessor_name: string;
  lease_start_date: string;
  lease_end_date: string;
  lease_term_months: number;
  payment_amount: number;
  payment_frequency: string;
  incremental_borrowing_rate: number;
  lease_classification: 'operating' | 'finance';
  initial_direct_costs: number;
  lease_incentives: number;
  rou_asset: number | null;
  lease_liability: number | null;
  status: 'active' | 'terminated' | 'expired' | 'cancelled' | 'pending';
  payment_timing: 'beginning' | 'end';
  transfer_ownership: boolean;
  purchase_option: boolean;
  purchase_option_price: number;
  asset_fair_value: number;
  asset_market_value: number;
  asset_economic_life_months: number;
  specialized_asset: boolean;
  residual_value_guarantee: number;
  auto_classified: boolean;
  lessor_type: 'corporate' | 'individual' | 'government' | 'financial_institution' | 'other';
  branch_id?: string | null;
  company_id?: string | null;
  fixed_asset_type_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface RawModificationRow {
  id: string;
  user_id: string;
  lease_id: string;
  modification_date: string;
  modification_type: string;
  reason: string;
  old_monthly_payment: number;
  new_monthly_payment: number;
  old_lease_term: number;
  new_lease_term: number;
  old_discount_rate?: number | null;
  new_discount_rate?: number | null;
  old_rou_asset?: number | null;
  new_rou_asset?: number | null;
  old_lease_liability?: number | null;
  new_lease_liability?: number | null;
  accounting_treatment?: string | null;
  remeasurement_required?: boolean | null;
  notes?: string | null;
  approved_by?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  leases?: { lease_name?: string } | null;
}

interface RawCancellationRow {
  id: string;
  user_id: string;
  lease_id: string;
  cancellation_date: string;
  cancellation_reason: string;
  early_termination: boolean;
  termination_penalty: number;
  remaining_rou_asset: number;
  remaining_lease_liability: number;
  gain_loss_amount: number;
  final_payment_amount: number;
  settlement_details?: string | null;
  approved_by?: string | null;
  status: string;
  derecognition_posted: boolean;
  created_at: string;
  updated_at: string;
  leases?: { lease_name?: string } | null;
}

interface UseModificationsDataResult {
  leases: Lease[];
  modifications: ModificationRow[];
  cancellations: CancellationRow[];
  loadData: () => void;
  loading: boolean;
  errorMessage: string;
  setErrorMessage: (v: string) => void;
  successMessage: string;
  setSuccessMessage: (v: string) => void;
}

const NO_LEASES: Lease[] = [];

/**
 * Loads leases, contract modifications and contract cancellations for a given
 * company (optional). `loadData` re-runs the fetches without reloading
 * leases, which is the cheap ref data we keep in memory.
 */
export function useModificationsData(selectedCompanyId?: string | null): UseModificationsDataResult {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [modifications, setModifications] = useState<ModificationRow[]>([]);
  const [cancellations, setCancellations] = useState<CancellationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [leaseAttempt, setLeaseAttempt] = useState(0);
  const leasesFailed = leases === null && !loading;

  const loadData = useCallback(() => {
    if (leasesFailed) setLeaseAttempt((k) => k + 1);
    else setRefreshKey((k) => k + 1);
  }, [leasesFailed]);

  // Load leases once (and on company change).
  useEffect(() => {
    let cancelled = false;
    async function loadLeases() {
      let rows: RawLeaseRow[];
      setLoading(true);
      setErrorMessage('');
      try {
        const orgId = await currentOrgId();
        rows = await fetchAll<RawLeaseRow>('leases', (from, to) => supabase
          .from('leases')
          .select('*')
          .eq('organization_id', orgId)
          .order('lease_name')
          .order('id')
          .range(from, to));
      } catch (err) {
        if (!cancelled) {
          setLeases(null);
          setErrorMessage(toUserMessage(err, 'Failed to load leases.'));
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      if (selectedCompanyId) {
        rows = rows.filter((l) => l.company_id === selectedCompanyId);
      }
      setLeases(rows as unknown as Lease[]);
    }
    loadLeases();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, leaseAttempt]);

  // Load modifications + cancellations.
  useEffect(() => {
    if (!leases) return;
    const loadedLeases = leases;
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setErrorMessage('');
      try {
        const orgId = await currentOrgId();
        const leaseIds = loadedLeases.map((l) => l.id);
        if (leaseIds.length === 0) {
          setModifications([]);
          setCancellations([]);
          return;
        }

        let modData: RawModificationRow[] | null = null;
        let modError: unknown = null;
        try {
          modData = await fetchAllIn<RawModificationRow>('modifications', leaseIds, (batch, from, to) => supabase
            .from('contract_modifications')
            .select('*, leases:lease_id (lease_name)')
            .eq('organization_id', orgId)
            .in('lease_id', batch)
            .order('modification_date', { ascending: false })
            .order('id')
            .range(from, to));
        } catch (err) {
          modError = err;
        }

        if (cancelled) return;
        if (modError || !modData) {
          setErrorMessage(toUserMessage(modError, 'Failed to load modifications.'));
          setModifications([]);
        } else {
          const rows = modData;
          setModifications(
            rows.map((r) => ({
              id: r.id,
              lease_id: r.lease_id,
              modification_date: r.modification_date,
              modification_type: r.modification_type,
              reason: r.reason,
              old_monthly_payment: Number(r.old_monthly_payment ?? 0),
              new_monthly_payment: Number(r.new_monthly_payment ?? 0),
              old_lease_term: Number(r.old_lease_term ?? 0),
              new_lease_term: Number(r.new_lease_term ?? 0),
              old_discount_rate: r.old_discount_rate != null ? Number(r.old_discount_rate) : undefined,
              new_discount_rate: r.new_discount_rate != null ? Number(r.new_discount_rate) : undefined,
              accounting_treatment: r.accounting_treatment ?? undefined,
              remeasurement_required: Boolean(r.remeasurement_required),
              notes: r.notes ?? undefined,
              status: r.status,
              lease_name: r.leases?.lease_name ?? undefined,
            })),
          );
        }

        let canData: RawCancellationRow[] | null = null;
        let canError: unknown = null;
        try {
          canData = await fetchAllIn<RawCancellationRow>('cancellations', leaseIds, (batch, from, to) => supabase
            .from('contract_cancellations')
            .select('*, leases:lease_id (lease_name)')
            .eq('organization_id', orgId)
            .in('lease_id', batch)
            .order('cancellation_date', { ascending: false })
            .order('id')
            .range(from, to));
        } catch (err) {
          canError = err;
        }

        if (cancelled) return;
        if (canError || !canData) {
          setErrorMessage(toUserMessage(canError, 'Failed to load cancellations.'));
          setCancellations([]);
        } else {
          const rows = canData;
          setCancellations(
            rows.map((r) => ({
              id: r.id,
              lease_id: r.lease_id,
              cancellation_date: r.cancellation_date,
              cancellation_reason: r.cancellation_reason,
              early_termination: Boolean(r.early_termination),
              termination_penalty: Number(r.termination_penalty ?? 0),
              remaining_rou_asset: Number(r.remaining_rou_asset ?? 0),
              remaining_lease_liability: Number(r.remaining_lease_liability ?? 0),
              gain_loss_amount: Number(r.gain_loss_amount ?? 0),
              final_payment_amount: Number(r.final_payment_amount ?? 0),
              settlement_details: r.settlement_details ?? undefined,
              approved_by: r.approved_by ?? null,
              status: r.status,
              derecognition_posted: Boolean(r.derecognition_posted),
              lease_name: r.leases?.lease_name ?? undefined,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) setErrorMessage(toUserMessage(err, 'Failed to load modifications.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [leases, refreshKey]);

  return {
    leases: leases ?? NO_LEASES,
    modifications,
    cancellations,
    loadData,
    loading,
    errorMessage,
    setErrorMessage,
    successMessage,
    setSuccessMessage,
  };
}
