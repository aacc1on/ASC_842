export const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Reads every row of a query in pages of PAGE_SIZE. The API silently caps each response at 1000 rows,
 * so callers must give `page` a stable `.order(...)` and apply `.range(from, to)` to it.
 * Throws if a page is larger than requested or if the total differs from an exact count (when requested).
 */
export async function fetchAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load ${what}: ${error.message}`);
    const chunk = data ?? [];
    if (chunk.length > pageSize) {
      throw new Error(`Failed to load ${what}: page returned ${chunk.length} rows, expected at most ${pageSize}`);
    }
    if (typeof count === 'number') expected = count;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  if (expected !== null && rows.length !== expected) {
    throw new Error(`Failed to load ${what}: received ${rows.length} of ${expected} rows (truncated)`);
  }
  return rows;
}

interface RpcPageBuilder<T> extends PromiseLike<PageResult<T>> {
  order(column: string, options?: { ascending?: boolean }): RpcPageBuilder<T>;
  range(from: number, to: number): PromiseLike<PageResult<T>>;
}

/** `fetchAll` for set-returning RPCs; `orderBy` must make the row order unique so pages don't overlap. */
export function fetchAllRpc<T>(
  what: string,
  call: () => RpcPageBuilder<T>,
  orderBy: string[],
  validate: (data: unknown) => T[] = (data) => {
    if (data == null) return [];
    if (!Array.isArray(data)) throw new Error(`Failed to load ${what}: unexpected response`);
    return data as T[];
  },
): Promise<T[]> {
  return fetchAll<T>(what, async (from, to) => {
    let q = call();
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, to);
    if (error) throw Object.assign(new Error(error.message), error);
    return { data: validate(data), error: null };
  });
}

/** Runs `fetchAll` for each chunk of ids, keeping `.in(...)` filters under URL length limits. */
export async function fetchAllIn<T>(
  what: string,
  ids: string[],
  page: (ids: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 200,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    rows.push(...(await fetchAll(what, (from, to) => page(chunk, from, to))));
  }
  return rows;
}
