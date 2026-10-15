export type LegalDoc = 'terms' | 'privacy';

export const LEGAL_PATHS: Record<LegalDoc, string> = { terms: '/terms', privacy: '/privacy' };

export function legalDocForPath(pathname: string): LegalDoc | null {
  const clean = pathname.replace(/\/+$/, '');
  if (clean === LEGAL_PATHS.terms) return 'terms';
  if (clean === LEGAL_PATHS.privacy) return 'privacy';
  return null;
}
