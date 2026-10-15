import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import type {
  CancellationFormData,
  CancellationRow,
  ModificationFormData,
  ModificationRow,
} from '../components/modifications/types';
import { finalizeSavedItem, saveItemEdit } from '../utils/approvals';
import { cancellationContent, modificationContent, newItemFields } from '../utils/modifications/editPayload';
import { toUserMessage } from '../utils/errors';

interface UseModificationActionsArgs {
  leases: Lease[];
  modForm: ModificationFormData;
  canForm: CancellationFormData;
  editingMod: ModificationRow | null;
  editingCan: CancellationRow | null;
  computePreview: () => { new_rou_asset: number; new_lease_liability: number; old_rou_asset: number; old_lease_liability: number; rou_adjustment: number; liability_adjustment: number } | null;
  loadData: () => void;
  setErrorMessage: (v: string) => void;
  setSuccessMessage: (v: string) => void;
  closeModForm: () => void;
  closeCanForm: () => void;
}

interface UseModificationActionsResult {
  handleModSubmit: (e: React.FormEvent) => Promise<void>;
  handleCanSubmit: (e: React.FormEvent) => Promise<void>;
  handleDelete: (id: string, kind: 'modification' | 'cancellation') => Promise<void>;
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
 * CRUD handlers for contract modifications and cancellations. Each handler
 * clears the message banners, performs the mutation, refreshes data, and
 * surfaces a success or error message.
 */
export function useModificationActions({
  leases,
  modForm,
  canForm,
  editingMod,
  editingCan,
  computePreview,
  loadData,
  setErrorMessage,
  setSuccessMessage,
  closeModForm,
  closeCanForm,
}: UseModificationActionsArgs): UseModificationActionsResult {
  const handleModSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');
      if (!modForm.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      const lease = leases.find((l) => l.id === modForm.lease_id);
      const preview = computePreview();
      try {
        const content = {
          ...modificationContent(modForm, lease),
          old_rou_asset: preview?.old_rou_asset ?? lease?.rou_asset ?? null,
          new_rou_asset: preview?.new_rou_asset ?? null,
          old_lease_liability: preview?.old_lease_liability ?? lease?.lease_liability ?? null,
          new_lease_liability: preview?.new_lease_liability ?? null,
          accounting_treatment: modForm.accounting_treatment,
          remeasurement_required: modForm.remeasurement_required,
        };
        if (editingMod) {
          const saved = await saveItemEdit('contract_modification', editingMod.id, content, editingMod.status);
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
        closeModForm();
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, editingMod ? 'Failed to update modification.' : 'Failed to save modification.'));
      }
    },
    [
      leases,
      modForm,
      editingMod,
      computePreview,
      setErrorMessage,
      setSuccessMessage,
      closeModForm,
      loadData,
    ],
  );

  const handleCanSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');
      if (!canForm.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      const lease = leases.find((l) => l.id === canForm.lease_id);
      try {
        // Preview values computed at form time; actual values will be
        // recomputed from the stored schedule when the cancellation is approved.
        const content = cancellationContent(canForm, lease);
        if (editingCan) {
          const saved = await saveItemEdit('contract_cancellation', editingCan.id, content, editingCan.status);
          setSuccessMessage(await savedMessage('contract_cancellation', saved, 'Cancellation updated'));
        } else {
          const userId = await currentUserId();
          const { data: saved, error } = await supabase
            .from('contract_cancellations')
            .insert({ ...newItemFields(userId, lease), ...content, derecognition_posted: false })
            .select('id, status')
            .single();
          if (error) {
            setErrorMessage(toUserMessage(error, 'Failed to create cancellation.'));
            return;
          }
          setSuccessMessage(await savedMessage('contract_cancellation', saved, 'Cancellation created'));
        }
        closeCanForm();
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, editingCan ? 'Failed to update cancellation.' : 'Failed to save cancellation.'));
      }
    },
    [leases, canForm, editingCan, setErrorMessage, setSuccessMessage, closeCanForm, loadData],
  );

  const handleDelete = useCallback(
    async (id: string, kind: 'modification' | 'cancellation') => {
      setErrorMessage('');
      setSuccessMessage('');
      const table = kind === 'modification' ? 'contract_modifications' : 'contract_cancellations';
      try {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) {
          setErrorMessage(toUserMessage(error, `Failed to delete ${kind}.`));
          return;
        }
        setSuccessMessage(`${kind === 'modification' ? 'Modification' : 'Cancellation'} deleted.`);
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, `Failed to delete ${kind}.`));
      }
    },
    [setErrorMessage, setSuccessMessage, loadData],
  );

  return {
    handleModSubmit,
    handleCanSubmit,
    handleDelete,
  };
}
