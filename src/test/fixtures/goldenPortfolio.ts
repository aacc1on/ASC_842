import type { Lease } from '../../types/lease';
import { calculateLeaseMetrics, generateAmortizationSchedule, type PaymentFrequency, type PaymentTranche } from '../../utils/leaseCalculations';
import { generateMonthEndTransactions } from '../../utils/monthEndTransactions';
import { computeShortTermLeaseCost } from '../../utils/shortTermLease';
import { parseLocalDate, toYMD } from '../../utils/formatting';

/*
 * Deterministic portfolio for the golden-master tests. Everything here is derived from fixed inputs
 * with the app's own schedule and month-end generators, so the same data is produced on every run.
 */

export const GOLDEN_ORG = '00000000-0000-0000-0000-0000000000a1';
export const GOLDEN_USER = '00000000-0000-0000-0000-0000000000b1';
export const GOLDEN_COMPANY = '00000000-0000-0000-0000-0000000000c1';
export const GOLDEN_TODAY = '2026-10-12T12:00:00';
export const GOLDEN_AS_OF = '2026-09-30';
export const LAST_POSTED_PERIOD = '2026-06';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface LeaseSpec {
  n: number;
  name: string;
  start: string;
  term: number;
  payment: number;
  rate: number;
  classification: 'operating' | 'finance';
  timing?: 'beginning' | 'end';
  frequency?: PaymentFrequency;
  tranches?: PaymentTranche[];
  idc?: number;
  incentives?: number;
  prepaid?: number;
  status?: Lease['status'];
  shortTerm?: boolean;
  branch?: string | null;
  assetType?: string | null;
  lessorType?: Lease['lessor_type'];
  relatedParty?: boolean;
}

const SPECS: LeaseSpec[] = [
  { n: 1, name: 'HQ Office (finance, monthly, arrears)', start: '2024-01-01', term: 60, payment: 2000, rate: 6, classification: 'finance', branch: 'br-1', assetType: 'at-1' },
  { n: 2, name: 'Retail Unit (operating, advance, 4th)', start: '2025-03-04', term: 36, payment: 1500, rate: 5, classification: 'operating', timing: 'beginning', branch: 'br-2', assetType: 'at-1', lessorType: 'individual' },
  { n: 3, name: 'Forklift Fleet (quarterly)', start: '2024-07-01', term: 48, payment: 9000, rate: 7, classification: 'finance', frequency: 'quarterly', branch: 'br-1', assetType: 'at-2' },
  { n: 4, name: 'Warehouse (escalating)', start: '2025-01-01', term: 36, payment: 1000, rate: 5.5, classification: 'operating', tranches: [{ fromMonth: 1, toMonth: 12, paymentAmount: 1000 }, { fromMonth: 13, toMonth: 24, paymentAmount: 1050 }, { fromMonth: 25, toMonth: 36, paymentAmount: 1100 }], branch: 'br-2', assetType: 'at-1' },
  { n: 5, name: 'Showroom (prepaid, IDC, incentive)', start: '2025-06-01', term: 24, payment: 1200, rate: 4.5, classification: 'operating', timing: 'beginning', idc: 2000, incentives: 1500, prepaid: 1200, branch: null, assetType: 'at-1', relatedParty: true },
  { n: 6, name: 'Server Racks (modified)', start: '2024-04-01', term: 48, payment: 3000, rate: 6.5, classification: 'finance', branch: 'br-1', assetType: 'at-3', lessorType: 'financial_institution' },
  { n: 7, name: 'Depot (impaired)', start: '2024-09-01', term: 60, payment: 2500, rate: 5, classification: 'operating', branch: 'br-2', assetType: 'at-1', lessorType: 'government' },
  { n: 8, name: 'Pool Car (cancelled)', start: '2024-01-01', term: 36, payment: 800, rate: 6, classification: 'finance', status: 'cancelled', branch: 'br-1', assetType: 'at-2' },
  { n: 9, name: 'New Lab (not started)', start: '2027-01-01', term: 24, payment: 1800, rate: 5, classification: 'operating', branch: 'br-1', assetType: 'at-3' },
  { n: 10, name: 'Old Kiosk (ended)', start: '2022-01-01', term: 24, payment: 700, rate: 4, classification: 'operating', status: 'expired', branch: 'br-2', assetType: 'at-1' },
  { n: 11, name: 'Pop-up Store (short-term)', start: '2026-02-01', term: 12, payment: 900, rate: 5, classification: 'operating', shortTerm: true, branch: 'br-2', assetType: 'at-1' },
];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const leaseId = (n: number) => `00000000-0000-0000-0001-0000000000${pad(n)}`;

