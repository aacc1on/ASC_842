/**
 * Flow test (e): contract modification -> remeasurement -> persistence.
 *
 * Renders the real ModificationsModule (the module App.tsx mounts for the
 * "Contract Modifications" page) on top of an in-memory Supabase fake and
 * drives it like a user. The database's `aa_approval_workflow` BEFORE INSERT
 * trigger (which flips `pending_approval` to `approved` when the org does not
 * require approval for contract modifications) is simulated in this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModificationsModule from '../../components/ModificationsModule';
import type { UserPermissions } from '../../App';
import { createFakeSupabase, type Write } from '../fixtures/fakeSupabase';
import {
  buildGoldenPortfolio,
  leaseId,
  GOLDEN_ORG,
  GOLDEN_USER,
  type Row,
  type Tables,
} from '../fixtures/goldenPortfolio';

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, p) => h.client[p as string] }),
}));

const PERMISSIONS: UserPermissions = {
  view_leases_transactions: true,
  view_reports_documents: true,
  create_edit_leases: true,
  delete_leases: true,
  create_transactions: true,
  run_month_end: true,
  manage_modifications: true,
  upload_documents: true,
  manage_user_roles: false,
  access_user_management: false,
};

const LEASE_ID = leaseId(1);
const LEASE_NAME = 'HQ Office (finance, monthly, arrears)';
const MOD_DATE = '2026-08-01';

type Fake = ReturnType<typeof createFakeSupabase>;
let tables: Tables;
let fake: Fake;
/** Raw payloads the app sent to contract_modifications.insert (before the simulated trigger). */
let sentModInserts: Row[];

/** Mirrors internal.apply_approval_workflow for INSERTs on contract_modifications. */
function applyApprovalTrigger(row: Row): Row {
  const settings = (tables.approval_settings ?? []).find((s) => s.organization_id === row.organization_id);
  const required = Boolean(settings?.enabled)
    && (settings?.item_types as string[] | undefined)?.includes('contract_modification');
  const preparer = row.user_id ?? null;
  if (row.status === 'pending_approval' || row.status === 'approved') {
    if (required) return { ...row, prepared_by: preparer, status: 'pending_approval' };
    return {
      ...row,
      prepared_by: preparer,
      status: 'approved',
      approved_by: preparer,
      approved_at: '2026-10-12T12:00:00Z',
      self_approved: true,
    };
  }
  return row;
}

