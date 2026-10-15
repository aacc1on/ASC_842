import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type {
  ContractCancellationForm,
  ContractModificationForm,
  ContractModificationRow,
} from '../components/contract-mods/contractModHelpers';
import { finalizeSavedItem, saveItemEdit } from '../utils/approvals';
import { cancellationContent, modificationContent, newItemFields } from '../utils/modifications/editPayload';
import { toUserMessage } from '../utils/errors';

interface UseContractModActionsArgs {
  leases: Lease[];
  modificationForm: ContractModificationForm;
  cancellationForm: ContractCancellationForm;
  editingModification: ContractModificationRow | null;
  loadData: () => void;
  setSubmitting: (v: boolean) => void;
  setErrorMessage: (v: string) => void;
  setSuccessMessage: (v: string) => void;
  setShowModificationModal: (v: boolean) => void;
  setShowCancellationModal: (v: boolean) => void;
  setEditingModification: (m: ContractModificationRow | null) => void;
  resetModificationForm: () => void;
  resetCancellationForm: () => void;
}

interface UseContractModActionsResult {
  handleModificationSubmit: (e: React.FormEvent) => Promise<void>;
  handleCancellationSubmit: (e: React.FormEvent) => Promise<void>;
  handleDeleteModification: (id: string) => Promise<void>;
}

async function savedMessage(
  type: 'contract_modification' | 'contract_cancellation',
  saved: { id: string; status: string } | null,
  label: string,
): Promise<string> {
  if (!saved) return `${label}.`;
  const pending = await finalizeSavedItem(type, saved.id, saved.status);
  return pending
    ? `${label} and sent for approval. It will be applied once approved in Settings > Approval.`
    : `${label} and applied.`;
}

function currentUserId(): Promise<string | null> {
  return supabase.auth.getUser().then(({ data: { user } }) => user?.id ?? null);
}

/**
 * CRUD handlers for the ContractModificationView. Each handler manages the
 * submitting flag, message banners, modal close, and data refresh.
 */
export function useContractModActions({
  leases,
  modificationForm,
  cancellationForm,
  editingModification,
  loadData,
  setSubmitting,
  setErrorMessage,
  setSuccessMessage,
  setShowModificationModal,
  setShowCancellationModal,
  setEditingModification,
  resetModificationForm,
  resetCancellationForm,
}: UseContractModActionsArgs): UseContractModActionsResult {
  const handleModificationSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');
      if (!modificationForm.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      const lease = leases.find((l) => l.id === modificationForm.lease_id);
      setSubmitting(true);
      try {
        const content = modificationContent(modificationForm, lease);
        if (editingModification) {
          const saved = await saveItemEdit('contract_modification', editingModification.id, content, editingModification.status);
          setSuccessMessage(await savedMessage('contract_modification', saved, 'Modification updated'));
        } else {
          const userId = await currentUserId();
          const { data: saved, error } = await supabase
            .from('contract_modifications')
            .insert({ ...newItemFields(userId, lease), ...content })
            .select('id, status')
            .single();
          if (error) {
            setErrorMessage(toUserMessage(error, 'Failed to create modification.'));
            return;
          }
          setSuccessMessage(await savedMessage('contract_modification', saved, 'Modification created'));
        }
        setShowModificationModal(false);
        setEditingModification(null);
        resetModificationForm();
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, editingModification ? 'Failed to update modification.' : 'Failed to save modification.'));
      } finally {
        setSubmitting(false);
      }
    },
    [
      leases,
      modificationForm,
      editingModification,
      setSubmitting,
      setErrorMessage,
      setSuccessMessage,
      setShowModificationModal,
      setEditingModification,
      resetModificationForm,
      loadData,
    ],
  );

  const handleCancellationSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');
      if (!cancellationForm.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      const lease = leases.find((l) => l.id === cancellationForm.lease_id);
      setSubmitting(true);
      try {
        const userId = await currentUserId();
        const payload = { ...newItemFields(userId, lease), ...cancellationContent(cancellationForm, lease), derecognition_posted: false };
        const { data: saved, error } = await supabase.from('contract_cancellations').insert(payload).select('id, status').single();
        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to create cancellation.'));
          return;
        }
        setSuccessMessage(await savedMessage('contract_cancellation', saved, 'Cancellation created'));
        setShowCancellationModal(false);
        resetCancellationForm();
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to save cancellation.'));
      } finally {
        setSubmitting(false);
      }
    },
    [
      leases,
      cancellationForm,
      setSubmitting,
      setErrorMessage,
      setSuccessMessage,
      setShowCancellationModal,
      resetCancellationForm,
      loadData,
    ],
  );

  const handleDeleteModification = useCallback(
    async (id: string) => {
      setErrorMessage('');
      setSuccessMessage('');
      setSubmitting(true);
      try {
        const { error } = await supabase.from('contract_modifications').delete().eq('id', id);
        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to delete modification.'));
          return;
        }
        setSuccessMessage('Modification deleted.');
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to delete modification.'));
      } finally {
        setSubmitting(false);
      }
    },
    [setSubmitting, setErrorMessage, setSuccessMessage, loadData],
  );

  return {
    handleModificationSubmit,
    handleCancellationSubmit,
    handleDeleteModification,
  };
}
