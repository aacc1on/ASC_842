import { supabase } from '../lib/supabase';
import { getApplicablePolicy, type PolicyElection } from '../utils/policyElections';
import { currentOrgId } from '../utils/currentOrg';
import { useAsyncData, type AsyncData } from './useAsyncData';

export interface ShortTermElectionContext {
  shortTermElectionApproved: boolean;
  shortTermElectionId: string | null;
  shortTermElections: PolicyElection[];
}

const NO_CTX: ShortTermElectionContext = {
  shortTermElectionApproved: false,
  shortTermElectionId: null,
  shortTermElections: [],
};

/**
 * Fetches the SHORT_TERM_LEASE election context for a lease form.
 * Recomputes whenever company, fixed asset type, or lease start date changes.
 */
export function useShortTermElectionContext(
  companyId: string,
  fixedAssetTypeId: string,
  leaseStartDate: string,
): ShortTermElectionContext & Omit<AsyncData<ShortTermElectionContext>, 'data'> {
  const { data, ...state } = useAsyncData<ShortTermElectionContext>(
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

          const stlPolicy = getApplicablePolicy(
            elections,
            companyId,
            fixedAssetTypeId,
            'SHORT_TERM_LEASE',
            asOfDate,
          );

          return {
            shortTermElectionApproved: stlPolicy != null && stlPolicy.election_value === true,
            shortTermElectionId: stlPolicy?.id ?? null,
            shortTermElections: elections,
          };
        }
      : null,
    [companyId, fixedAssetTypeId, leaseStartDate],
    NO_CTX,
    'Failed to load the short-term lease election.',
  );
  return { ...data, ...state };
}