function setup(opts: { approvalRequired: boolean; failWrite?: string }) {
  tables = buildGoldenPortfolio().tables;
  tables.approval_settings = [{
    organization_id: GOLDEN_ORG,
    enabled: opts.approvalRequired,
    require_different_approver: false,
    approver_role: 'admin',
    item_types: opts.approvalRequired ? ['contract_modification'] : [],
  }];
  tables.lease_impairments = [];
  tables.contract_cancellations = [];
  fake = createFakeSupabase(tables, {
    userId: GOLDEN_USER,
    failures: opts.failWrite ? { write: { contract_modifications: opts.failWrite } } : undefined,
  });
  sentModInserts = [];
  const baseFrom = fake.from;
  h.client = {
    ...fake,
    from: (table: string) => {
      const q = baseFrom(table);
      if (table !== 'contract_modifications') return q;
      const insert = q.insert.bind(q);
      q.insert = (rows: Row | Row[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        sentModInserts.push(...list.map((r) => ({ ...r })));
        return insert(list.map(applyApprovalTrigger));
      };
      return q;
    },
  };
}

const writesTo = (table: string, op?: Write['op']) =>
  fake.writes.filter((w) => w.table === table && (!op || w.op === op));

const originalLease = () => buildGoldenPortfolio().tables.leases.find((l) => l.id === LEASE_ID)!;

async function openForm() {
  const user = userEvent.setup();
  render(<ModificationsModule permissions={PERMISSIONS} selectedCompanyId={null} />);
  // Existing modification from the portfolio loads into the table.
  await screen.findByText('Server Racks (modified)');
  await user.click(screen.getByRole('button', { name: /New Modification/ }));
  const heading = await screen.findByRole('heading', { name: 'New Modification' });
  const form = heading.closest('div.bg-white')!.querySelector('form')!;
  // happy-dom reports a false `stepMismatch` for integers on `step="0.01"` inputs
  // (floating-point modulo), which would silently block the click-submit. Browsers
  // accept these values, so skip native constraint validation; the component's own
  // JS validation (lease / date required) still runs and is tested below.
  form.noValidate = true;
  const field = (label: string) =>
    screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input, select, textarea') as HTMLInputElement;
  return { user, form, field };
}

async function fillModification(ctx: Awaited<ReturnType<typeof openForm>>) {
  const { user, field } = ctx;
  await user.selectOptions(field('Lease'), LEASE_ID);
  // Selecting a lease pre-fills payment/term/rate from the lease.
  expect(field('New Monthly Payment')).toHaveValue(2000);
  expect(field('New Term (months)')).toHaveValue(60);
  fireEvent.change(field('Modification Date'), { target: { value: MOD_DATE } });
  await user.type(field('Reason'), 'Renegotiated rent and extension');
  await user.clear(field('New Monthly Payment'));
  await user.type(field('New Monthly Payment'), '2200');
  await user.clear(field('New Term (months)'));
  await user.type(field('New Term (months)'), '36');
}

beforeEach(() => {
  setup({ approvalRequired: false });
});

describe('Contract modification flow: remeasurement and persistence', () => {
  it('journey (no approval required): previews remeasurement, saves, posts accounting and shows the approved row', async () => {
    const ctx = await openForm();
    const { user } = ctx;
    await fillModification(ctx);

    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(await screen.findByText('New Liability:')).toBeInTheDocument();
    expect(screen.getByText('New ROU Asset:')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Modification' }));

    expect(await screen.findByText('Modification created and applied.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New Modification' })).not.toBeInTheDocument();

    // What the client sent: remeasured values with pending status (DB decides the final status).
    expect(sentModInserts).toHaveLength(1);
    const sent = sentModInserts[0];
    const orig = originalLease();
    expect(sent).toMatchObject({
      lease_id: LEASE_ID,
      organization_id: GOLDEN_ORG,
      user_id: GOLDEN_USER,
      modification_date: MOD_DATE,
      modification_type: 'term_extension',
      accounting_treatment: 'remeasurement',
      reason: 'Renegotiated rent and extension',
      new_monthly_payment: 2200,
      new_lease_term: 36,
      old_monthly_payment: 2000,
      old_lease_term: 60,
      status: 'pending_approval',
      separate_contract: false,
    });
    const newLiab = Number(sent.new_lease_liability);
    const newRou = Number(sent.new_rou_asset);
    expect(newLiab).toBeGreaterThan(0);
    expect(newRou).toBeGreaterThan(0);
    expect(newLiab).not.toBeCloseTo(Number(orig.lease_liability), 0);
    expect(Number(sent.old_lease_liability)).toBeCloseTo(Number(orig.lease_liability), 2);

    // Approved immediately -> postItemAccounting ran applyModification.
    const stored = tables.contract_modifications.find((m) => m.lease_id === LEASE_ID)!;
    expect(stored.status).toBe('approved');
    expect(stored.accounting_posted).toBe(true);
    expect(Number(stored.new_lease_liability)).toBeGreaterThan(0);

    const leaseUpdates = writesTo('leases', 'update');
    expect(leaseUpdates).toHaveLength(1);
    const lu = (leaseUpdates[0] as Extract<Write, { op: 'update' }>).values;
    expect(lu.payment_amount).toBe(2200);
    expect(Number(lu.lease_liability)).toBeGreaterThan(0);
    expect(Number(lu.lease_liability)).not.toBeCloseTo(Number(orig.lease_liability), 0);
    expect(Number(lu.rou_asset)).toBeGreaterThan(0);

    // Schedule rebuilt and a remeasurement journal posted.
    expect(writesTo('amortization_schedules', 'delete')[0]).toMatchObject({ matched: expect.any(Number) });
    const schedIns = writesTo('amortization_schedules', 'insert');
    expect(schedIns).toHaveLength(1);
    expect((schedIns[0] as Extract<Write, { rows: Row[] }>).rows.length).toBeGreaterThan(0);
    const txIns = writesTo('lease_transactions', 'insert') as Extract<Write, { rows: Row[] }>[];
    expect(txIns.flatMap((w) => w.rows).some((r) => r.transaction_type === 'modification' && r.lease_id === LEASE_ID)).toBe(true);

    // Table refreshes with the new row.
    expect(await screen.findByText(LEASE_NAME, { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Modifications \(2\)/ })).toBeInTheDocument();
  });

  it('org requiring approval: saved as pending, no accounting posted, row shows "Pending approval"', async () => {
    setup({ approvalRequired: true });
    const ctx = await openForm();
    await fillModification(ctx);
    await ctx.user.click(screen.getByRole('button', { name: 'Create Modification' }));

    expect(await screen.findByText(/Modification created and sent for approval/)).toBeInTheDocument();

    const stored = tables.contract_modifications.find((m) => m.lease_id === LEASE_ID)!;
    expect(stored.status).toBe('pending_approval');
    expect(stored.accounting_posted).toBeUndefined();
    expect(Number(stored.new_lease_liability)).toBeGreaterThan(0);

    expect(writesTo('leases')).toHaveLength(0);
    expect(writesTo('amortization_schedules')).toHaveLength(0);
    expect(writesTo('lease_transactions')).toHaveLength(0);

    expect(await screen.findByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText(LEASE_NAME, { selector: 'td' })).toBeInTheDocument();
  });

  it('validation: submitting without a lease shows an error and persists nothing', async () => {
    const { form } = await openForm();
    fireEvent.submit(form);
    expect(await screen.findByText('Please select a lease.')).toBeInTheDocument();
    expect(sentModInserts).toHaveLength(0);
    expect(fake.writes).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'New Modification' })).toBeInTheDocument();
  });

  it('validation: clearing the modification date shows an error and persists nothing', async () => {
    const { user, form, field } = await openForm();
    await user.selectOptions(field('Lease'), LEASE_ID);
    fireEvent.change(field('Modification Date'), { target: { value: '' } });
    fireEvent.submit(form);
    expect(await screen.findByText('Please select a modification date.')).toBeInTheDocument();
    expect(fake.writes).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'New Modification' })).toBeInTheDocument();
  });

  it('save failure: insert error surfaces a safe message, keeps the form open, posts nothing', async () => {
    setup({ approvalRequired: false, failWrite: 'new row violates row-level security policy for table "contract_modifications"' });
    const ctx = await openForm();
    await fillModification(ctx);
    await ctx.user.click(screen.getByRole('button', { name: 'Create Modification' }));

    expect(await screen.findByText('Failed to create modification.')).toBeInTheDocument();
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New Modification' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Modification' })).toBeEnabled();
    expect(tables.contract_modifications.filter((m) => m.lease_id === LEASE_ID)).toHaveLength(0);
    expect(writesTo('leases')).toHaveLength(0);
    expect(writesTo('amortization_schedules')).toHaveLength(0);
  });

  it('separate contract: no remeasured values are sent and the lease is not remeasured', async () => {
    const ctx = await openForm();
    await fillModification(ctx);
    await ctx.user.click(screen.getByLabelText(/Grants an additional right of use/));
    expect(screen.getByText(/No remeasurement is performed/)).toBeInTheDocument();
    await ctx.user.click(screen.getByRole('button', { name: 'Create Modification' }));

    expect(await screen.findByText('Modification created and applied.')).toBeInTheDocument();
    expect(sentModInserts[0]).toMatchObject({ separate_contract: true, new_lease_liability: null, new_rou_asset: null });
    const stored = tables.contract_modifications.find((m) => m.lease_id === LEASE_ID)!;
    expect(stored).toMatchObject({ status: 'approved', accounting_posted: true, reassessed_classification: 'separate_contract' });
    expect(writesTo('leases')).toHaveLength(0);
    expect(writesTo('amortization_schedules')).toHaveLength(0);
  });
});
