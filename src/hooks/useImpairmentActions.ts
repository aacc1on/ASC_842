import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Lease } from '../types/lease';
import { finalizeSavedItem } from '../utils/approvals';
import { toUserMessage } from '../utils/errors';

export interface ImpairmentRow {
  id: string;
  lease_id: string;
  impairment_date: string;
  impairment_amount: number;
  reason: string | null;
  posted: boolean;
  status: string;
  created_at: string;
  lease_name?: string;
}

export interface ImpairmentFormData {
  lease_id: string;
  impairment_date: string;
  impairment_amount: number;
  reason: string;
}

interface UseImpairmentActionsArgs {
  leases: Lease[];
  loadData: () => void;
  setErrorMessage: (v: string) => void;
  setSuccessMessage: (v: string) => void;
  closeForm: () => void;
}

interface UseImpairmentActionsResult {
  handleSubmit: (e: React.FormEvent, form: ImpairmentFormData) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

/**
 * Create/delete handlers for ROU asset impairments. Each handler clears the
 * message banners, performs the mutation, refreshes data, and surfaces a
 * success or error message — mirroring the useModificationActions pattern.
 */
export function useImpairmentActions({
  leases,
  loadData,
  setErrorMessage,
  setSuccessMessage,
  closeForm,
}: UseImpairmentActionsArgs): UseImpairmentActionsResult {
  const handleSubmit = useCallback(
    async (e: React.FormEvent, form: ImpairmentFormData) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');
      if (!form.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      if (!form.impairment_date) {
        setErrorMessage('Please select an impairment date.');
        return;
      }
      if (form.impairment_amount <= 0) {
        setErrorMessage('Impairment amount must be greater than zero.');
        return;
      }
      try {
        const lease = leases.find((l) => l.id === form.lease_id);
        const payload = {
          organization_id: lease?.organization_id,
          lease_id: form.lease_id,
          impairment_date: form.impairment_date,
          impairment_amount: form.impairment_amount,
          reason: form.reason || null,
          posted: false,
          status: 'pending_approval',
        };
        const { data: saved, error } = await supabase.from('lease_impairments').insert(payload).select('id, status').single();
        if (error || !saved) {
          setErrorMessage(toUserMessage(error, 'Failed to create impairment record.'));
          return;
        }
        const pending = await finalizeSavedItem('impairment', saved.id, saved.status);
        setSuccessMessage(
          pending
            ? 'Impairment sent for approval. It will be posted once approved in Settings > Approval.'
            : `Impairment of ${formatCurrency(form.impairment_amount)} posted to the ledger.`,
        );
        closeForm();
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to save impairment.'));
      }
    },
    [leases, setErrorMessage, setSuccessMessage, closeForm, loadData],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setErrorMessage('');
      setSuccessMessage('');
      try {
        const { error } = await supabase.from('lease_impairments').delete().eq('id', id);
        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to delete impairment.'));
          return;
        }
        setSuccessMessage('Impairment record deleted.');
        loadData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to delete impairment.'));
      }
    },
    [setErrorMessage, setSuccessMessage, loadData],
  );

  return { handleSubmit, handleDelete };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount || 0);
}
