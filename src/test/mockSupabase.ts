import { vi } from 'vitest';

type ChainResult = {
  data: unknown;
  error: null;
};

type ChainBuilder = {
  select: (cols?: string) => ChainBuilder;
  eq: (col: string, val: unknown) => ChainBuilder;
  neq: (col: string, val: unknown) => ChainBuilder;
  gt: (col: string, val: unknown) => ChainBuilder;
  gte: (col: string, val: unknown) => ChainBuilder;
  lt: (col: string, val: unknown) => ChainBuilder;
  lte: (col: string, val: unknown) => ChainBuilder;
  in: (col: string, vals: unknown[]) => ChainBuilder;
  not: (col: string, val: unknown) => ChainBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => ChainBuilder;
  limit: (n: number) => Promise<ChainResult> & ChainBuilder;
  range: (a: number, b: number) => Promise<ChainResult> & ChainBuilder;
  maybeSingle: () => Promise<ChainResult>;
  single: () => Promise<ChainResult>;
  insert: (row: unknown) => ChainBuilder;
  update: (row: unknown) => ChainBuilder;
  delete: () => ChainBuilder;
  rpc: (fn: string, args?: unknown) => Promise<ChainResult>;
};

export interface SupabaseMockOptions {
  data?: unknown;
  error?: unknown;
  selectData?: unknown;
  maybeSingleData?: unknown;
}

export function createChainBuilder(opts: SupabaseMockOptions = {}): ChainBuilder {
  const chain: ChainBuilder = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    gt: () => chain,
    gte: () => chain,
    lt: () => chain,
    lte: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => Object.assign(Promise.resolve({ data: opts.data ?? [], error: null }), chain),
    range: () => Object.assign(Promise.resolve({ data: opts.data ?? [], error: null }), chain),
    maybeSingle: () => Promise.resolve({ data: opts.maybeSingleData ?? opts.data ?? null, error: null }),
    single: () => Promise.resolve({ data: opts.data ?? null, error: null }),
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    rpc: () => Promise.resolve({ data: opts.data ?? null, error: null }),
  };

  return chain;
}

export function createSupabaseMock(opts: SupabaseMockOptions = {}) {
  const chain = createChainBuilder(opts);

  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'test@test.com' } }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-token', user: { id: 'user-1', email: 'test@test.com' } } },
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@test.com' } },
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        subscription: { unsubscribe: vi.fn() },
      }),
    },
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    }),
    removeChannel: vi.fn(),
  };
}

export function createAuthErrorMock(_method: 'signInWithPassword' | 'signUp' | 'resetPasswordForEmail') {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ subscription: { unsubscribe: vi.fn() } }),
    },
    from: vi.fn().mockReturnValue(createChainBuilder()),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  };
}
