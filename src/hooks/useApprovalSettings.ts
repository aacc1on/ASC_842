import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../utils/errors';
import {
  approveItem,
  fetchPendingApprovals,
  rejectItem,
  type ApprovalItemType,
  type ApprovalSettings,
  type PendingApproval,
} from '../utils/approvals';
import { currentOrgId } from '../utils/currentOrg';

export type ApprovalSettingsPatch = Partial<
  Pick<ApprovalSettings, 'enabled' | 'require_different_approver' | 'approver_role' | 'item_types'>
>;

export interface UseApprovalSettingsResult {
  settings: ApprovalSettings | null;
  pending: PendingApproval[];
  userCount: number;
  currentUserId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  clearMessages: () => void;
  updateSettings: (patch: ApprovalSettingsPatch) => Promise<boolean>;
  turnOffAndApprovePending: () => Promise<boolean>;
  approve: (type: ApprovalItemType, id: string) => Promise<boolean>;
  reject: (type: ApprovalItemType, id: string, comment: string) => Promise<boolean>;
}

export function useApprovalSettings(onPendingChange?: () => void): UseApprovalSettingsResult {
  const [settings, setSettings] = useState<ApprovalSettings | null>(null);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadPending = useCallback(async () => {
    const rows = await fetchPendingApprovals();
    setPending(rows);
    onPendingChange?.();
  }, [onPendingChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgId = await currentOrgId();
        const [{ data: auth }, settingsRes, countRes, rows] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from('approval_settings').select('*').eq('organization_id', orgId).maybeSingle(),
          supabase.from('user_profiles').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId),
          fetchPendingApprovals(),
        ]);
        if (settingsRes.error) throw settingsRes.error;
        if (countRes.error) throw countRes.error;
        if (cancelled) return;
        if (!settingsRes.data) {
          setError('Approval settings could not be found for your organization.');
          return;
        }
        setCurrentUserId(auth.user?.id ?? null);
        setSettings(settingsRes.data as ApprovalSettings);
        setUserCount(countRes.count ?? 0);
        setPending(rows);
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Failed to load approval settings.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const updateSettings = useCallback(
    async (patch: ApprovalSettingsPatch) => {
      if (!settings) return false;
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const { data, error: e } = await supabase
          .from('approval_settings')
          .update(patch)
          .eq('organization_id', settings.organization_id)
          .select('*')
          .maybeSingle();
        if (e) throw e;
        if (!data) throw new Error('Only administrators can change approval settings.');
        setSettings(data as ApprovalSettings);
        setNotice('Approval settings saved.');
        return true;
      } catch (err) {
        setError(toUserMessage(err, 'Failed to save approval settings.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  const turnOffAndApprovePending = useCallback(async () => {
    if (!settings) return false;
    const toApprove = await fetchPendingApprovals().catch(() => pending);
    const ok = await updateSettings({ enabled: false });
    if (!ok) return false;
    setSaving(true);
    const failures: string[] = [];
    for (const item of toApprove) {
      try {
        await approveItem(item.item_type, item.item_id);
      } catch (err) {
        failures.push(`${item.title}: ${toUserMessage(err, 'could not be approved')}`);
      }
    }
    setSaving(false);
    await reloadPending().catch(() => undefined);
    if (failures.length > 0) {
      setError(`Approval workflow turned off, but ${failures.length} item(s) could not be approved automatically. ${failures.join(' ')}`);
      return false;
    }
    setNotice(
      toApprove.length > 0
        ? `Approval workflow turned off. ${toApprove.length} pending item(s) were approved automatically.`
        : 'Approval workflow turned off.',
    );
    return true;
  }, [settings, pending, updateSettings, reloadPending]);

  const runItemAction = useCallback(
    async (action: () => Promise<void>, success: string, fallback: string) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        await reloadPending();
        setNotice(success);
        return true;
      } catch (err) {
        setError(toUserMessage(err, fallback));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reloadPending],
  );

  const approve = useCallback(
    (type: ApprovalItemType, id: string) =>
      runItemAction(() => approveItem(type, id), 'Item approved and now effective.', 'Failed to approve item.'),
    [runItemAction],
  );

  const reject = useCallback(
    (type: ApprovalItemType, id: string, comment: string) =>
      runItemAction(() => rejectItem(type, id, comment), 'Item returned to the preparer as a draft.', 'Failed to reject item.'),
    [runItemAction],
  );

  return {
    settings,
    pending,
    userCount,
    currentUserId,
    loading,
    saving,
    error,
    notice,
    clearMessages,
    updateSettings,
    turnOffAndApprovePending,
    approve,
    reject,
  };
}
