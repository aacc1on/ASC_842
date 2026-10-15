import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BasicInfoSection } from '../components/lease-form/BasicInfoSection';
import { PostedLockBanner } from '../components/lease-form/PostedLockBanner';
import type { LeaseFormData } from '../components/lease-form/types';

const baseFormData: LeaseFormData = {
  lease_name: 'Test',
  lease_description: '',
  lessor_name: 'Test Lessor',
  lessor_type: 'corporate',
  lease_start_date: '2026-01-01',
  lease_end_date: '2029-01-01',
  lease_term_months: 36,
  payment_amount: '1000',
  payment_frequency: 'monthly',
  incremental_borrowing_rate: '5',
  lease_classification: 'operating',
  initial_direct_costs: '0',
  lease_incentives: '0',
  payment_timing: 'beginning',
  payment_day_of_month: '',
  transfer_ownership: false,
  purchase_option: false,
  purchase_option_price: '0',
  asset_fair_value: '35000',
  asset_market_value: '0',
  asset_economic_life_months: '60',
  classification_override_reason: '',
  specialized_asset: false,
  residual_value_guarantee: '0',
  rvg_probable_amount: '0',
  auto_classified: false,
  branch_id: '',
  fixed_asset_type_id: '',
  implicit_rate: '',
  implicit_rate_readily_determinable: false,
  risk_free_rate: '',
  risk_free_rate_source: '',
  risk_free_rate_date: '',
  discount_rate_method: 'ibr',
  discount_rate: '',
  rate_source: '',
  rate_date: '',
  risk_free_policy_election_id: '',
  accounting_treatment: 'recognized',
  short_term_policy_election_id: '',
    lease_component_amount: '',
    nonlease_component_amount: '',
    component_policy: 'not_applicable',
    component_policy_election_id: '',
  status: 'active',
  related_party: false,
  related_party_name: '',
  purchase_option_reasonably_certain: false,
  renewal_months_reasonably_certain: 0,
  renewal_payment_amount: '',
  termination_option_month: '',
  termination_option_reasonably_certain: false,
  termination_penalty_amount: 0,
  prepaid_lease_payments: 0,
};

function renderBasicInfo(accountingLocked: boolean) {
  return render(
    <BasicInfoSection
      companies={[]}
      formCompanyId=""
      onCompanyChange={vi.fn()}
      branches={[]}
      onBranchChange={vi.fn()}
      showNewBranchForm={false}
      newBranchName=""
      newBranchCode=""
      onShowNewBranchForm={vi.fn()}
      onNewBranchNameChange={vi.fn()}
      onNewBranchCodeChange={vi.fn()}
      onCancelNewBranch={vi.fn()}
      onCreateBranch={vi.fn()}
      fixedAssetTypes={[]}
      onAssetTypeChange={vi.fn()}
      showNewAssetTypeForm={false}
      newAssetTypeName=""
      newAssetTypeCode=""
      onShowNewAssetTypeForm={vi.fn()}
      onNewAssetTypeNameChange={vi.fn()}
      onNewAssetTypeCodeChange={vi.fn()}
      onCancelNewAssetType={vi.fn()}
      onCreateAssetType={vi.fn()}
      formData={baseFormData}
      onFieldChange={vi.fn()}
      lessors={[]}
      accountingLocked={accountingLocked}
    />,
  );
}

describe('Posted lease lock in the lease form', () => {
  it('shows the "Posted through <month>" badge with a Contract Modification link', () => {
    render(<PostedLockBanner postedThrough="2026-09-01" />);
    expect(screen.getByText('Posted through September 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contract Modification/i })).toHaveAttribute('href', '/modifications');
  });

  it('formats the posted month from a date string without timezone drift', () => {
    render(<PostedLockBanner postedThrough="2026-01-01" />);
    expect(screen.getByText('Posted through January 2026')).toBeInTheDocument();
  });

  it('disables dates and term but keeps the name and description editable when locked', () => {
    renderBasicInfo(true);
    expect(screen.getByDisplayValue('2026-01-01')).toBeDisabled();
    expect(screen.getByDisplayValue('2029-01-01')).toBeDisabled();
    expect(screen.getByDisplayValue('36')).toBeDisabled();
    expect(screen.getByDisplayValue('Test')).toBeEnabled();
  });

  it('leaves dates editable for a lease with no posted periods', () => {
    renderBasicInfo(false);
    expect(screen.getByDisplayValue('2026-01-01')).toBeEnabled();
    expect(screen.getByDisplayValue('36')).toBeEnabled();
  });
});
