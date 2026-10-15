import { describe, it, expect } from 'vitest';
import type { ContractModification } from '../../types/lease';
import { MISSING_CLASSIFICATION_OR_FILTER } from '../../utils/leaseLifecycle';
import { applyLeaseListFilters, groupModificationsByLease, type LeaseFilterableQuery, type LeaseListFilters } from './leaseListQuery';
import { DEFAULT_LEASE_SCOPE } from './leaseScope';

class Recorder implements LeaseFilterableQuery<Recorder> {
  calls: string[] = [];
  private add(s: string) { this.calls.push(s); return this; }
  or(f: string) { return this.add(`or(${f})`); }
  eq(c: string, v: string) { return this.add(`eq(${c},${v})`); }
  neq(c: string, v: string) { return this.add(`neq(${c},${v})`); }
  is(c: string, v: null) { return this.add(`is(${c},${v})`); }
  lte(c: string, v: string) { return this.add(`lte(${c},${v})`); }
  gte(c: string, v: string) { return this.add(`gte(${c},${v})`); }
  gt(c: string, v: string) { return this.add(`gt(${c},${v})`); }
}

const base: LeaseListFilters = { search: '', leaseType: 'all', lessorType: 'all', branchId: 'all', listScope: { ...DEFAULT_LEASE_SCOPE, status: 'all', missingClassificationOnly: false } };
const run = (over: Partial<LeaseListFilters>) => applyLeaseListFilters(new Recorder(), { ...base, ...over }, '2026-10-13').calls;

describe('applyLeaseListFilters', () => {
  it('adds nothing when every filter is "all"', () => {
    expect(run({})).toEqual([]);
  });

  it('applies search, type, lessor, branch and company filters', () => {
    expect(run({ search: '  hq ', leaseType: 'finance', lessorType: 'corporate', branchId: 'b1', companyId: 'c1' })).toEqual([
      'or(lease_name.ilike.%hq%,lessor_name.ilike.%hq%)',
      'eq(lease_classification,finance)',
      'eq(lessor_type,corporate)',
      'eq(branch_id,b1)',
      'eq(company_id,c1)',
    ]);
    expect(run({ branchId: 'none' })).toEqual(['is(branch_id,null)']);
  });

  it('maps lifecycle scopes to date filters', () => {
    expect(run({ listScope: { ...base.listScope, status: 'active' } })).toEqual([
      'eq(status,active)', 'lte(lease_start_date,2026-10-13)', 'gte(lease_end_date,2026-10-13)',
    ]);
    expect(run({ listScope: { ...base.listScope, status: 'not_started' } })).toEqual(['eq(status,active)', 'gt(lease_start_date,2026-10-13)']);
    expect(run({ listScope: { ...base.listScope, status: 'ended' } })).toEqual(['or(status.neq.active,lease_end_date.lt.2026-10-13)']);
  });

  it('restricts to finance leases missing classification inputs', () => {
    expect(run({ listScope: { ...base.listScope, missingClassificationOnly: true } })).toEqual([
      'eq(lease_classification,finance)', 'neq(accounting_treatment,short_term_exemption)', `or(${MISSING_CLASSIFICATION_OR_FILTER})`,
    ]);
  });
});

describe('groupModificationsByLease', () => {
  it('groups in input order', () => {
    const mods = [{ id: '1', lease_id: 'a' }, { id: '2', lease_id: 'b' }, { id: '3', lease_id: 'a' }] as ContractModification[];
    const grouped = groupModificationsByLease(mods);
    expect(grouped.get('a')!.map((m) => m.id)).toEqual(['1', '3']);
    expect(grouped.get('b')!.map((m) => m.id)).toEqual(['2']);
    expect(grouped.get('c')).toBeUndefined();
  });
});
