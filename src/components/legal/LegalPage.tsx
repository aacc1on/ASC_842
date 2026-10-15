import { FileText } from 'lucide-react';
import { SafeMarkdown } from './SafeMarkdown';
import termsSource from '../../legal/terms.md?raw';
import privacySource from '../../legal/privacy.md?raw';
import { TERMS_VERSION, PRIVACY_VERSION } from '../../legal/versions';
import { LEGAL_PATHS, type LegalDoc } from '../../legal/paths';

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <span className={className}>
      <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 hover:underline transition">Terms of Service</a>
      <span aria-hidden="true" className="mx-2">&middot;</span>
      <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 hover:underline transition">Privacy Policy</a>
    </span>
  );
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const source = doc === 'terms' ? termsSource : privacySource;
  const version = doc === 'terms' ? TERMS_VERSION : PRIVACY_VERSION;
  const other: LegalDoc = doc === 'terms' ? 'privacy' : 'terms';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <span className="bg-blue-600 p-2 rounded-xl"><FileText className="w-4 h-4 text-white" /></span>
            <span className="font-bold text-slate-900">Lease Accountant</span>
          </a>
          <a href={LEGAL_PATHS[other]} className="text-sm text-blue-600 hover:text-blue-800 font-medium transition">
            {other === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </a>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <article className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 shadow-sm">
          <SafeMarkdown source={source} />
          <p className="mt-10 pt-6 border-t border-slate-100 text-xs text-slate-500">Version {version}</p>
        </article>
      </main>
    </div>
  );
}
