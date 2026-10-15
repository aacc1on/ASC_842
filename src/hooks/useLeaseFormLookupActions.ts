import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { FixedAssetType } from '../types/lease';
import { getErrorMessage } from '../utils/errors';
import type { BranchOption, UseLeaseFormActionsArgs } from './leaseFormActionTypes';

type LookupArgs = Pick<UseLeaseFormActionsArgs,
  | 'userId' | 'formCompanyId' | 'setFormData' | 'setError' | 'setLoading' | 'setBranches' | 'setFixedAssetTypes'
  | 'newBranchName' | 'setNewBranchName' | 'newBranchCode' | 'setNewBranchCode' | 'setShowNewBranchForm'
  | 'newAssetTypeName' | 'setNewAssetTypeName' | 'newAssetTypeCode' | 'setNewAssetTypeCode' | 'setShowNewAssetTypeForm'>;

/** Inline creation of branches and fixed asset types from the lease form. */
export function useLeaseFormLookupActions({
  userId,
  formCompanyId,
  setFormData,
  setError,
  setLoading,
  setBranches,
  setFixedAssetTypes,
  newBranchName,
  setNewBranchName,
  newBranchCode,
  setNewBranchCode,
  setShowNewBranchForm,
  newAssetTypeName,
  setNewAssetTypeName,
  newAssetTypeCode,
  setNewAssetTypeCode,
  setShowNewAssetTypeForm,
}: LookupArgs) {
  const handleCreateBranch = useCallback(async () => {
    if (!formCompanyId) {
      setError('Please select a company before adding a branch.');
      return;
    }
    if (!newBranchName.trim()) {
      setError('Branch name is required.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const { data, error: insertError } = await supabase
        .from('branches')
        .insert({
          user_id: userId,
          branch_name: newBranchName.trim(),
          branch_code: newBranchCode.trim(),
          is_active: true,
        })
        .select('id, branch_name, branch_code')
        .single();

      if (insertError) throw insertError;

      const created = data as BranchOption;
      setBranches((prev) => [...prev, created].sort((a, b) => a.branch_name.localeCompare(b.branch_name)));
      setFormData((prev) => ({ ...prev, branch_id: created.id }));
      setNewBranchName('');
      setNewBranchCode('');
      setShowNewBranchForm(false);
    } catch (err) {
      setError(getErrorMessage(err) || 'Failed to create branch.');
    } finally {
      setLoading(false);
    }
  }, [
    newBranchName,
    newBranchCode,
    formCompanyId,
    setError,
    setLoading,
    setBranches,
    setFormData,
    setNewBranchName,
    setNewBranchCode,
    setShowNewBranchForm,
    userId,
  ]);

  const handleCreateFixedAssetType = useCallback(async () => {
    if (!formCompanyId) {
      setError('Please select a company before adding an asset type.');
      return;
    }
    if (!newAssetTypeName.trim()) {
      setError('Asset type name is required.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const { data, error: insertError } = await supabase
        .from('fixed_asset_types')
        .insert({
          user_id: userId,
          type_name: newAssetTypeName.trim(),
          type_code: newAssetTypeCode.trim(),
          is_active: true,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      const created = data as FixedAssetType;
      setFixedAssetTypes((prev) =>
        [...prev, created].sort((a, b) => a.type_name.localeCompare(b.type_name))
      );
      setFormData((prev) => ({ ...prev, fixed_asset_type_id: created.id }));
      setNewAssetTypeName('');
      setNewAssetTypeCode('');
      setShowNewAssetTypeForm(false);
    } catch (err) {
      setError(getErrorMessage(err) || 'Failed to create asset type.');
    } finally {
      setLoading(false);
    }
  }, [
    newAssetTypeName,
    newAssetTypeCode,
    formCompanyId,
    setError,
    setLoading,
    setFixedAssetTypes,
    setFormData,
    setNewAssetTypeName,
    setNewAssetTypeCode,
    setShowNewAssetTypeForm,
    userId,
  ]);

  return { handleCreateBranch, handleCreateFixedAssetType };
}
