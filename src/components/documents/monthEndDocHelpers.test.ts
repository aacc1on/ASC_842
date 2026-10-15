import { describe, it, expect } from 'vitest';
import { documentYears, getTypeColor, mapDocumentTransactions, undocumentedPeriods, type MonthEndDocument } from './monthEndDocHelpers';

const doc = (period: string) => ({ id: period, period }) as MonthEndDocument;

describe('monthEndDocHelpers', () => {
  it('lists distinct years newest first, always including the selected year', () => {
    expect(documentYears([doc('2025-12'), doc('2026-01'), doc('2026-02')], '2024')).toEqual(['2026', '2025', '2024']);
    expect(documentYears([], '2026')).toEqual(['2026']);
  });

  it('keeps only catch-up periods that have no document', () => {
    expect(undocumentedPeriods(['2026-01', '2026-02'], [doc('2026-01')])).toEqual(['2026-02']);
  });

  it('maps lease names and filters by company', () => {
    const rows = [
      { id: 't1', leases: { lease_name: 'HQ', company_id: 'c1' } },
      { id: 't2', leases: { lease_name: 'Depot', company_id: 'c2' } },
      { id: 't3', leases: null },
    ];
    const all = mapDocumentTransactions(rows);
    expect(all.map((t) => t.lease_name)).toEqual(['HQ', 'Depot', 'Unknown Lease']);
    expect(all[0]).not.toHaveProperty('leases');
    expect(mapDocumentTransactions(rows, 'c2').map((t) => t.id)).toEqual(['t2']);
  });

  it('colours known transaction types and falls back for others', () => {
    expect(getTypeColor('interest')).toContain('orange');
    expect(getTypeColor('mystery')).toBe('bg-slate-100 text-slate-700');
  });
});
