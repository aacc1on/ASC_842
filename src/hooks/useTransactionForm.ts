import { useCallback, useState } from 'react';
import type { Transaction, TransactionFormData } from '../components/transactions/types';

const EMPTY_FORM: TransactionFormData = {
  lease_id: '',
  transaction_date: new Date().toISOString().split('T')[0],
  transaction_type: 'payment',
  account_debited: '',
  account_credited: '',
  debit_amount: '',
  credit_amount: '',
  description: '',
  reference_number: '',
  period: '',
};

interface UseTransactionFormResult {
  showAddModal: boolean;
  setShowAddModal: (v: boolean) => void;
  selectedTransaction: Transaction | null;
  setSelectedTransaction: (t: Transaction | null) => void;
  formData: TransactionFormData;
  setFormData: React.Dispatch<React.SetStateAction<TransactionFormData>>;
  resetForm: () => void;
}

export function useTransactionForm(): UseTransactionFormResult {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [formData, setFormData] = useState<TransactionFormData>(EMPTY_FORM);

  const resetForm = useCallback(() => {
    setFormData({
      ...EMPTY_FORM,
      transaction_date: new Date().toISOString().split('T')[0],
    });
  }, []);

  return {
    showAddModal,
    setShowAddModal,
    selectedTransaction,
    setSelectedTransaction,
    formData,
    setFormData,
    resetForm,
  };
}
