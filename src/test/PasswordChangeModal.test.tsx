import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordChangeModal } from '../components/user/PasswordChangeModal';
import { turnstileMock } from './fixtures/turnstileMockState';

function renderModal(onSubmit: (token: string) => Promise<void>) {
  render(
    <PasswordChangeModal
      currentPassword="old"
      setCurrentPassword={() => {}}
      newPassword="a-long-new-password"
      setNewPassword={() => {}}
      confirmPassword="a-long-new-password"
      setConfirmPassword={() => {}}
      saving={false}
      error=""
      onClose={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return screen.getByRole('button', { name: /update password/i });
}

describe('PasswordChangeModal — security check', () => {
  it('disables submit until the security check is solved', async () => {
    turnstileMock.autoSolve = false;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const submit = renderModal(onSubmit);
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Solve security check' }));
    expect(submit).toBeEnabled();
  });

  it('passes the token to onSubmit and resets the widget afterwards', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const submit = renderModal(onSubmit);
    await user.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('test-captcha-token-1'));
    expect(turnstileMock.resets).toBe(1);
  });
});
