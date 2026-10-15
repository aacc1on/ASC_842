import type { PolicyType, EntityType } from '../../utils/policyElections';

export const POLICY_LABELS: Record<PolicyType, string> = {
  SHORT_TERM_LEASE: 'Short-Term Lease',
  COMBINE_LEASE_NONLEASE: 'Combine Components',
  RISK_FREE_RATE: 'Risk-Free Rate',
};

export const POLICY_TOOLTIPS: Record<PolicyType, string> = {
  SHORT_TERM_LEASE: 'ASC 842 permits a lessee to make an accounting policy election by class of underlying asset not to recognize ROU assets and lease liabilities for qualifying short-term leases.',
  COMBINE_LEASE_NONLEASE: 'ASC 842 permits an entity to elect, by class of underlying asset, not to separate lease and nonlease components, combining them into a single lease component.',
  RISK_FREE_RATE: 'ASC 842 permits a non-public business entity to elect, by class of underlying asset, to use the risk-free rate as the discount rate instead of the incremental borrowing rate.',
};

export const ENTITY_LABELS: Record<EntityType, string> = {
  public_business_entity: 'Public Business Entity',
  non_public_business_entity: 'Non-Public Business Entity',
  not_for_profit_other: 'Not-for-Profit / Other',
};

export const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
  pending_approval: { label: 'Pending approval', className: 'bg-orange-100 text-orange-700' },
  approved: { label: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  inactive: { label: 'Inactive', className: 'bg-slate-200 text-slate-500' },
};
