import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type { ContractCancellation, ContractModificationRow } from '../components/contract-mods/contractModHelpers';
import { fetchAll, fetchAllIn } from '../utils/fetchAll';
import { currentOrgId } from '../utils/currentOrg';
import { toUserMessage } from '../utils/errors';

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
  notes?: string | null;
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

interface UseContractModificationsDataResult {
  modifications: ContractModificationRow[];
  cancellations: ContractCancellation[];
  leases: Lease[];
  loading: boolean;
  error: string | null;
  loadData: () => void;
  retry: () => void;
}

/**
 * Loads leases, contract modifications and contract cancellations for the
 * ContractModificationView. `loadData` triggers a refetch of modifications
 * and cancellations (leases are loaded once up front).
 */
export function useContractModificationsData(): UseContractModificationsDataResult {
  const [modifications, setModifications] = useState<ContractModificationRow[]>([]);
  const [cancellations, setCancellations] = useState<ContractCancellation[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [leasesKey, setLeasesKey] = useState(0);
  const [leasesError, setLeasesError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadData = useCallback(() => setRefreshKey((k) => k + 1), []);
  const retry = useCallback(() => {
    setLeasesKey((k) => k + 1);
    setRefreshKey((k) => k + 1);
  }, []);

  // Load leases once.
  useEffect(() => {
    let cancelled = false;
    async function loadLeases() {
      setLeasesError(null);
      let data: Lease[];
      try {
        const orgId = await currentOrgId();
        data = await fetchAll<Lease>('leases', (from, to) => supabase
          .from('leases')
          .select('*')
          .eq('organization_id', orgId)
          .order('lease_name')
          .order('id')
          .range(from, to));
      } catch (err) {
        if (cancelled) return;
        setLeases([]);
        setLeasesError(toUserMessage(err, 'Failed to load leases.'));
        return;
      }
      if (cancelled) return;
      setLeases(data);
    }
    loadLeases();
    return () => {
      cancelled = true;
    };
  }, [leasesKey]);

  // Load modifications + cancellations.
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setDataError(null);
      try {
        const orgId = await currentOrgId();
        const leaseIds = leases.map((l) => l.id);
        if (leaseIds.length === 0) {
          setModifications([]);
          setCancellations([]);
          return;
        }

        const modData = await fetchAllIn<RawModificationRow>('modifications', leaseIds, (batch, from, to) => supabase
          .from('contract_modifications')
          .select('*, leases:lease_id (lease_name)')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .order('modification_date', { ascending: false })
          .order('id')
          .range(from, to));

        if (cancelled) return;
        setModifications(
          modData.map((r) => ({
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
            notes: r.notes ?? undefined,
            status: r.status,
            lease_name: r.leases?.lease_name ?? undefined,
          })),
        );

        const canData = await fetchAllIn<RawCancellationRow>('cancellations', leaseIds, (batch, from, to) => supabase
          .from('contract_cancellations')
          .select('*, leases:lease_id (lease_name)')
          .eq('organization_id', orgId)
          .in('lease_id', batch)
          .order('cancellation_date', { ascending: false })
          .order('id')
          .range(from, to));

        if (cancelled) return;
        setCancellations(
          canData.map((r) => ({
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
      } catch (err) {
        if (cancelled) return;
        setModifications([]);
        setCancellations([]);
        setDataError(toUserMessage(err, 'Failed to load contract modifications.'));
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
    modifications,
    cancellations,
    leases,
    loading,
    error: leasesError ?? dataError,
    loadData,
    retry,
  };
}
