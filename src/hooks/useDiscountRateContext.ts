import { supabase } from '../lib/supabase';
import {
  NO_DISCOUNT_RATE_CONTEXT,
  type DiscountRateContext,
} from '../utils/discountRate';
import {
  isRiskFreeRateEligible,
  getApplicablePolicy,
  type PolicyElection,
  type EntityType,
} from '../utils/policyElections';
import { currentOrgId } from '../utils/currentOrg';
import { useAsyncData, type AsyncData } from './useAsyncData';

/**
 * Fetches the risk-free rate election context for a lease form.
 * Recomputes whenever company, fixed asset type, or lease start date changes.
 * Returns NO_DISCOUNT_RATE_CONTEXT when company or asset type is not selected.
 */
export function useDiscountRateContext(
  companyId: string,
  fixedAssetTypeId: string,
  leaseStartDate: string,
): DiscountRateContext & Omit<AsyncData<DiscountRateContext>, 'data'> {
  const { data, ...state } = useAsyncData<DiscountRateContext>(
    companyId && fixedAssetTypeId
      ? async () => {
          const orgId = await currentOrgId();
          const [elecRes, compRes] = await Promise.all([
            supabase.from('accounting_policy_elections').select('*').eq('organization_id', orgId).eq('company_id', companyId),
            supabase.from('companies').select('entity_type').eq('organization_id', orgId).eq('id', companyId).maybeSingle(),
          ]);
          if (elecRes.error) throw elecRes.error;
          if (compRes.error) throw compRes.error;

          const elections = (elecRes.data ?? []) as PolicyElection[];
          const entityType = (compRes.data as { entity_type: EntityType | null } | null)?.entity_type ?? null;
          const asOfDate = leaseStartDate || new Date().toISOString().split('T')[0];
          const eligible = isRiskFreeRateEligible(entityType);

          const rfrPolicy = getApplicablePolicy(
            elections,
            companyId,
            fixedAssetTypeId,
            'RISK_FREE_RATE',
            asOfDate,
          );

          return {
            riskFreeElectionApproved: rfrPolicy != null && rfrPolicy.election_value === true,
            entityEligibleForRiskFree: eligible,
            riskFreePolicyElectionId: rfrPolicy?.id ?? null,
          };
        }
      : null,
    [companyId, fixedAssetTypeId, leaseStartDate],
    NO_DISCOUNT_RATE_CONTEXT,
    'Failed to load the discount rate election.',
  );
  return { ...data, ...state };
}
