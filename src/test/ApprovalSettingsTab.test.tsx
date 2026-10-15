import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApprovalSettingsTab } from '../components/ApprovalSettingsTab';
import type { UseApprovalSettingsResult } from '../hooks/useApprovalSettings';
import type { ApprovalSettings, PendingApproval } from '../utils/approvals';

const hookState: { current: UseApprovalSettingsResult } = { current: null as unknown as UseApprovalSettingsResult };

vi.mock('../hooks/useApprovalSettings', () => ({
  useApprovalSettings: () => hookState.current,
}));

const baseSettings: ApprovalSettings = {
  organization_id: 'org1',
  enabled: false,
  require_different_approver: false,
  approver_role: 'admin',
  item_types: ['policy_election', 'contract_modification', 'contract_cancellation', 'impairment', 'month_end'],
  updated_at: '2026-01-01T00:00:00Z',
};

const pendingItem: PendingApproval = {
  item_type: 'policy_election',
  item_id: 'e1',
  title: 'Vehicle - Risk-Free Rate v2',
  summary: 'Elected',
  amount: null,
  prepared_by: 'u2',
  prepared_by_name: 'Jane Preparer',
  prepared_at: '2026-01-10T00:00:00Z',
};

function makeHook(overrides: Partial<UseApprovalSettingsResult> = {}): UseApprovalSettingsResult {
  return {
    settings: baseSettings,
    pending: [],
    userCount: 2,
    currentUserId: 'u1',
    loading: false,
    saving: false,
    error: null,
    notice: null,
    clearMessages: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(true),
    turnOffAndApprovePending: vi.fn().mockResolvedValue(true),
    approve: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderTab(role: 'admin' | 'manage' = 'admin') {
  return render(
    <MemoryRouter initialEntries={['/settings/approval']}>
      <ApprovalSettingsTab userRole={role} />
    </MemoryRouter>,
  );
}

describe('ApprovalSettingsTab', () => {
  beforeEach(() => {
    hookState.current = makeHook();
  });

  it('shows explanation, tabs and the enable switch (off by default, no options)', () => {
    renderTab();
    expect(screen.getByText('Approval workflow')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Accounting Policies/ })).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Enable approval workflow' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Items that need approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending approvals')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('turning the workflow on saves enabled=true', () => {
    renderTab();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable approval workflow' }));
    expect(hookState.current.updateSettings).toHaveBeenCalledWith({ enabled: true });
  });

  it('when on, shows item types, approver role and different-approver switch', () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true } });
    renderTab();
    for (const label of ['Accounting policy elections', 'Contract modifications', 'Cancellations', 'Impairments', 'Month-end finalization']) {
      expect(screen.getByLabelText(new RegExp(label))).toBeChecked();
    }
    fireEvent.click(screen.getByLabelText(/Impairments/));
    expect(hookState.current.updateSettings).toHaveBeenCalledWith({
      item_types: ['policy_election', 'contract_modification', 'contract_cancellation', 'month_end'],
    });
    fireEvent.click(screen.getByLabelText('Admins and Managers'));
    expect(hookState.current.updateSettings).toHaveBeenCalledWith({ approver_role: 'manage' });
    fireEvent.click(screen.getByRole('switch', { name: /different person/ }));
    expect(hookState.current.updateSettings).toHaveBeenCalledWith({ require_different_approver: true });
  });

  it('disables the different-approver switch with a single user', () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true }, userCount: 1 });
    renderTab();
    expect(screen.getByRole('switch', { name: /different person/ })).toBeDisabled();
    expect(screen.getByText(/at least two users/)).toBeInTheDocument();
  });

  it('is read-only for non-admins', () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true } });
    renderTab('manage');
    expect(screen.getByRole('switch', { name: 'Enable approval workflow' })).toBeDisabled();
    expect(screen.getByLabelText(/Impairments/)).toBeDisabled();
    expect(screen.getByText(/Only administrators can change/)).toBeInTheDocument();
  });

  it('lists pending items and approves', () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true }, pending: [pendingItem] });
    renderTab();
    expect(screen.getByText('Vehicle - Risk-Free Rate v2')).toBeInTheDocument();
    expect(screen.getByText('Jane Preparer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(hookState.current.approve).toHaveBeenCalledWith('policy_election', 'e1');
  });

  it('reject requires a comment', async () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true }, pending: [pendingItem] });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /^Reject$/ }));
    const dialog = screen.getByRole('dialog');
    const confirm = dialog.querySelector('button.bg-red-600') as HTMLButtonElement;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Comment/), { target: { value: 'Wrong date' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(hookState.current.reject).toHaveBeenCalledWith('policy_election', 'e1', 'Wrong date'));
  });

  it('turning off with pending items asks for confirmation, then auto-approves', async () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true }, pending: [pendingItem, { ...pendingItem, item_id: 'e2' }] });
    renderTab();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable approval workflow' }));
    expect(hookState.current.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText('2 items are pending. Turn off and approve them automatically?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off and approve' }));
    await waitFor(() => expect(hookState.current.turnOffAndApprovePending).toHaveBeenCalled());
  });

  it('turning off with nothing pending just saves', () => {
    hookState.current = makeHook({ settings: { ...baseSettings, enabled: true } });
    renderTab();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable approval workflow' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hookState.current.updateSettings).toHaveBeenCalledWith({ enabled: false });
  });
});
