import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewPolicyModal } from '../components/NewPolicyModal';
import type { PolicyType } from '../utils/policyElections';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

const labels: Record<PolicyType, string> = {
  SHORT_TERM_LEASE: 'Short-Term Lease',
  COMBINE_LEASE_NONLEASE: 'Combine Components',
  RISK_FREE_RATE: 'Risk-Free Rate',
};

function setup(overrides: Partial<Parameters<typeof NewPolicyModal>[0]> = {}) {
  const onCreate = vi.fn().mockResolvedValue({ ok: true, policiesSaved: true });
  const onCreated = vi.fn();
  render(
    <NewPolicyModal
      companyName="Acme"
      assetTypes={[
        { id: 'a1', type_name: 'Vehicle', is_active: true },
        { id: 'a2', type_name: 'Old Gear', is_active: false },
      ]}
      entityType="public_business_entity"
      policyLabels={labels}
      policyTooltips={labels}
      onCreate={onCreate}
      onClose={vi.fn()}
      onCreated={onCreated}
      {...overrides}
    />
  );
  return { onCreate, onCreated };
}

const nameInput = () => screen.getByLabelText(/Asset Class Name/);
const createBtn = () => screen.getByRole('button', { name: /Create/ });

describe('NewPolicyModal', () => {
  it('warns and blocks when the asset class already exists (case and spaces ignored)', () => {
    const { onCreate } = setup();
    fireEvent.change(nameInput(), { target: { value: '  vehicle ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Vehicle');
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(createBtn()).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('also blocks names of inactive asset classes', () => {
    setup();
    fireEvent.change(nameInput(), { target: { value: 'OLD GEAR' } });
    expect(screen.getByRole('alert')).toHaveTextContent('(inactive)');
    expect(createBtn()).toBeDisabled();
  });

  it('creates a new asset class with the selected policies', async () => {
    const { onCreate, onCreated } = setup();
    fireEvent.change(nameInput(), { target: { value: 'Office Equipment' } });
    fireEvent.click(screen.getAllByRole('radio', { name: 'Do not elect' })[1]);
    fireEvent.click(createBtn());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      typeName: 'Office Equipment',
      policies: [
        { policyType: 'SHORT_TERM_LEASE', electionValue: true },
        { policyType: 'COMBINE_LEASE_NONLEASE', electionValue: false },
      ],
    }));
  });

  it('does not offer the risk-free rate for public business entities', () => {
    setup();
    expect(screen.getByText('Not eligible for this entity type.')).toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
  });

  it('requires at least one policy', () => {
    setup();
    fireEvent.change(nameInput(), { target: { value: 'Land' } });
    screen.getAllByRole('radio', { name: 'Decide later' }).forEach((b) => fireEvent.click(b));
    expect(createBtn()).toBeDisabled();
  });

  it('shows the duplicate message when the server rejects a duplicate', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: false, duplicate: true, message: 'Asset class "Land" already exists.' });
    const { onCreated } = setup({ onCreate });
    fireEvent.change(nameInput(), { target: { value: 'Land' } });
    fireEvent.click(createBtn());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already exists'));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