function endDate(start: string, term: number): string {
  const d = parseLocalDate(start);
  return toYMD(new Date(d.getFullYear(), d.getMonth() + term, d.getDate() - 1));
}

function buildLease(s: LeaseSpec): Lease {
  const frequency = s.frequency ?? 'monthly';
  const timing = s.timing ?? 'end';
  const metrics = calculateLeaseMetrics({
    leaseTermMonths: s.term,
    paymentAmount: s.payment,
    incrementalBorrowingRate: s.rate,
    initialDirectCosts: s.idc ?? 0,
    leaseIncentives: s.incentives ?? 0,
    leaseStartDate: parseLocalDate(s.start),
    paymentTiming: timing,
    paymentFrequency: frequency,
    paymentSchedule: s.tranches,
    classification: s.classification,
    prepaidLeasePayments: s.prepaid ?? 0,
  });
  const created = `2024-01-${pad(s.n)}T09:00:00Z`;
  return {
    id: leaseId(s.n),
    user_id: GOLDEN_USER,
    organization_id: GOLDEN_ORG,
    branch_id: s.branch === undefined ? null : s.branch,
    company_id: GOLDEN_COMPANY,
    lease_name: s.name,
    lease_description: `${s.name} description`,
    lessor_name: `Lessor ${s.n}`,
    lessor_type: s.lessorType ?? 'corporate',
    lease_start_date: s.start,
    lease_end_date: endDate(s.start, s.term),
    lease_term_months: s.term,
    payment_amount: s.payment,
    payment_frequency: frequency,
    incremental_borrowing_rate: s.rate,
    lease_classification: s.classification,
    initial_direct_costs: s.idc ?? 0,
    lease_incentives: s.incentives ?? 0,
    rou_asset: s.shortTerm ? 0 : metrics.rouAsset,
    lease_liability: s.shortTerm ? 0 : metrics.leaseLiability,
    status: s.status ?? 'active',
    payment_timing: timing,
    payment_day_of_month: null,
    transfer_ownership: s.classification === 'finance' && s.n === 1,
    purchase_option: s.n === 3,
    purchase_option_price: s.n === 3 ? 5000 : 0,
    asset_fair_value: s.payment * s.term * 1.1,
    asset_market_value: s.payment * s.term * 1.1,
    asset_economic_life_months: s.term + 24,
    specialized_asset: s.n === 6,
    residual_value_guarantee: 0,
    rvg_probable_amount: 0,
    auto_classified: true,
    fixed_asset_type_id: s.assetType ?? null,
    discount_rate: s.rate,
    discount_rate_method: 'incremental_borrowing_rate',
    accounting_treatment: s.shortTerm ? 'short_term_exemption' : 'recognized',
    paymentTranches: s.tranches,
    related_party: s.relatedParty ?? false,
    related_party_name: s.relatedParty ? 'Owner Holdings LLC' : null,
    prepaid_lease_payments: s.prepaid ?? 0,
    created_at: created,
    updated_at: created,
    is_complete: true,
  };
}

function scheduleRows(s: LeaseSpec, lease: Lease): Row[] {
  const rows = generateAmortizationSchedule({
    leaseTermMonths: s.term,
    paymentAmount: s.payment,
    incrementalBorrowingRate: s.rate,
    initialDirectCosts: s.idc ?? 0,
    leaseIncentives: s.incentives ?? 0,
    leaseStartDate: parseLocalDate(s.start),
    paymentTiming: s.timing ?? 'end',
    paymentFrequency: s.frequency ?? 'monthly',
    residualValueGuarantee: 0,
    rvgProbableAmount: 0,
    classification: s.classification,
    paymentSchedule: s.tranches,
    prepaidLeasePayments: s.prepaid ?? 0,
  });
  const stl = s.shortTerm ? computeShortTermLeaseCost(s.payment * s.term, s.term) : 0;
  return rows.map((r) => ({
    id: `${lease.id}-p${pad(r.periodNumber, 3)}`,
    lease_id: lease.id,
    user_id: GOLDEN_USER,
    organization_id: GOLDEN_ORG,
    period_number: r.periodNumber,
    period_date: toYMD(r.periodDate),
    beginning_liability: s.shortTerm ? 0 : r.beginningLiability,
    payment_amount: r.paymentAmount,
    interest_expense: s.shortTerm ? 0 : r.interestExpense,
    principal_reduction: s.shortTerm ? 0 : r.principalReduction,
    ending_liability: s.shortTerm ? 0 : r.endingLiability,
    rou_asset_balance: s.shortTerm ? 0 : r.rouAssetBalance,
    depreciation_expense: s.shortTerm ? 0 : r.depreciationExpense,
    short_term_lease_cost: stl,
  }));
}

function periodsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function leaseEvent(id: string, lease: Lease, date: string, type: string, dr: string, cr: string, amount: number, description: string): Row {
  return {
    id, lease_id: lease.id, user_id: GOLDEN_USER, organization_id: GOLDEN_ORG,
    transaction_date: date, transaction_type: type, account_debited: dr, account_credited: cr,
    amount, description, created_at: `${date}T10:00:00Z`,
  };
}

function initialRecognition(lease: Lease, seq: () => string): Row[] {
  if (lease.accounting_treatment === 'short_term_exemption') return [];
  const rows = [leaseEvent(seq(), lease, lease.lease_start_date, 'initial_recognition', 'Right-of-Use Asset', 'Lease Liability', Number(lease.lease_liability), `Initial recognition of ${lease.lease_classification} lease`)];
  if (lease.initial_direct_costs) rows.push(leaseEvent(seq(), lease, lease.lease_start_date, 'initial_recognition', 'Right-of-Use Asset', 'Cash', lease.initial_direct_costs, 'Initial direct costs capitalised'));
  if (lease.lease_incentives) rows.push(leaseEvent(seq(), lease, lease.lease_start_date, 'initial_recognition', 'Cash / Lease Incentive Receivable', 'Right-of-Use Asset', lease.lease_incentives, 'Lease incentive received'));
  if (lease.prepaid_lease_payments) rows.push(leaseEvent(seq(), lease, lease.lease_start_date, 'initial_recognition', 'Right-of-Use Asset', 'Prepaid Rent', Number(lease.prepaid_lease_payments), 'Prepaid rent reclassified to ROU asset'));
  return rows;
}

export interface GoldenPortfolio {
  leases: Lease[];
  tables: Tables;
}

