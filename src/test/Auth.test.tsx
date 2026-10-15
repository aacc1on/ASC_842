import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Auth } from '../components/Auth';
import { turnstileMock } from './fixtures/turnstileMockState';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

import { supabase } from '../lib/supabase';

const mockedSignIn = vi.mocked(supabase.auth.signInWithPassword);
const mockedSignUp = vi.mocked(supabase.auth.signUp);
const mockedReset = vi.mocked(supabase.auth.resetPasswordForEmail);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSignIn.mockResolvedValue({ data: {}, error: null } as never);
  mockedSignUp.mockResolvedValue({ data: { user: { id: 'u1', email: 't@t.com' } }, error: null } as never);
  mockedReset.mockResolvedValue({ data: {}, error: null } as never);
});

describe('Auth — sign in', () => {
  it('submits email and password to signInWithPassword', async () => {
    const user = userEvent.setup();
    render(<Auth />);

    await user.type(screen.getByPlaceholderText('you@company.com'), 'alice@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockedSignIn).toHaveBeenCalledWith({ email: 'alice@test.com', password: 'secret123', options: { captchaToken: 'test-captcha-token-1' } });
    });
  });

  it('shows an error message on failure', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: { message: 'Invalid credentials' } } as never);
    const user = userEvent.setup();
    render(<Auth />);

    await user.type(screen.getByPlaceholderText('you@company.com'), 'bad@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });
});

describe('Auth — sign up', () => {
  it('calls signUp with email and password', async () => {
    const user = userEvent.setup();
    render(<Auth />);

    await user.click(screen.getByText('Start free trial'));
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bob@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password1234');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledWith({ email: 'bob@test.com', password: 'password1234', options: { captchaToken: expect.stringMatching(/^test-captcha-token-/), data: { terms_accepted: true, terms_version: '2026-10-14', privacy_version: '2026-10-15' } } });
    });
  });

  it('requires the terms checkbox, unchecked by default, before Create Account is enabled', async () => {
    const user = userEvent.setup();
    render(<Auth />);

    await user.click(screen.getByText('Start free trial'));
    await user.type(screen.getByPlaceholderText('you@company.com'), 'carol@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password1234');
    const checkbox = screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ });
    const submit = screen.getByRole('button', { name: /create account/i });
    expect(checkbox).not.toBeChecked();
    expect(submit).toBeDisabled();

    await user.click(checkbox);
    expect(submit).toBeEnabled();
    await user.click(checkbox);
    expect(submit).toBeDisabled();
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('links to the Terms of Service and Privacy Policy pages', async () => {
    const user = userEvent.setup();
    render(<Auth />);
    await user.click(screen.getByText('Start free trial'));
    const terms = screen.getAllByRole('link', { name: 'Terms of Service' });
    const privacy = screen.getAllByRole('link', { name: 'Privacy Policy' });
    expect(terms.every((a) => a.getAttribute('href') === '/terms')).toBe(true);
    expect(privacy.every((a) => a.getAttribute('href') === '/privacy')).toBe(true);
  });
});

describe('Auth — forgot password', () => {
  it('calls resetPasswordForEmail with the email address', async () => {
    const user = userEvent.setup();
    render(<Auth />);

    await user.click(screen.getByText('Forgot password?'));
    await user.type(screen.getByPlaceholderText('you@company.com'), 'forgot@test.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(mockedReset).toHaveBeenCalledWith('forgot@test.com', { redirectTo: expect.any(String), captchaToken: expect.stringMatching(/^test-captcha-token-/) });
    });
  });
});

describe('Auth — security check (Turnstile)', () => {
  it('shows an accessible security check on every auth form', async () => {
    const user = userEvent.setup();
    render(<Auth />);
    expect(screen.getByRole('group', { name: 'Security check' })).toBeInTheDocument();
    await user.click(screen.getByText('Start free trial'));
    expect(screen.getByRole('group', { name: 'Security check' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await user.click(screen.getByText('Forgot password?'));
    expect(screen.getByRole('group', { name: 'Security check' })).toBeInTheDocument();
  });

  it('keeps sign-in disabled until the security check is solved', async () => {
    turnstileMock.autoSolve = false;
    const user = userEvent.setup();
    render(<Auth />);
    await user.type(screen.getByPlaceholderText('you@company.com'), 'alice@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret123');
    const submit = screen.getByRole('button', { name: /^sign in$/i });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mockedSignIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Solve security check' }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledTimes(1));
  });

  it('keeps sign-up and reset-link submit disabled without a token', async () => {
    turnstileMock.autoSolve = false;
    const user = userEvent.setup();
    render(<Auth />);
    await user.click(screen.getByText('Start free trial'));
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await user.click(screen.getByText('Forgot password?'));
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeDisabled();
  });

  it('resets the widget after a failed attempt and requires a new token', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: { message: 'Invalid credentials' } } as never);
    const user = userEvent.setup();
    render(<Auth />);
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bad@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await screen.findByText('Invalid credentials');
    expect(turnstileMock.resets).toBe(1);

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledTimes(2));
    const tokens = mockedSignIn.mock.calls.map((c) => (c[0] as { options: { captchaToken: string } }).options.captchaToken);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('requires solving again when a reset leaves no token', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: { message: 'Invalid credentials' } } as never);
    const user = userEvent.setup();
    render(<Auth />);
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bad@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrongpass');
    turnstileMock.autoSolve = false;
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await screen.findByText('Invalid credentials');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('maps a Supabase captcha error to the security-check message', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: { message: 'captcha protection: request disallowed (timeout-or-duplicate)' } } as never);
    const user = userEvent.setup();
    render(<Auth />);
    await user.type(screen.getByPlaceholderText('you@company.com'), 'a@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Please complete the security check and try again.')).toBeInTheDocument();
  });

  it('resets the widget after a sign-up error', async () => {
    mockedSignUp.mockResolvedValue({ data: {}, error: { message: 'captcha verification process failed' } } as never);
    const user = userEvent.setup();
    render(<Auth />);
    await user.click(screen.getByText('Start free trial'));
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bob@test.com');
    await user.type(screen.getByPlaceholderText('Min. 12 characters'), 'password1234');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms of Service/ }));
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Please complete the security check and try again.')).toBeInTheDocument();
    expect(turnstileMock.resets).toBe(1);
  });
});
