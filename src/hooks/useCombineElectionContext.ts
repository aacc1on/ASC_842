import { supabase } from '../lib/supabase';
import { getApplicablePolicy, type PolicyElection } from '../utils/policyElections';
import { currentOrgId } from '../utils/currentOrg';
import { useAsyncData, type AsyncData } from './useAsyncData';

export interface CombineElectionContext {
  combineElectionApproved: boolean;
  combineElectionId: string | null;
  combineElections: PolicyElection[];
}

const NO_CTX: CombineElectionContext = {
  combineElectionApproved: false,
  combineElectionId: null,
  combineElections: [],
};

/**
 * Fetches the COMBINE_LEASE_NONLEASE election context for a lease form.
 * Recomputes whenever company, fixed asset type, or lease start date changes.
 */
export function useCombineElectionContext(
  companyId: string,
  fixedAssetTypeId: string,
  leaseStartDate: string,
): CombineElectionContext & Omit<AsyncData<CombineElectionContext>, 'data'> {
  const { data, ...state } = useAsyncData<CombineElectionContext>(
    companyId && fixedAssetTypeId
      ? async () => {
          const orgId = await currentOrgId();
          const elecRes = await supabase
            .from('accounting_policy_elections')
            .select('*')
            .eq('organization_id', orgId)
            .eq('company_id', companyId);
          if (elecRes.error) throw elecRes.error;

          const elections = (elecRes.data ?? []) as PolicyElection[];
          const asOfDate = leaseStartDate || new Date().toISOString().split('T')[0];

          const combinePolicy = getApplicablePolicy(
            elections,
            companyId,
            fixedAssetTypeId,
            'COMBINE_LEASE_NONLEASE',
            asOfDate,
          );

          return {
            combineElectionApproved: combinePolicy != null && combinePolicy.election_value === true,
            combineElectionId: combinePolicy?.id ?? null,
            combineElections: elections,
          };
        }
      : null,
    [companyId, fixedAssetTypeId, leaseStartDate],
    NO_CTX,
    'Failed to load the lease/non-lease component election.',
  );
  return { ...data, ...state };
}
