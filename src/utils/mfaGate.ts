export type AalLevel = 'aal1' | 'aal2' | (string & {}) | null;

export interface AssuranceLevel {
  currentLevel: AalLevel;
  nextLevel: AalLevel;
}

export interface FactorSummary {
  id: string;
  status: string;
}

export type MfaGateDecision = { status: 'pass' } | { status: 'challenge'; factorId: string };

/** AAL2 is only required when the user has a verified factor; users without one are never blocked. */
export function decideMfaGate(aal: AssuranceLevel | null, factors: FactorSummary[]): MfaGateDecision {
  const verified = factors.find((f) => f.status === 'verified');
  if (!verified) return { status: 'pass' };
  if (aal?.currentLevel === 'aal2') return { status: 'pass' };
  return { status: 'challenge', factorId: verified.id };
}

interface MfaApi {
  getAuthenticatorAssuranceLevel: () => Promise<{ data: AssuranceLevel | null; error: unknown }>;
  listFactors: () => Promise<{ data: { totp?: FactorSummary[] } | null; error: unknown }>;
}

export async function checkMfaGate(mfa: MfaApi): Promise<MfaGateDecision> {
  const [aalRes, factorsRes] = await Promise.all([mfa.getAuthenticatorAssuranceLevel(), mfa.listFactors()]);
  if (aalRes.error) throw aalRes.error;
  if (factorsRes.error) throw factorsRes.error;
  return decideMfaGate(aalRes.data, factorsRes.data?.totp ?? []);
}
