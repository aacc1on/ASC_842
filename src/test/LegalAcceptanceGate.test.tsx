import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '../lib/supabase';
import { useLegalStatus } from '../hooks/useLegalStatus';
import { LegalAcceptanceGate } from '../components/legal/LegalAcceptanceGate';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

const rpc = vi.mocked(supabase.rpc);

function status(accepted: boolean, prior: boolean, terms = accepted, privacy = accepted) {
  return { accepted, has_prior_acceptance: prior, terms_accepted: terms, privacy_accepted: privacy, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };
}

function Harness({ onSignOut = () => {} }: { onSignOut?: () => void }) {
  const gate = useLegalStatus('user-1');
  if (gate.state === 'required' || gate.state === 'error') return <LegalAcceptanceGate gate={gate} onSignOut={onSignOut} />;
  if (gate.state === 'pass') return <p>App content</p>;
  return <p>Loading</p>;
}

function mockRpc(initial: ReturnType<typeof status>, afterAccept: unknown = status(true, true), acceptError: unknown = null) {
  rpc.mockImplementation(((name: string) => {
    if (name === 'my_legal_status') return Promise.resolve({ data: initial, error: null });
    if (name === 'accept_legal_documents') return Promise.resolve({ data: acceptError ? null : afterAccept, error: acceptError });
    return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Legal acceptance gate', () => {
  it('lets the user straight in when the current versions are already accepted', async () => {
    mockRpc(status(true, true));
    render(<Harness />);
    expect(await screen.findByText('App content')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a blocking dialog when status is false and removes it after accepting', async () => {
    mockRpc(status(false, false));
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole('dialog', { name: 'Review our terms' });
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');

    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(accept).toBeEnabled();
    await user.click(accept);

    expect(await screen.findByText('App content')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("records 'invite' for a user who never accepted anything", async () => {
    mockRpc(status(false, false));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('accept_legal_documents', expect.objectContaining({
        p_terms_version: TERMS_VERSION,
        p_privacy_version: PRIVACY_VERSION,
        p_source: 'invite',
      }));
    });
  });

  it("records 'reaccept' for a user who accepted an older version", async () => {
    mockRpc(status(false, true));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('accept_legal_documents', expect.objectContaining({ p_source: 'reaccept' }));
    });
  });

  it('asks only for the updated Privacy Policy when the current Terms are already accepted', async () => {
    mockRpc(status(false, true, true, false));
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole('dialog', { name: 'We updated our Privacy Policy' });
    expect(dialog).toHaveTextContent('Your acceptance of the Terms of Service is unchanged.');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.queryByRole('link', { name: 'Terms of Service' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('accept_legal_documents', expect.objectContaining({
        p_terms_version: '2026-10-14',
        p_privacy_version: '2026-10-15',
        p_source: 'reaccept',
      }));
    });
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('asks for both documents when both changed since the last acceptance', async () => {
    mockRpc(status(false, true, false, false));
    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'Review our terms' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the server message when the versions are stale', async () => {
    mockRpc(status(false, true), null, { message: 'These terms have been updated. Please reload the page and review the latest version.', code: 'P0001' });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('These terms have been updated');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the reload message (not the generic range message) for the real check_violation stale-version error', async () => {
    mockRpc(status(false, true), null, { message: 'These terms have been updated. Please reload the page and review the latest version.', code: '23514' });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please reload the page');
    expect(alert).not.toHaveTextContent('outside the allowed range');
  });

  it('offers Sign out from the dialog', async () => {
    mockRpc(status(false, false));
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSignOut={onSignOut} />);
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
