import { describe, it, expect, vi } from 'vitest';
import { fetchAll, fetchAllIn, PAGE_SIZE } from './fetchAll';

const table = Array.from({ length: 2500 }, (_, i) => ({ id: i }));

function pager(rows: { id: number }[], cap = PAGE_SIZE, count?: number) {
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + cap)),
    error: null,
    count,
  }));
}

describe('fetchAll', () => {
  it('reads more than 1,000 rows across pages', async () => {
    const page = pager(table);
    const rows = await fetchAll('rows', page);
    expect(rows).toHaveLength(2500);
    expect(rows[1000]).toEqual({ id: 1000 });
    expect(rows[2499]).toEqual({ id: 2499 });
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('makes one extra request when the total is an exact multiple of the page size', async () => {
    const page = pager(table.slice(0, 2000));
    expect(await fetchAll('rows', page)).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it('throws when the server returns fewer rows than the exact count', async () => {
    await expect(fetchAll('rows', pager(table, 500, 2500))).rejects.toThrow('received 500 of 2500 rows (truncated)');
  });

  it('accepts an exact count that matches', async () => {
    expect(await fetchAll('rows', pager(table, PAGE_SIZE, 2500))).toHaveLength(2500);
  });

  it('throws when a page is larger than requested', async () => {
    const page = vi.fn(async () => ({ data: table, error: null }));
    await expect(fetchAll('rows', page)).rejects.toThrow('page returned 2500 rows');
  });

  it('throws on query errors', async () => {
    const page = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    await expect(fetchAll('transactions', page)).rejects.toThrow('Failed to load transactions: boom');
  });

  it('pages within each id chunk', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `l${i}`);
    const page = vi.fn(async (chunk: string[], from: number, to: number) => ({
      data: from === 0 ? Array.from({ length: Math.min(1000, to + 1) }, () => ({ chunk: chunk.length })) : [{ chunk: chunk.length }],
      error: null,
    }));
    const rows = await fetchAllIn('schedules', ids, page);
    expect(rows).toHaveLength(3 * 1001);
    expect(page.mock.calls.map((c) => [c[0].length, c[1]])).toEqual([[200, 0], [200, 1000], [200, 0], [200, 1000], [50, 0], [50, 1000]]);
  });
});
