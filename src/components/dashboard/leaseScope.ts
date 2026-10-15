import type { LeaseStatusFilter } from '../../utils/leaseLifecycle';

export interface LeaseListScope {
  status: LeaseStatusFilter;
  missingClassificationOnly: boolean;
}

export const DEFAULT_LEASE_SCOPE: LeaseListScope = { status: 'all', missingClassificationOnly: false };
