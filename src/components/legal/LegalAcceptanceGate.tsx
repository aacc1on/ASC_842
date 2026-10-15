import { useState } from 'react';
import { ScrollText, LogOut, RefreshCw } from 'lucide-react';
import type { PendingLegalDocs, UseLegalStatusResult } from '../../hooks/useLegalStatus';
import { LEGAL_PATHS } from '../../legal/paths';

interface LegalAcceptanceGateProps {
  gate: UseLegalStatusResult;
  onSignOut: () => void;
}

const termsLink = (
  <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium underline">Terms of Service</a>
);
const privacyLink = (
  <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium underline">Privacy Policy</a>
);

const COPY: Record<PendingLegalDocs, { heading: string; intro: string }> = {
  both: { heading: 'Review our terms', intro: 'Before you continue, please review and accept our Terms of Service and Privacy Policy.' },
  privacy: { heading: 'We updated our Privacy Policy', intro: 'Please review and accept the updated Privacy Policy to continue. Your acceptance of the Terms of Service is unchanged.' },
  terms: { heading: 'We updated our Terms of Service', intro: 'Please review and accept the updated Terms of Service to continue. Your acceptance of the Privacy Policy is unchanged.' },
};

export function LegalAcceptanceGate({ gate, onSignOut }: LegalAcceptanceGateProps) {
  const [agreed, setAgreed] = useState(false);
  const isError = gate.state === 'error';
  const copy = COPY[gate.pending];

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-gate-heading"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-8"
      >
        <div className="bg-blue-50 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
          <ScrollText className="w-6 h-6 text-blue-600" />
        </div>
        <h2 id="legal-gate-heading" className="text-2xl font-bold text-slate-900 mb-2">
          {isError ? 'Something went wrong' : copy.heading}
        </h2>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          {isError
            ? 'We could not check whether you have accepted our latest terms.'
            : copy.intro}
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
          <>
            <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer mb-5">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 leading-relaxed">
                I agree to the{' '}
                {gate.pending === 'privacy' ? <>updated {privacyLink}</>
                  : gate.pending === 'terms' ? <>updated {termsLink}</>
                  : <>{termsLink}{' '}and{' '}{privacyLink}</>}
              </span>
            </label>
            <button
              type="button"
              onClick={() => void gate.accept()}
              disabled={!agreed || gate.submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
            >
              {gate.submitting ? 'Saving...' : 'Accept'}
            </button>
          </>
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
