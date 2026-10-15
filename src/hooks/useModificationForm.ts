import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { JournalEntry, Lease } from '../types/lease';
import { calculatePresentValue, round2 } from '../utils/leaseCalculations';
import { fetchAll } from '../utils/fetchAll';
import type {
  CancellationFormData,
  CancellationRow,
  ModificationFormData,
  ModificationRow,
  RemeasurementPreview,
} from '../components/modifications/types';
import { currentOrgId } from '../utils/currentOrg';

const EMPTY_MOD_FORM: ModificationFormData = {
  lease_id: '',
  modification_date: new Date().toISOString().split('T')[0],
  modification_type: 'term_extension',
  reason: '',
  old_monthly_payment: null,
  new_monthly_payment: 0,
  old_lease_term: null,
  new_lease_term: 0,
  old_discount_rate: null,
  new_discount_rate: 0,
  accounting_treatment: 'remeasurement',
  remeasurement_required: true,
  notes: '',
  separate_contract: false,
  new_classification: 'operating',
  new_fair_value: null,
  new_economic_life_months: null,
};

const EMPTY_CAN_FORM: CancellationFormData = {
  lease_id: '',
  cancellation_date: new Date().toISOString().split('T')[0],
  cancellation_reason: '',
  early_termination: false,
  termination_penalty: 0,
  final_payment_amount: 0,
  settlement_details: '',
};

interface UseModificationFormResult {
  modForm: ModificationFormData;
  setModForm: React.Dispatch<React.SetStateAction<ModificationFormData>>;
  canForm: CancellationFormData;
  setCanForm: React.Dispatch<React.SetStateAction<CancellationFormData>>;
  showModForm: boolean;
  setShowModForm: (v: boolean) => void;
  showCanForm: boolean;
  setShowCanForm: (v: boolean) => void;
  selectedMod: ModificationRow | null;
  setSelectedMod: (m: ModificationRow | null) => void;
  selectedCan: CancellationRow | null;
  setSelectedCan: (c: CancellationRow | null) => void;
  editingMod: ModificationRow | null;
  editingCan: CancellationRow | null;
  preview: RemeasurementPreview | null;
  setPreview: (p: RemeasurementPreview | null) => void;
  canJournalEntries: JournalEntry[];
  canJournalLoading: boolean;
  canPreview: boolean;
  computePreview: () => RemeasurementPreview | null;
  refreshPreview: () => void;
  openEditMod: (m: ModificationRow) => void;
  closeModForm: () => void;
  openEditCan: (c: CancellationRow) => void;
  closeCanForm: () => void;
}

/**
 * Owns the form/modal/selection state for the ModificationsModule, plus a
 * lightweight remeasurement preview computed from the selected lease's
 * current balances and the form's proposed new payment/term/rate.
 */