export function buildGoldenPortfolio(): GoldenPortfolio {
  const leases = SPECS.map(buildLease);
  const schedules = SPECS.flatMap((s, i) => scheduleRows(s, leases[i]));

  let evt = 0;
  const nextEvt = () => `lt-${pad(++evt, 4)}`;
  const leaseTransactions: Row[] = leases.flatMap((l) => initialRecognition(l, nextEvt));
  const byN = (n: number) => leases[n - 1];
  leaseTransactions.push(
    leaseEvent(nextEvt(), byN(6), '2025-10-01', 'modification', 'Right-of-Use Asset', 'Lease Liability', 4210.55, 'Term extension remeasurement'),
    leaseEvent(nextEvt(), byN(6), '2025-10-01', 'modification', 'Lease Modification Loss', 'Lease Liability', 312.4, 'Modification loss on partial scope change'),
    leaseEvent(nextEvt(), byN(7), '2026-03-31', 'impairment', 'Impairment Loss', 'Right-of-Use Asset', 10000, 'ROU asset impairment (depot closure)'),
    leaseEvent(nextEvt(), byN(8), '2025-12-31', 'termination', 'Lease Liability', 'Right-of-Use Asset', 9050.25, 'Derecognise on early termination'),
    leaseEvent(nextEvt(), byN(8), '2025-12-31', 'termination', 'Loss on Lease Termination', 'Cash', 1200, 'Termination penalty paid'),
  );

  const scheduleMap = new Map<string, { period_number: number; period_date: string; beginning_liability: number; payment_amount: number; interest_expense: number; principal_reduction: number; ending_liability: number; rou_asset_balance: number; depreciation_expense: number }[]>();
  for (const r of schedules) {
    const list = scheduleMap.get(String(r.lease_id)) ?? [];
    list.push(r as never);
    scheduleMap.set(String(r.lease_id), list);
  }

  const postedPeriods = periodsBetween('2024-01', LAST_POSTED_PERIOD);
  const monthEndDocuments: Row[] = [
    ...postedPeriods.map((p, i) => ({
      id: `doc-${pad(i + 1, 3)}`, organization_id: GOLDEN_ORG, user_id: GOLDEN_USER, period: p, status: 'posted',
      document_number: `ME-${p}`, created_at: `${p}-28T00:00:00Z`, posted_at: `${p}-28T00:00:00Z`,
    })),
    { id: 'doc-900', organization_id: GOLDEN_ORG, user_id: GOLDEN_USER, period: '2026-07', status: 'draft', document_number: 'ME-2026-07', created_at: '2026-08-02T00:00:00Z', posted_at: null },
  ];

  let tx = 0;
  const transactions: Row[] = [];
  const postingLeases = leases.filter((l) => l.status === 'active');
  postedPeriods.forEach((period, i) => {
    const docId = `doc-${pad(i + 1, 3)}`;
    for (const t of generateMonthEndTransactions(postingLeases, period, scheduleMap)) {
      transactions.push({
        id: `tx-${pad(++tx, 6)}`, organization_id: GOLDEN_ORG, user_id: GOLDEN_USER, month_end_document_id: docId,
        is_reversed: false, created_at: `${t.transaction_date}T12:00:00Z`, amount: t.debit_amount, ...t,
      });
    }
  });
  transactions.push({
    id: `tx-${pad(++tx, 6)}`, organization_id: GOLDEN_ORG, user_id: GOLDEN_USER, month_end_document_id: null,
    lease_id: byN(8).id, lease_name: byN(8).lease_name, transaction_date: '2025-12-31', transaction_type: 'lease_cancellation',
    account_debited: 'Lease Liability', account_credited: 'Right-of-Use Asset', debit_amount: 9050.25, credit_amount: 9050.25, amount: 9050.25,
    description: 'Lease cancelled', reference_number: 'CAN-0008', period: '2025-12', is_reversed: false, created_at: '2025-12-31T12:00:00Z',
  });

  const tables: Tables = {
    leases: leases.map((l) => {
      const { paymentTranches: _t, ...row } = l;
      void _t;
      return row as Row;
    }),
    amortization_schedules: schedules,
    lease_transactions: leaseTransactions,
    transactions,
    month_end_documents: monthEndDocuments,
    branches: [
      { id: 'br-1', branch_name: 'North Branch', branch_code: 'N01', is_active: true, organization_id: GOLDEN_ORG },
      { id: 'br-2', branch_name: 'South Branch', branch_code: 'S01', is_active: true, organization_id: GOLDEN_ORG },
    ],
    fixed_asset_types: [
      { id: 'at-1', type_name: 'Property', type_code: 'PROP', is_active: true, organization_id: GOLDEN_ORG },
      { id: 'at-2', type_name: 'Vehicles', type_code: 'VEH', is_active: true, organization_id: GOLDEN_ORG },
      { id: 'at-3', type_name: 'Equipment', type_code: 'EQP', is_active: true, organization_id: GOLDEN_ORG },
    ],
    contract_modifications: [
      {
        id: 'mod-1', organization_id: GOLDEN_ORG, lease_id: byN(6).id, modification_date: '2025-10-01', created_at: '2025-10-01T08:00:00Z', status: 'approved',
        accounting_posted: true, reassessed_classification: 'finance', new_lease_liability: 62000.12, new_lease_term: 54, fair_value_at_modification: 70000,
      },
    ],
    companies: [{ id: GOLDEN_COMPANY, company_name: 'Golden Co', entity_type: 'public', is_active: true, organization_id: GOLDEN_ORG }],
    accounting_policy_elections: [],
  };
  return { leases, tables };
}

export const GOLDEN_RECONCILIATION_ROWS: Row[] = [
  { check_type: 'missing_posting', lease_id: leaseId(1), lease_name: SPECS[0].name, period: '2026-07', account: 'Interest Expense', posted: 0, expected: 230.12, difference: -230.12 },
  { check_type: 'posted_vs_schedule', lease_id: leaseId(2), lease_name: SPECS[1].name, period: '2026-05', account: 'Lease Liability', posted: 1100, expected: 1099.5, difference: 0.5 },
  { check_type: 'posted_vs_journal', lease_id: leaseId(4), lease_name: SPECS[3].name, period: '2026-06', account: 'Cash', posted: -1050, expected: -1050.01, difference: 0.01 },
];

export const GOLDEN_DATA_HEALTH_ROWS: Row[] = [
  { organization_id: GOLDEN_ORG, organization_name: 'Golden Org', check_key: 'unbalanced_batch', lease_id: leaseId(5), lease_name: SPECS[4].name, detail: 'Initial recognition debits 4,900.00 vs credits 4,700.00' },
  { organization_id: GOLDEN_ORG, organization_name: 'Golden Org', check_key: 'missing_schedule', lease_id: null, lease_name: null, detail: 'No schedule rows' },
];
