import { balancesFromScheduleRows } from '../../utils/testSupabaseMock';
import type { Row, Tables } from './goldenPortfolio';

// Fixture rows without an organization_id belong to whichever org is asked for (the database fills it from the signed-in user).
const matchesEq = (r: Row, c: string, v: unknown) => r[c] === v || (c === 'organization_id' && r[c] === undefined);

/*
 * Minimal in-memory stand-in for the Supabase client, enough for the report code paths:
 * filters, ordering, range paging, embedded `alias:fk(cols)` joins and a few RPCs.
 */

type Filter = (r: Row) => boolean;
type RpcHandler = (args: Record<string, unknown>, tables: Tables) => unknown;
type Result = { data: unknown; error: { message: string; code?: string } | null; count: number | null };
export type Write =
  | { op: 'insert' | 'upsert'; table: string; rows: Row[] }
  | { op: 'update'; table: string; values: Row; matched: number }
  | { op: 'delete'; table: string; matched: number };

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
};

const FK_TABLE: Record<string, string> = { lease_id: 'leases', company_id: 'companies', branch_id: 'branches' };

function splitTopLevel(cols: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of cols.replace(/\s+/g, '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function project(row: Row, cols: string, tables: Tables): Row {
  const parts = splitTopLevel(cols || '*');
  const out: Row = {};
  for (const p of parts) {
    const join = p.match(/^(\w+)(?::(\w+))?\(([^)]*)\)$/);
    if (join) {
      const [, alias, fk, inner] = join;
      const fkCol = fk ?? 'lease_id';
      const target = (tables[FK_TABLE[fkCol] ?? alias] ?? []).find((t) => t.id === row[fkCol]);
      out[alias] = target ? project(target, inner, tables) : null;
    } else if (p === '*') {
      Object.assign(out, row);
    } else {
      out[p] = row[p];
    }
  }
  return out;
}

/** Thrown by an RPC handler to make the fake return `{ data: null, error }`. */
export class RpcError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private cols = '*';
  private from?: number;
  private to?: number;
  private max?: number;
  private wantCount = false;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private returning = false;

  constructor(
    private table: string,
    private tables: Tables,
    private writes: Write[],
    private failures: FakeFailures,
    private maxRows?: number,
  ) {}

  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows: Row | Row[]) { this.op = 'upsert'; this.payload = rows; return this; }
  update(values: Row) { this.op = 'update'; this.payload = values; return this; }
  delete() { this.op = 'delete'; return this; }

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    this.cols = cols;
    this.wantCount = !!opts?.count;
    return this;
  }
  eq(c: string, v: unknown) { this.filters.push((r) => matchesEq(r, c, v)); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: unknown) { this.filters.push((r) => cmp(r[c], v) > 0); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  lt(c: string, v: unknown) { this.filters.push((r) => cmp(r[c], v) < 0); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === 'is') this.filters.push((r) => (r[c] ?? null) !== v);
    else if (op === 'eq') this.filters.push((r) => r[c] !== v);
    else throw new Error(`fakeSupabase: unsupported not(${op})`);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }

  private runWrite(): Result {
    const fail = this.failures.write?.[this.table];
    if (fail) return { data: null, error: { message: fail }, count: null };
    const table = (this.tables[this.table] ??= []);
    if (this.op === 'insert' || this.op === 'upsert') {
      const payload = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const rows = payload.map((r, i) => ({ id: r.id ?? `${this.table}-new-${table.length + i + 1}`, ...r }));
      table.push(...rows.map((r) => ({ ...r })));
      this.writes.push({ op: this.op, table: this.table, rows: payload });
      if (!this.returning) return { data: null, error: null, count: null };
      const data = rows.map((r) => project(r, this.cols, this.tables));
      return { data: this.mode === 'many' ? data : data[0] ?? null, error: null, count: null };
    }
    const matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.writes.push({ op: 'update', table: this.table, values: this.payload as Row, matched: matched.length });
    } else {
      this.tables[this.table] = table.filter((r) => !matched.includes(r));
      this.writes.push({ op: 'delete', table: this.table, matched: matched.length });
    }
    return { data: null, error: null, count: null };
  }

  private run(): Result {
    if (this.op !== 'select') return this.runWrite();
    const fail = this.failures.select?.[this.table];
    if (fail) return { data: null, error: { message: fail }, count: null };
    let rows = (this.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    const count = rows.length;
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const d = cmp(a[o.col], b[o.col]);
          if (d !== 0) return o.asc ? d : -d;
        }
        return 0;
      });
    }
    if (this.from !== undefined) rows = rows.slice(this.from, (this.to ?? rows.length - 1) + 1);
    if (this.max !== undefined) rows = rows.slice(0, this.max);
    if (this.maxRows !== undefined) rows = rows.slice(0, this.maxRows);
    const data = rows.map((r) => project(r, this.cols, this.tables));
    if (this.mode !== 'many') return { data: data[0] ?? null, error: null, count: null };
    return { data, error: null, count: this.wantCount ? count : null };
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }
}

