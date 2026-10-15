import { useCallback, useState } from 'react';
import type { Lease } from '../types/lease';
import type {
  ContractCancellation,
  ContractCancellationForm,
  ContractModificationForm,
  ContractModificationRow,
} from '../components/contract-mods/contractModHelpers';

const EMPTY_MOD_FORM: ContractModificationForm = {
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
  notes: '',
  separate_contract: false,
  new_fair_value: null,
  new_economic_life_months: null,
  new_classification: 'operating',
};

const EMPTY_CAN_FORM: ContractCancellationForm = {
  lease_id: '',
  cancellation_date: new Date().toISOString().split('T')[0],
  cancellation_reason: '',
  early_termination: false,
  termination_penalty: 0,
  final_payment_amount: 0,
  settlement_details: '',
};

interface UseContractModFormResult {
  activeTab: 'modifications' | 'cancellations';
  setActiveTab: (t: 'modifications' | 'cancellations') => void;
  showModificationModal: boolean;
  setShowModificationModal: (v: boolean) => void;
  showCancellationModal: boolean;
  setShowCancellationModal: (v: boolean) => void;
  showViewModal: boolean;
  setShowViewModal: (v: boolean) => void;
  selectedModification: ContractModificationRow | null;
  setSelectedModification: (m: ContractModificationRow | null) => void;
  editingModification: ContractModificationRow | null;
  setEditingModification: (m: ContractModificationRow | null) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  successMessage: string;
  setSuccessMessage: (v: string) => void;
  errorMessage: string;
  setErrorMessage: (v: string) => void;
  modPage: number;
  setModPage: (p: number) => void;
  canPage: number;
  setCanPage: (p: number) => void;
  modPageSize: number;
  setModPageSize: (s: number) => void;
  canPageSize: number;
  setCanPageSize: (s: number) => void;
  modificationForm: ContractModificationForm;
  setModificationForm: React.Dispatch<React.SetStateAction<ContractModificationForm>>;
  cancellationForm: ContractCancellationForm;
  setCancellationForm: React.Dispatch<React.SetStateAction<ContractCancellationForm>>;
  resetModificationForm: () => void;
  resetCancellationForm: () => void;
  populateModificationFormForEdit: (m: ContractModificationRow, leases?: Lease[]) => void;
  openViewModal: (m: ContractModificationRow) => void;
}

/**
 * Form/modal/selection/pagination state for ContractModificationView.
 */
export function useContractModForm(): UseContractModFormResult {
  const [activeTab, setActiveTab] = useState<'modifications' | 'cancellations'>('modifications');
  const [showModificationModal, setShowModificationModal] = useState(false);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedModification, setSelectedModification] = useState<ContractModificationRow | null>(null);
  const [editingModification, setEditingModification] = useState<ContractModificationRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [modPage, setModPage] = useState(1);
  const [canPage, setCanPage] = useState(1);
  const [modPageSize, setModPageSize] = useState(10);
  const [canPageSize, setCanPageSize] = useState(10);
  const [modificationForm, setModificationForm] = useState<ContractModificationForm>(EMPTY_MOD_FORM);
  const [cancellationForm, setCancellationForm] = useState<ContractCancellationForm>(EMPTY_CAN_FORM);

  const resetModificationForm = useCallback(() => {
    setModificationForm({ ...EMPTY_MOD_FORM, modification_date: new Date().toISOString().split('T')[0] });
  }, []);

  const resetCancellationForm = useCallback(() => {
    setCancellationForm({ ...EMPTY_CAN_FORM, cancellation_date: new Date().toISOString().split('T')[0] });
  }, []);

  const populateModificationFormForEdit = useCallback(
    (m: ContractModificationRow, leases: Lease[] = []) => {
      const lease = leases.find((l) => l.id === m.lease_id);
      setEditingModification(m);
      setModificationForm({
        id: m.id,
        lease_id: m.lease_id,
        modification_date: m.modification_date?.split('T')[0] ?? new Date().toISOString().split('T')[0],
        modification_type: m.modification_type,
        reason: m.reason,
        old_monthly_payment: Number(m.old_monthly_payment ?? lease?.payment_amount ?? 0),
        new_monthly_payment: Number(m.new_monthly_payment ?? 0),
        old_lease_term: Number(m.old_lease_term ?? lease?.lease_term_months ?? 0),
        new_lease_term: Number(m.new_lease_term ?? 0),
        old_discount_rate: Number(m.old_discount_rate ?? lease?.discount_rate ?? lease?.incremental_borrowing_rate ?? 0),
        new_discount_rate: Number(m.new_discount_rate ?? 0),
        notes: m.notes ?? '',
        separate_contract: Boolean(m.separate_contract),
        new_fair_value: m.fair_value_at_modification == null ? null : Number(m.fair_value_at_modification),
        new_economic_life_months: m.remaining_economic_life_months ?? null,
        new_classification: m.reassessed_classification ?? 'operating',
      });
      setShowModificationModal(true);
    },
    [],
  );

  const openViewModal = useCallback((m: ContractModificationRow) => {
    setSelectedModification(m);
    setShowViewModal(true);
  }, []);

  return {
    activeTab,
    setActiveTab,
    showModificationModal,
    setShowModificationModal,
    showCancellationModal,
    setShowCancellationModal,
    showViewModal,
    setShowViewModal,
    selectedModification,
    setSelectedModification,
    editingModification,
    setEditingModification,
    searchQuery,
    setSearchQuery,
    submitting,
    setSubmitting,
    successMessage,
    setSuccessMessage,
    errorMessage,
    setErrorMessage,
    modPage,
    setModPage,
    canPage,
    setCanPage,
    modPageSize,
    setModPageSize,
    canPageSize,
    setCanPageSize,
    modificationForm,
    setModificationForm,
    cancellationForm,
    setCancellationForm,
    resetModificationForm,
    resetCancellationForm,
    populateModificationFormForEdit,
    openViewModal,
  };
}

// Re-export so callers can type props without an extra import.
export type { ContractCancellation };
