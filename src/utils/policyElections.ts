// ASC 842 Accounting Policy Elections — pure logic (no Supabase calls)

export const POLICY_TYPES = ['SHORT_TERM_LEASE', 'COMBINE_LEASE_NONLEASE', 'RISK_FREE_RATE'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export type ElectionStatus = 'draft' | 'pending_approval' | 'approved' | 'inactive';
export type EntityType = 'public_business_entity' | 'non_public_business_entity' | 'not_for_profit_other';

// To be confirmed by CPA
export const ASC_POLICY_REFERENCES: Record<PolicyType, string> = {
  SHORT_TERM_LEASE: '842-20-50-8',
  COMBINE_LEASE_NONLEASE: '842-20-50-9',
  RISK_FREE_RATE: '842-20-50-10',
};

export interface PolicyElection {
  id: string;
  company_id: string;
  fixed_asset_type_id: string;
  policy_type: PolicyType;
  election_value: boolean;
  effective_from: string;
  effective_to: string | null;
  status: ElectionStatus;
  policy_version: number;
  notes: string | null;
  change_reason: string | null;
  prepared_by: string | null;
  approved_by: string | null;
  self_approved?: boolean;
  approved_at?: string | null;
  rejection_comment?: string | null;
}

export interface AssetTypeInfo {
  id: string;
  type_name: string;
  is_active: boolean;
}

export type CoverageResult = 'elected' | 'not_elected' | 'not_configured' | 'pending' | 'not_eligible';

export interface PolicyCoverageEntry {
  assetTypeId: string;
  assetTypeName: string;
  policyType: PolicyType;
  result: CoverageResult;
  electionValue: boolean | null;
  version: number | null;
  effectiveFrom: string | null;
}

/**
 * Returns the approved policy election effective on the given date, or null.
 * Elections with effective_to are checked for date range; those without
 * effective_to are considered ongoing from effective_from.
 */
export function getApplicablePolicy(
  elections: PolicyElection[],
  companyId: string,
  fixedAssetTypeId: string,
  policyType: PolicyType,
  asOfDate: string
): PolicyElection | null {
  const candidates = elections.filter(
    (e) =>
      e.company_id === companyId &&
      e.fixed_asset_type_id === fixedAssetTypeId &&
      e.policy_type === policyType &&
      e.status === 'approved' &&
      e.effective_from <= asOfDate &&
      (e.effective_to === null || e.effective_to >= asOfDate)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.policy_version - a.policy_version);
  return candidates[0];
}

/**
 * Check whether a company entity type is eligible for the risk-free rate election.
 * Public business entities (and null/unset) are NOT eligible.
 */
export function isRiskFreeRateEligible(entityType: EntityType | null): boolean {
  return entityType === 'non_public_business_entity' || entityType === 'not_for_profit_other';
}

/**
 * Returns per asset class and policy type the coverage status.
 */
export function getPolicyCoverage(
  assetTypes: AssetTypeInfo[],
  elections: PolicyElection[],
  asOfDate: string,
  companyId: string,
  entityType: EntityType | null
): PolicyCoverageEntry[] {
  const results: PolicyCoverageEntry[] = [];
  const activeTypes = assetTypes.filter((a) => a.is_active);

  for (const asset of activeTypes) {
    for (const pt of POLICY_TYPES) {
      if (pt === 'RISK_FREE_RATE' && !isRiskFreeRateEligible(entityType)) {
        results.push({
          assetTypeId: asset.id,
          assetTypeName: asset.type_name,
          policyType: pt,
          result: 'not_eligible',
          electionValue: null,
          version: null,
          effectiveFrom: null,
        });
        continue;
      }

      const approved = getApplicablePolicy(elections, companyId, asset.id, pt, asOfDate);
      if (approved) {
        results.push({
          assetTypeId: asset.id,
          assetTypeName: asset.type_name,
          policyType: pt,
          result: 'elected',
          electionValue: approved.election_value,
          version: approved.policy_version,
          effectiveFrom: approved.effective_from,
        });
      } else {
        // Check if there's any non-approved election (draft or pending)
        const anyElection = elections.find(
          (e) =>
            e.company_id === companyId &&
            e.fixed_asset_type_id === asset.id &&
            e.policy_type === pt &&
            (e.status === 'draft' || e.status === 'pending_approval')
        );
        if (anyElection) {
          results.push({
            assetTypeId: asset.id,
            assetTypeName: asset.type_name,
            policyType: pt,
            result: 'pending',
            electionValue: anyElection.election_value,
            version: anyElection.policy_version,
            effectiveFrom: anyElection.effective_from,
          });
        } else {
          results.push({
            assetTypeId: asset.id,
            assetTypeName: asset.type_name,
            policyType: pt,
            result: 'not_configured',
            electionValue: null,
            version: null,
            effectiveFrom: null,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Generates three disclosure narrative paragraphs from data only.
 * No hard-coded asset classes — iterates over the provided coverage entries.
 */
export function generateDisclosureNarrative(
  coverage: PolicyCoverageEntry[],
  entityType: EntityType | null
): string[] {
  const entityLabel: Record<EntityType, string> = {
    public_business_entity: 'a public business entity',
    non_public_business_entity: 'a non-public business entity',
    not_for_profit_other: 'a not-for-profit entity',
  };
  const entityDesc = entityType ? entityLabel[entityType] : 'an entity whose classification has not been determined';

  // Short-term lease narrative
  const stlEntries = coverage.filter((c) => c.policyType === 'SHORT_TERM_LEASE' && c.result !== 'not_eligible');
  const stlElected = stlEntries.filter((c) => c.result === 'elected' && c.electionValue === true);
  const stlNotElected = stlEntries.filter((c) => c.result === 'elected' && c.electionValue === false);
  const stlMissing = stlEntries.filter((c) => c.result === 'not_configured' || c.result === 'pending');

  const stlPara = [
    `The entity, as ${entityDesc}, has made the following accounting policy elections regarding short-term leases (ASC ${ASC_POLICY_REFERENCES.SHORT_TERM_LEASE}):`,
    stlElected.length > 0
      ? `The entity has elected to apply the short-term lease recognition exemption for the following classes of underlying assets: ${stlElected.map((e) => e.assetTypeName).join(', ')}.`
      : 'The entity has not elected to apply the short-term lease recognition exemption for any class of underlying assets.',
    stlNotElected.length > 0
      ? `The entity has elected not to apply the short-term lease recognition exemption for the following classes of underlying assets: ${stlNotElected.map((e) => e.assetTypeName).join(', ')}.`
      : '',
    stlMissing.length > 0
      ? `Accounting policy elections have not been configured for the following classes of underlying assets: ${stlMissing.map((e) => e.assetTypeName).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  // Combine lease and nonlease components narrative
  const combineEntries = coverage.filter((c) => c.policyType === 'COMBINE_LEASE_NONLEASE' && c.result !== 'not_eligible');
  const combineElected = combineEntries.filter((c) => c.result === 'elected' && c.electionValue === true);
  const combineNotElected = combineEntries.filter((c) => c.result === 'elected' && c.electionValue === false);
  const combineMissing = combineEntries.filter((c) => c.result === 'not_configured' || c.result === 'pending');

  const combinePara = [
    `Regarding the combination of lease and nonlease components (ASC ${ASC_POLICY_REFERENCES.COMBINE_LEASE_NONLEASE}):`,
    combineElected.length > 0
      ? `The entity has elected to combine lease and nonlease components for the following classes of underlying assets: ${combineElected.map((e) => e.assetTypeName).join(', ')}.`
      : 'The entity has not elected to combine lease and nonlease components for any class of underlying assets.',
    combineNotElected.length > 0
      ? `The entity has elected to account for lease and nonlease components separately for the following classes of underlying assets: ${combineNotElected.map((e) => e.assetTypeName).join(', ')}.`
      : '',
    combineMissing.length > 0
      ? `Elections regarding the combination of lease and nonlease components have not been configured for the following classes of underlying assets: ${combineMissing.map((e) => e.assetTypeName).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  // Risk-free rate narrative
  const rfrEntries = coverage.filter((c) => c.policyType === 'RISK_FREE_RATE');
  const rfrNotEligible = rfrEntries.filter((c) => c.result === 'not_eligible');
  const rfrElected = rfrEntries.filter((c) => c.result === 'elected' && c.electionValue === true);
  const rfrNotElected = rfrEntries.filter((c) => c.result === 'elected' && c.electionValue === false);
  const rfrMissing = rfrEntries.filter((c) => c.result === 'not_configured' || c.result === 'pending');

  const rfrPara = [
    `Regarding the risk-free rate election (ASC ${ASC_POLICY_REFERENCES.RISK_FREE_RATE}):`,
    rfrNotEligible.length > 0
      ? `As ${entityDesc}, the entity is not eligible to make the risk-free rate election.`
      : rfrElected.length > 0
        ? `The entity has elected to use the risk-free rate as the discount rate for the following classes of underlying assets: ${rfrElected.map((e) => e.assetTypeName).join(', ')}.`
        : 'The entity has not elected to use the risk-free rate as the discount rate for any class of underlying assets.',
    rfrNotElected.length > 0
      ? `The entity has elected not to use the risk-free rate for the following classes of underlying assets: ${rfrNotElected.map((e) => e.assetTypeName).join(', ')}.`
      : '',
    rfrMissing.length > 0 && rfrNotEligible.length === 0
      ? `The risk-free rate election has not been configured for the following classes of underlying assets: ${rfrMissing.map((e) => e.assetTypeName).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  return [stlPara, combinePara, rfrPara];
}

/**
 * Returns true if every active asset class has an approved decision for all eligible policy types.
 */
export function isFullyConfigured(coverage: PolicyCoverageEntry[]): boolean {
  return coverage.every((c) => c.result === 'elected' || c.result === 'not_eligible');
}