/** RPC result that supports `.order()` and `.range()` on set-returning functions, like PostgREST. */
class RpcQuery implements PromiseLike<Result> {
  private orders: { col: string; asc: boolean }[] = [];
  private from?: number;
  private to?: number;

  constructor(private run: () => Result, private maxRows?: number) {}

  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }

  private result(): Result {
    const res = this.run();
    if (!Array.isArray(res.data)) return res;
    let rows = res.data as Row[];
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const d = cmp(a[o.col], b[o.col]);
          if (d !== 0) return o.asc ? d : -d;
        }
        return 0;
      });
    }
    if (this.from !== undefined) rows = rows.slice(this.from, (this.to ?? rows.length - 1) + 1);
    if (this.maxRows !== undefined) rows = rows.slice(0, this.maxRows);
    return { ...res, data: rows };
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.result()).then(ok, fail);
  }
}

export interface FakeFailures {
  select?: Record<string, string>;
  write?: Record<string, string>;
}

export interface FakeSupabaseOptions {
  userId: string;
  email?: string;
  rpc?: Record<string, RpcHandler>;
  failures?: FakeFailures;
  signedOut?: boolean;
  /** Server-side response cap, like PostgREST's db-max-rows (1000 on Supabase). Off by default. */
  maxRows?: number;
}

export const scheduleBalancesRpc: RpcHandler = (args, tables) => {
  const ids = (args.p_lease_ids as string[]) ?? [];
  const beginning = new Set(tables.leases.filter((l) => l.payment_timing === 'beginning').map((l) => String(l.id)));
  return balancesFromScheduleRows(tables.amortization_schedules, ids, String(args.p_as_of), beginning);
};

export function createFakeSupabase(tables: Tables, opts: FakeSupabaseOptions) {
  const calls: { fn: string; args: unknown }[] = [];
  const writes: Write[] = [];
  const acceptedLegal = () => ({ accepted: true, has_prior_acceptance: true, terms_accepted: true, privacy_accepted: true });
  const rpc: Record<string, RpcHandler> = {
    get_lease_balances_as_of: scheduleBalancesRpc,
    my_legal_status: acceptedLegal,
    get_users_legal_acceptance: () => [],
    ...opts.rpc,
  };
  const failures = opts.failures ?? {};
  const user = opts.signedOut ? null : { id: opts.userId, email: opts.email ?? 'golden@example.com' };
  const session = user ? { user, access_token: 'test-token' } : null;
  return {
    calls,
    writes,
    failures,
    from: (table: string) => new Query(table, tables, writes, failures, opts.maxRows),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      const h = rpc[fn];
      const run = (): Result => {
        if (!h) return { data: null, error: { message: `fakeSupabase: no rpc ${fn}` }, count: null };
        try {
          return { data: h(args, tables), error: null, count: null };
        } catch (e) {
          const err = e instanceof RpcError ? { message: e.message, code: e.code } : { message: String(e) };
          return { data: null, error: err, count: null };
        }
      };
      return new RpcQuery(run, opts.maxRows);
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user }, error: null }),
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        listFactors: () => Promise.resolve({ data: { totp: [], all: [] }, error: null }),
      },
    },
  };
}
