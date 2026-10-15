import type { Lease, FixedAssetType } from '../types/lease';
import type { LeaseFormData, PaymentTrancheRow, ClassificationResult } from '../components/lease-form/types';
import type { ClassificationCheck } from '../components/lease-form/leaseFormCalculations';
import type { DiscountRateContext } from '../utils/discountRate';
import type { ShortTermElectionContext } from './useShortTermElectionContext';
import type { CombineElectionContext } from './useCombineElectionContext';

export interface BranchOption {
  id: string;
  branch_name: string;
  branch_code: string | null;
}

export interface UseLeaseFormActionsArgs {
  lease?: Lease;
  userId: string;
  formCompanyId: string;
  formData: LeaseFormData;
  setFormData: React.Dispatch<React.SetStateAction<LeaseFormData>>;
  useVariablePayments: boolean;
  setUseVariablePayments: React.Dispatch<React.SetStateAction<boolean>>;
  paymentTranches: PaymentTrancheRow[];
  setPaymentTranches: React.Dispatch<React.SetStateAction<PaymentTrancheRow[]>>;
  classificationResult: ClassificationResult | null;
  setClassificationResult: React.Dispatch<React.SetStateAction<ClassificationResult | null>>;
  setShowClassificationWizard: React.Dispatch<React.SetStateAction<boolean>>;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  leaseNameError: string;
  setLeaseNameError: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  branches: BranchOption[];
  setBranches: React.Dispatch<React.SetStateAction<BranchOption[]>>;
  fixedAssetTypes: FixedAssetType[];
  setFixedAssetTypes: React.Dispatch<React.SetStateAction<FixedAssetType[]>>;
  newBranchName: string;
  setNewBranchName: (v: string) => void;
  newBranchCode: string;
  setNewBranchCode: (v: string) => void;
  setShowNewBranchForm: (v: boolean) => void;
  newAssetTypeName: string;
  setNewAssetTypeName: (v: string) => void;
  newAssetTypeCode: string;
  setNewAssetTypeCode: (v: string) => void;
  setShowNewAssetTypeForm: (v: boolean) => void;
  onSuccess: () => void;
  discountRateCtx: DiscountRateContext;
  shortTermCtx: ShortTermElectionContext;
  combineCtx: CombineElectionContext;
  postedThrough?: string | null;
}

export interface UseLeaseFormActionsResult {
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleCreateBranch: () => Promise<void>;
  handleCreateFixedAssetType: () => Promise<void>;
  runClassificationWizard: () => void;
  classifyCurrent: () => ClassificationCheck;
  loadExistingPaymentSchedule: (leaseId: string) => Promise<void>;
}
