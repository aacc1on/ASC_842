import { useState } from 'react';
import { ShieldCheck, RefreshCw, LogOut } from 'lucide-react';
import type { UseMfaGateResult } from '../hooks/useMfaGate';

interface MfaChallengeProps {
  gate: UseMfaGateResult;
  onSignOut: () => void;
}

export function MfaChallenge({ gate, onSignOut }: MfaChallengeProps) {
  const [code, setCode] = useState('');
  const isError = gate.state === 'error';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6) void gate.verify(code);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <div className="bg-blue-50 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
          <ShieldCheck className="w-6 h-6 text-blue-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Two-step verification</h2>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          {isError
            ? 'We could not check your sign-in security settings.'
            : 'Enter the 6-digit code from your authenticator app to finish signing in.'}
        </p>

        {gate.error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {gate.error}
          </div>
        )}

        {isError ? (
          <button
            type="button"
            onClick={gate.retry}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700" htmlFor="mfa-code">Verification code</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900"
              placeholder="000000"
              autoFocus
            />
            <button
              type="submit"
              disabled={code.length !== 6 || gate.verifying}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
            >
              {gate.verifying ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onSignOut}
          className="mt-6 w-full flex items-center justify-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
