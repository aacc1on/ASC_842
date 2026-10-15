import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Transaction, TransactionFormData } from '../components/transactions/types';
import { toUserMessage } from '../utils/errors';

interface ConfirmFn {
  (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean>;
}

interface UseTransactionMutationsArgs {
  confirmDialog: ConfirmFn;
  refreshData: () => void;
  resetForm: () => void;
  setShowAddModal: (v: boolean) => void;
  setSelectedTransaction: (t: Transaction | null) => void;
}

interface UseTransactionMutationsResult {
  submitting: boolean;
  successMessage: string;
  setSuccessMessage: (v: string) => void;
  errorMessage: string;
  setErrorMessage: (v: string) => void;
  handleSubmit: (e: React.FormEvent, formData: TransactionFormData) => Promise<void>;
  handleReverseTransaction: (t: Transaction) => Promise<void>;
  handleDeleteTransaction: (t: Transaction) => Promise<void>;
}

function currentUserId(): Promise<string | null> {
  return supabase.auth.getUser().then(({ data: { user } }) => user?.id ?? null);
}

/**
 * Create / reverse / delete mutations for transactions, with confirm dialogs
 * and success/error message state surfaced to the view.
 */
export function useTransactionMutations({
  confirmDialog,
  refreshData,
  resetForm,
  setShowAddModal,
  setSelectedTransaction,
}: UseTransactionMutationsArgs): UseTransactionMutationsResult {
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent, formData: TransactionFormData) => {
      e.preventDefault();
      setErrorMessage('');
      setSuccessMessage('');

      if (!formData.lease_id) {
        setErrorMessage('Please select a lease.');
        return;
      }
      const debit = parseFloat(formData.debit_amount || '0');
      const credit = parseFloat(formData.credit_amount || '0');
      if (Number.isNaN(debit) || Number.isNaN(credit)) {
        setErrorMessage('Debit and credit amounts must be valid numbers.');
        return;
      }
      if (debit <= 0 && credit <= 0) {
        setErrorMessage('Either debit or credit amount must be greater than zero.');
        return;
      }
      if (Math.round(debit * 100) !== Math.round(credit * 100)) {
        setErrorMessage('Debit and credit amounts must be equal so the entry balances.');
        return;
      }

      setSubmitting(true);
      try {
        const userId = await currentUserId();
        if (!userId) {
          setErrorMessage('You must be signed in.');
          return;
        }
        const period =
          formData.period ||
          (formData.transaction_date ? formData.transaction_date.slice(0, 7) : '');

        const { error } = await supabase.from('transactions').insert({
          user_id: userId,
          lease_id: formData.lease_id,
          transaction_date: formData.transaction_date,
          transaction_type: formData.transaction_type,
          account_debited: formData.account_debited,
          account_credited: formData.account_credited,
          debit_amount: debit,
          credit_amount: credit,
          description: formData.description,
          reference_number: formData.reference_number,
          period,
        });

        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to save transaction.'));
          return;
        }
        setSuccessMessage('Transaction saved successfully.');
        resetForm();
        setShowAddModal(false);
        refreshData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to save transaction.'));
      } finally {
        setSubmitting(false);
      }
    },
    [resetForm, setShowAddModal, refreshData],
  );

  const handleReverseTransaction = useCallback(
    async (t: Transaction) => {
      if (t.month_end_document_id) {
        setErrorMessage('Cannot reverse a posted month-end transaction. Create an adjusting entry instead.');
        return;
      }
      const ok = await confirmDialog({
        title: 'Reverse transaction?',
        message: `This will create a reversing entry for "${t.description || t.reference_number}".`,
        confirmLabel: 'Reverse',
        destructive: true,
      });
      if (!ok) return;

      setSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');
      try {
        const userId = await currentUserId();
        if (!userId) {
          setErrorMessage('You must be signed in.');
          return;
        }
        const { error } = await supabase.from('transactions').insert({
          user_id: userId,
          lease_id: t.lease_id,
          transaction_date: new Date().toISOString().split('T')[0],
          transaction_type: t.transaction_type,
          account_debited: t.account_credited,
          account_credited: t.account_debited,
          debit_amount: t.credit_amount,
          credit_amount: t.debit_amount,
          description: `Reversal of: ${t.description || t.reference_number}`,
          reference_number: `REV-${t.reference_number}`,
          period: new Date().toISOString().slice(0, 7),
          is_reversed: false,
          reversal_of: t.id,
        });
        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to reverse transaction.'));
          return;
        }
        await supabase.from('transactions').update({ is_reversed: true }).eq('id', t.id);
        setSuccessMessage('Transaction reversed successfully.');
        refreshData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to reverse transaction.'));
      } finally {
        setSubmitting(false);
      }
    },
    [confirmDialog, refreshData],
  );

  const handleDeleteTransaction = useCallback(
    async (t: Transaction) => {
      if (t.month_end_document_id) {
        setErrorMessage('Cannot delete a posted month-end transaction. Create a reversing entry instead.');
        return;
      }
      const ok = await confirmDialog({
        title: 'Delete transaction?',
        message: `Permanently delete "${t.description || t.reference_number}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;

      setSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');
      try {
        const isLeaseTransaction = ['initial_recognition', 'modification', 'remeasurement', 'termination'].includes(t.transaction_type);
        const table = isLeaseTransaction ? 'lease_transactions' : 'transactions';
        const { data: deletedRows, error } = await supabase
          .from(table)
          .delete()
          .eq('id', t.id)
          .select('id');
        if (error) {
          setErrorMessage(toUserMessage(error, 'Failed to delete transaction.'));
          return;
        }
        if (!deletedRows || deletedRows.length === 0) {
          setErrorMessage('The transaction could not be deleted. It may already be removed or you may not have permission.');
          return;
        }
        setSuccessMessage('Transaction deleted.');
        setSelectedTransaction(null);
        refreshData();
      } catch (err) {
        setErrorMessage(toUserMessage(err, 'Failed to delete transaction.'));
      } finally {
        setSubmitting(false);
      }
    },
    [confirmDialog, refreshData, setSelectedTransaction],
  );

  return {
    submitting,
    successMessage,
    setSuccessMessage,
    errorMessage,
    setErrorMessage,
    handleSubmit,
    handleReverseTransaction,
    handleDeleteTransaction,
  };
}
