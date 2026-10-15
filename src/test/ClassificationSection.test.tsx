import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClassificationSection } from '../components/lease-form/ClassificationSection';
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

function renderSection(overrides: Partial<Parameters<typeof ClassificationSection>[0]> = {}) {
  const props = {
    formData: baseFormData,
    showClassificationWizard: true,
    onFieldChange: vi.fn(),
    onToggleWizard: vi.fn(),
    onAutoCalculateFairValue: vi.fn(),
    onRunClassification: vi.fn(),
    check: {
      presentValue: 35000,
      tests: { transferOwnership: false, purchaseOptionReasonablyCertain: false, majorPartOfLife: false, substantiallyAllValue: false, specializedAsset: false },
    },
    ...overrides,
  };
  return render(<ClassificationSection {...props} />);
}

describe('ClassificationSection UI', () => {
  it('shows the Asset Economic Life field in months', () => {
    renderSection();
    expect(screen.getByText(/Asset Economic Life \(Months\)/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
  });

  it('warns that finance leases need fair value and useful life', () => {
    renderSection({ formData: { ...baseFormData, lease_classification: 'finance', asset_market_value: '0' } });
    expect(screen.getByText(/Finance classification requires the asset's fair value and useful life/)).toBeInTheDocument();
  });

  it('asks for an override reason when no finance criterion is met', () => {
    renderSection({ formData: { ...baseFormData, lease_classification: 'finance', asset_market_value: '100000' } });
    expect(screen.getByText(/None of the finance criteria is met/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Override reason/)).toBeInTheDocument();
  });

  it('shows no finance warnings for operating leases', () => {
    renderSection();
    expect(screen.queryByText(/None of the finance criteria is met/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires the asset's fair value/)).not.toBeInTheDocument();
  });

  it('shows the Determine Classification button', () => {
    renderSection();
    expect(screen.getByText('Determine Classification')).toBeInTheDocument();
  });

  it('shows the Classification Wizard toggle button', () => {
    renderSection({ showClassificationWizard: false });
    expect(screen.getByText('Classification Wizard')).toBeInTheDocument();
  });

  it('shows the Auto-Calculate link for Lease Fair Value', () => {
    renderSection();
    expect(screen.getByText('Auto-Calculate')).toBeInTheDocument();
  });

  it('shows the helper hint under Lease Fair Value', () => {
    renderSection();
    expect(screen.getByText(/Leave at 0 to skip the fair value test/)).toBeInTheDocument();
  });

  it('shows the Lease Classification selector with Operating and Finance options', () => {
    renderSection();
    const select = screen.getByDisplayValue('Operating Lease');
    expect(select).toBeInTheDocument();
  });

  it('shows the auto-classified note when auto_classified is true', () => {
    renderSection({ formData: { ...baseFormData, auto_classified: true } });
    expect(screen.getByText('Auto-classified using ASC 842 criteria')).toBeInTheDocument();
  });

  it('does not show the auto-classified note when auto_classified is false', () => {
    renderSection({ formData: { ...baseFormData, auto_classified: false } });
    expect(screen.queryByText('Auto-classified using ASC 842 criteria')).not.toBeInTheDocument();
  });

  it('shows the criteria checkboxes when wizard is open', () => {
    renderSection();
    expect(screen.getByText(/Lease transfers ownership to lessee/)).toBeInTheDocument();
    expect(screen.getByText(/Lessee has purchase option/)).toBeInTheDocument();
    expect(screen.getByText(/Asset is specialized/)).toBeInTheDocument();
  });

  it('shows the PV percentage badge using the present value of lease payments', () => {
    renderSection({ formData: { ...baseFormData, asset_fair_value: '1', asset_market_value: '35000' } });
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('calls onRunClassification when Determine Classification is clicked', async () => {
    const onRunClassification = vi.fn();
    const user = userEvent.setup();
    renderSection({ onRunClassification });
    await user.click(screen.getByText('Determine Classification'));
    expect(onRunClassification).toHaveBeenCalledOnce();
  });

  it('calls onAutoCalculateFairValue when Auto-Calculate is clicked', async () => {
    const onAutoCalculateFairValue = vi.fn();
    const user = userEvent.setup();
    renderSection({ onAutoCalculateFairValue });
    await user.click(screen.getByText('Auto-Calculate'));
    expect(onAutoCalculateFairValue).toHaveBeenCalledOnce();
  });
});
