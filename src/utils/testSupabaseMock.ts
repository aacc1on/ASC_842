type ChainableMock = {
  select: () => ChainableMock;
  eq: () => ChainableMock;
  neq: () => ChainableMock;
  gt: () => ChainableMock;
  gte: () => ChainableMock;
  lt: () => ChainableMock;
  lte: () => ChainableMock;
  in: () => ChainableMock;
  not: () => ChainableMock;
  order: () => ChainableMock;
  limit: () => Promise<{ data: unknown[] }>;
  range: () => Promise<{ data: unknown[] }>;
  maybeSingle: () => Promise<{ data: unknown | null }>;
  single: () => Promise<{ data: unknown | null }>;
};

export function chainableMock(): ChainableMock {
  const chain = {} as ChainableMock;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.neq = () => chain;
  chain.gt = () => chain;
  chain.gte = () => chain;
  chain.lt = () => chain;
  chain.lte = () => chain;
  chain.in = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: [] });
  chain.range = () => Promise.resolve({ data: [] });
  chain.maybeSingle = () => Promise.resolve({ data: null });
  chain.single = () => Promise.resolve({ data: null });
  return chain;
}

interface OracleRow {
  lease_id?: string;
  period_number?: number;
  period_date?: string;
  beginning_liability?: number;
  payment_amount?: number;
  ending_liability?: number;
  rou_asset_balance?: number;
  depreciation_expense?: number;
}

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const monthEnd = (d: string) => {
  const [y, m] = d.slice(0, 10).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const plus12 = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4, 10)}`;

/**
 * Test stand-in for the get_lease_balances_as_of RPC over mocked schedule rows, following the
 * documented rule. The real SQL is verified against fixtures in leaseBalancesRpcParity.test.ts.
 */
export function balancesFromScheduleRows(allRows: unknown[], leaseIds: string[], asOf: string, beginningTiming = new Set<string>()) {
  const one = (id: string, date: string) => {
    const rows = (allRows as OracleRow[]).filter((r) => r.lease_id === id).sort((a, b) => n(a.period_number) - n(b.period_number));
    if (rows.length === 0) return { rou: 0, liability: 0, status: 'no_schedule', first: undefined };
    const first = rows[0];
    if (date < String(first.period_date).slice(0, 10)) return { rou: 0, liability: 0, status: 'not_started', first };
    const done = [...rows].reverse().find((r) => monthEnd(String(r.period_date)) <= date);
    if (done && done === rows[rows.length - 1]) return { rou: 0, liability: 0, status: 'ended', first };
    const cur = rows.find((r) => String(r.period_date).slice(0, 10) <= date && monthEnd(String(r.period_date)) > date);
    const liability = cur
      ? n(cur.beginning_liability) - (beginningTiming.has(id) ? n(cur.payment_amount) : 0)
      : done ? n(done.ending_liability) : n(first.beginning_liability);
    const rou = done ? n(done.rou_asset_balance) : n(first.rou_asset_balance) + n(first.depreciation_expense);
    return { rou: r2(rou), liability: r2(liability), status: 'active', first };
  };
  return leaseIds.map((id) => {
    const now = one(id, asOf);
    const later = one(id, plus12(asOf));
    return {
      lease_id: id,
      rou: now.rou,
      liability: now.liability,
      status: now.status,
      current_portion: now.status === 'active' ? r2(Math.min(now.liability, Math.max(0, now.liability - later.liability))) : 0,
      opening_rou: now.first ? r2(n(now.first.rou_asset_balance) + n(now.first.depreciation_expense)) : 0,
    };
  });
}
