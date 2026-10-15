import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManagementTab } from '../components/user/ManagementTab';
import type { UserCapacity } from '../hooks/useUserCapacity';
import { edgeFunctionError } from '../utils/edgeFunctionError';
import { toUserMessage } from '../utils/errors';
import { plans } from '../components/landingPlans';

const LIMIT_MESSAGE = 'Your plan allows up to 10 users. Remove a user or contact us to add more.';

function renderTab(capacity: UserCapacity | null, onAddUserClick = vi.fn()) {
  render(
    <ManagementTab
      profile={{ user_id: 'u1', email: 'admin@test.com', full_name: 'Admin', role: 'admin' } as never}
      managedUsers={[]}
      filteredManagedUsers={[]}
      managementLoading={false}
      managementSearch=""
      setManagementSearch={vi.fn()}
      onAddUserClick={onAddUserClick}
      onEditUserClick={vi.fn()}
      onDeleteUserClick={vi.fn()}
      onRoleSelect={vi.fn()}
      planKey="enterprise"
      capacity={capacity}
    />,
  );
  return screen.getByRole('button', { name: /add user/i });
}

describe('User limit on the user management screen', () => {
  it('shows "X of 10 users" and keeps Add User enabled below the limit', () => {
    const button = renderTab({ used: 9, max: 10, over: false });
    expect(screen.getByText('9 of 10 users')).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(screen.queryByText(LIMIT_MESSAGE)).not.toBeInTheDocument();
  });

  it('disables Add User at the limit and explains why', () => {
    const button = renderTab({ used: 10, max: 10, over: false });
    expect(screen.getByText('10 of 10 users')).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(screen.getByText(LIMIT_MESSAGE)).toBeInTheDocument();
  });

  it('uses the singular for single-user plans', () => {
    renderTab({ used: 1, max: 1, over: false });
    expect(screen.getByText('1 of 1 user')).toBeInTheDocument();
  });

  it('warns organizations already over their limit after a downgrade', () => {
    const button = renderTab({ used: 3, max: 1, over: true });
    expect(button).toBeDisabled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your organization has 3 users but your plan allows up to 1');
    expect(alert).toHaveTextContent('Existing users keep their access');
    expect(alert).toHaveTextContent('remove 2 users');
  });

  it('leaves Add User available when the limit could not be loaded (the server still enforces it)', () => {
    const button = renderTab(null);
    expect(button).toBeEnabled();
    expect(screen.queryByText(/of \d+ users?$/)).not.toBeInTheDocument();
  });
});

describe('User limit error messages', () => {
  it('shows the server message when adding a user is rejected for the limit', () => {
    const err = edgeFunctionError(
      { status: 403 },
      { error: LIMIT_MESSAGE, code: 'USER_LIMIT', used: 10, max: 10 },
      'Failed to create user. Please try again.',
      { PLAN_RESTRICTED: 'Adding users requires the Enterprise plan. Please upgrade to add team members.' },
    );
    expect(err.message).toBe(LIMIT_MESSAGE);
  });

  it('passes the database limit message through the general error mapper', () => {
    expect(toUserMessage({ message: LIMIT_MESSAGE, code: '23514' }, 'Something went wrong')).toBe(LIMIT_MESSAGE);
  });
});

describe('Enterprise pricing copy', () => {
  it('advertises up to 10 users', () => {
    const enterprise = plans.find((p) => p.key === 'enterprise');
    expect(enterprise?.features).toContain('Up to 10 users');
    expect(enterprise?.features).not.toContain('Multi-user & team roles');
  });
});
