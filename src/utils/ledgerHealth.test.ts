import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDataHealth, fetchLedgerReconciliation } from './ledgerHealth';

const rpc = vi.fn();
const range = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const result = rpc(...args);
      const builder = {
        order: () => builder,
        range: (from: number, to: number) => { range(from, to); return result; },
      };
      return builder;
    },
  },
}));

describe('ledgerHealth', () => {
  beforeEach(() => { rpc.mockReset(); range.mockReset(); });

  it('pages past the 1000-row response cap', async () => {
    const row = { check_key: 'orphan_row', detail: 'x' };
    rpc.mockResolvedValueOnce({ data: Array(1000).fill(row), error: null });
    rpc.mockResolvedValueOnce({ data: Array(5).fill(row), error: null });
    expect(await fetchDataHealth('platform')).toHaveLength(1005);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('maps reconciliation rows and passes the date range', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ check_type: 'posted_vs_journal', lease_id: 'l1', lease_name: 'Vehicle 14', period: '2026-09', account: 'cash', posted: '0', expected: '-260', difference: '260' }],
      error: null,
    });
    const rows = await fetchLedgerReconciliation('2000-01-01', '2026-10-12');
    expect(rpc).toHaveBeenCalledWith('get_ledger_reconciliation', { p_from: '2000-01-01', p_to: '2026-10-12', p_include_prepared_catch_up: false });
    expect(rows).toEqual([{ checkType: 'posted_vs_journal', leaseId: 'l1', leaseName: 'Vehicle 14', period: '2026-09', account: 'cash', posted: 0, expected: -260, difference: 260 }]);
  });

  it('can treat prepared catch-up corrections as posted', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await fetchLedgerReconciliation('2000-01-01', '2026-10-12', true);
    expect(rpc).toHaveBeenCalledWith('get_ledger_reconciliation', { p_from: '2000-01-01', p_to: '2026-10-12', p_include_prepared_catch_up: true });
  });

  it('returns an empty list when there are no differences', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await fetchLedgerReconciliation('2000-01-01', '2026-10-12')).toEqual([]);
  });

  it('throws on errors and malformed responses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authorized' } });
    await expect(fetchLedgerReconciliation('a', 'b')).rejects.toThrow('Not authorized');
    rpc.mockResolvedValueOnce({ data: { bad: true }, error: null });
    await expect(fetchDataHealth('organization')).rejects.toThrow('unexpected response');
  });

  it('calls the org or platform health function', async () => {
    rpc.mockResolvedValue({ data: [{ organization_id: 'o1', check_key: 'orphan_row', detail: 'x' }], error: null });
    const org = await fetchDataHealth('organization');
    expect(rpc).toHaveBeenLastCalledWith('get_data_health');
    expect(org[0]).toMatchObject({ organizationId: 'o1', organizationName: null, checkKey: 'orphan_row', detail: 'x' });
    await fetchDataHealth('platform');
    expect(rpc).toHaveBeenLastCalledWith('get_platform_data_health');
  });
});
