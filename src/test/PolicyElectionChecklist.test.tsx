import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PolicyElectionChecklist } from '../components/PolicyElectionChecklist';
import type { PolicyElection, AssetTypeInfo, EntityType } from '../utils/policyElections';
import { createFakeSupabase, type FakeSupabaseOptions } from './fixtures/fakeSupabase';
import type { Row } from './fixtures/goldenPortfolio';

interface MockDataOverrides {
  elections?: PolicyElection[];
  assetTypes?: AssetTypeInfo[];
  company?: { id: string; entity_type: EntityType | null } | null;
}

function mockSupabase(dataOverrides: MockDataOverrides = {}, options: Partial<FakeSupabaseOptions> = {}) {
  const elections = dataOverrides.elections ?? [];
  const assetTypes = dataOverrides.assetTypes ?? [];
  const company = dataOverrides.company ?? { id: 'c1', entity_type: null };

  const fake = createFakeSupabase({
    accounting_policy_elections: elections.map((e) => Object.assign({ company_id: company?.id ?? 'c1' }, e)) as unknown as Row[],
    fixed_asset_types: assetTypes.map((t) => Object.assign({ is_active: true }, t)) as unknown as Row[],
    companies: company ? [company as unknown as Row] : [],
  }, { userId: 'u1', ...options });
  vi.mocked(supabase.from).mockImplementation(fake.from as unknown as typeof supabase.from);
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';

function renderChecklist(companyId: string | null, asOfDate = '2024-06-01') {
  return render(
    <MemoryRouter>
      <PolicyElectionChecklist companyId={companyId} asOfDate={asOfDate} />
    </MemoryRouter>
  );
}

describe('PolicyElectionChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows orange warning when asset classes are not configured', async () => {
    mockSupabase({
      assetTypes: [
        { id: 'a1', type_name: 'Real Estate', is_active: true },
      ],
      elections: [],
      company: { id: 'c1', entity_type: 'non_public_business_entity' },
    });
    renderChecklist('c1');
    await waitFor(() => {
      expect(screen.getByText(/has not been configured for one or more asset classes/i)).toBeInTheDocument();
    });
  });

  it('shows green check when all asset classes have approved elections', async () => {
    const elections: PolicyElection[] = [
      { id: '1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
        election_value: true, effective_from: '2024-01-01', effective_to: null,
        status: 'approved', policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: 'u2', self_approved: false },
      { id: '2', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'COMBINE_LEASE_NONLEASE',
        election_value: false, effective_from: '2024-01-01', effective_to: null,
        status: 'approved', policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: 'u2', self_approved: false },
      { id: '3', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'RISK_FREE_RATE',
        election_value: false, effective_from: '2024-01-01', effective_to: null,
        status: 'approved', policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: 'u2', self_approved: false },
    ];
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections,
      company: { id: 'c1', entity_type: 'non_public_business_entity' },
    });
    renderChecklist('c1');
    await waitFor(() => {
      expect(screen.getByText(/All active asset classes have approved policy elections/i)).toBeInTheDocument();
    });
  });

  it('shows Configure Accounting Policies link button', async () => {
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections: [],
      company: { id: 'c1', entity_type: null },
    });
    renderChecklist('c1');
    await waitFor(() => {
      const link = screen.getByText('Configure Accounting Policies');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/settings/accounting-policies');
    });
  });

  it('shows Copy Disclosure button', async () => {
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections: [],
      company: { id: 'c1', entity_type: null },
    });
    renderChecklist('c1');
    await waitFor(() => {
      expect(screen.getByText('Copy Disclosure')).toBeInTheDocument();
    });
  });

  it('shows a green Auto badge when a policy is self/auto-approved', async () => {
    const elections: PolicyElection[] = [
      { id: '1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
        election_value: true, effective_from: '2024-01-01', effective_to: null,
        status: 'approved', policy_version: 1, notes: 'Self-approved note', change_reason: null,
        prepared_by: 'u1', approved_by: 'u1', self_approved: true },
    ];
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections,
      company: { id: 'c1', entity_type: 'non_public_business_entity' },
    });
    renderChecklist('c1');
    await waitFor(() => {
      const badge = screen.getByText('Auto');
      expect(badge.closest('span')?.className).toMatch(/emerald/);
    });
  });

  it('shows pending elections in orange', async () => {
    const elections: PolicyElection[] = [
      { id: '1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
        election_value: true, effective_from: '2024-01-01', effective_to: null,
        status: 'pending_approval', policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: null, self_approved: false },
    ];
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections,
      company: { id: 'c1', entity_type: 'non_public_business_entity' },
    });
    renderChecklist('c1');
    await waitFor(() => {
      const label = screen.getAllByText('Pending approval')[0];
      expect(label.className).toMatch(/orange/);
    });
  });

  it('does not show Self-approved badge for normal approvals', async () => {
    const elections: PolicyElection[] = [
      { id: '1', company_id: 'c1', fixed_asset_type_id: 'a1', policy_type: 'SHORT_TERM_LEASE',
        election_value: true, effective_from: '2024-01-01', effective_to: null,
        status: 'approved', policy_version: 1, notes: null, change_reason: null,
        prepared_by: 'u1', approved_by: 'u2', self_approved: false },
    ];
    mockSupabase({
      assetTypes: [{ id: 'a1', type_name: 'Real Estate', is_active: true }],
      elections,
      company: { id: 'c1', entity_type: 'non_public_business_entity' },
    });
    renderChecklist('c1');
    await waitFor(() => {
      expect(screen.queryByText('Auto')).not.toBeInTheDocument();
    });
  });
});