export function useModificationForm(leases: Lease[] = []): UseModificationFormResult {
  const [modForm, setModForm] = useState<ModificationFormData>(EMPTY_MOD_FORM);
  const [canForm, setCanForm] = useState<CancellationFormData>(EMPTY_CAN_FORM);
  const [showModForm, setShowModForm] = useState(false);
  const [showCanForm, setShowCanForm] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModificationRow | null>(null);
  const [selectedCan, setSelectedCan] = useState<CancellationRow | null>(null);
  const [editingMod, setEditingMod] = useState<ModificationRow | null>(null);
  const [editingCan, setEditingCan] = useState<CancellationRow | null>(null);
  const [preview, setPreview] = useState<RemeasurementPreview | null>(null);
  const [canJournalEntries, setCanJournalEntries] = useState<JournalEntry[]>([]);
  const [canJournalLoading, setCanJournalLoading] = useState(false);

  const computePreview = useCallback((): RemeasurementPreview | null => {
    if (!modForm.lease_id) return null;
    if (modForm.separate_contract) return null;
    const newPayment = Number(modForm.new_monthly_payment) || 0;
    const newTerm = Number(modForm.new_lease_term) || 0;
    const newRate = Number(modForm.new_discount_rate) || 0;
    if (!newPayment || !newTerm) return null;

    const lease = leases.find((l) => l.id === modForm.lease_id);
    const oldRouAsset = Number(lease?.rou_asset) || 0;
    const oldLiability = Number(lease?.lease_liability) || 0;
    const timing = (lease?.payment_timing === 'end' ? 'end' : 'beginning') as 'beginning' | 'end';

    const newLiability = round2(calculatePresentValue(newPayment, newTerm, newRate, timing));
    const liabilityAdj = round2(newLiability - oldLiability);
    const newRouAsset = round2(oldRouAsset + liabilityAdj);
    const rouAdj = round2(newRouAsset - oldRouAsset);

    return {
      old_rou_asset: oldRouAsset,
      old_lease_liability: oldLiability,
      new_rou_asset: newRouAsset,
      new_lease_liability: newLiability,
      rou_adjustment: rouAdj,
      liability_adjustment: liabilityAdj,
    };
  }, [modForm, leases]);

  const canPreview = Boolean(
    modForm.lease_id &&
      modForm.new_monthly_payment &&
      modForm.new_lease_term &&
      modForm.modification_date,
  );

  const refreshPreview = useCallback(() => {
    setPreview(computePreview());
  }, [computePreview]);

  const closeModForm = useCallback(() => {
    setShowModForm(false);
    setEditingMod(null);
    setPreview(null);
    setModForm(EMPTY_MOD_FORM);
  }, []);

  const closeCanForm = useCallback(() => {
    setShowCanForm(false);
    setEditingCan(null);
    setCanForm(EMPTY_CAN_FORM);
  }, []);

  const openEditMod = useCallback((m: ModificationRow) => {
    setEditingMod(m);
    setPreview(null);
    setModForm({
      id: m.id,
      lease_id: m.lease_id,
      modification_date: m.modification_date?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      modification_type: m.modification_type,
      reason: m.reason,
      old_monthly_payment: m.old_monthly_payment == null ? null : Number(m.old_monthly_payment),
      new_monthly_payment: Number(m.new_monthly_payment ?? 0),
      old_lease_term: m.old_lease_term == null ? null : Number(m.old_lease_term),
      new_lease_term: Number(m.new_lease_term ?? 0),
      old_discount_rate: m.old_discount_rate == null ? null : Number(m.old_discount_rate),
      new_discount_rate: Number(m.new_discount_rate ?? 0),
      accounting_treatment: m.accounting_treatment || 'remeasurement',
      remeasurement_required: true,
      notes: m.notes ?? '',
      separate_contract: Boolean(m.separate_contract),
      new_classification: (m as { new_classification?: string }).new_classification === 'finance' ? 'finance' : 'operating',
      new_fair_value: m.fair_value_at_modification == null ? null : Number(m.fair_value_at_modification),
      new_economic_life_months: m.remaining_economic_life_months ?? null,
    });
    setShowModForm(true);
  }, []);

  const openEditCan = useCallback((c: CancellationRow) => {
    setEditingCan(c);
    setCanForm({
      id: c.id,
      lease_id: c.lease_id,
      cancellation_date: c.cancellation_date?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      cancellation_reason: c.cancellation_reason,
      early_termination: Boolean(c.early_termination),
      termination_penalty: Number(c.termination_penalty ?? 0),
      final_payment_amount: Number(c.final_payment_amount ?? 0),
      settlement_details: c.settlement_details ?? '',
    });
    setShowCanForm(true);
  }, []);

  // Load journal entries for the selected cancellation (detail modal).
  useEffect(() => {
    let cancelled = false;
    async function loadJournal() {
      if (!selectedCan) {
        setCanJournalEntries([]);
        return;
      }
      setCanJournalLoading(true);
      const orgId = await currentOrgId();
      const data = await fetchAll<JournalEntry>('journal entries', (from, to) => supabase
        .from('journal_entries')
        .select('*')
        .eq('organization_id', orgId)
        .eq('lease_id', selectedCan.lease_id)
        .order('entry_date', { ascending: false })
        .order('id')
        .range(from, to)).catch(() => null);
      if (cancelled) return;
      setCanJournalEntries(data ?? []);
      setCanJournalLoading(false);
    }
    loadJournal();
    return () => {
      cancelled = true;
    };
  }, [selectedCan]);

  return {
    modForm,
    setModForm,
    canForm,
    setCanForm,
    showModForm,
    setShowModForm,
    showCanForm,
    setShowCanForm,
    selectedMod,
    setSelectedMod,
    selectedCan,
    setSelectedCan,
    editingMod,
    editingCan,
    preview,
    setPreview,
    canJournalEntries,
    canJournalLoading,
    canPreview,
    computePreview,
    refreshPreview,
    openEditMod,
    closeModForm,
    openEditCan,
    closeCanForm,
  };
}

// Re-export Lease so callers can type the leases prop without an extra import.
export type { Lease };
