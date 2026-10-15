import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/supabase', () => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn().mockReturnValue({ subscription: { unsubscribe: vi.fn() } }),
      },
      from: vi.fn().mockReturnValue(mockChain),
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
      removeChannel: vi.fn(),
    },
  };
});

import { supabase } from '../lib/supabase';
import { AuditLogTab } from '../components/user/AuditLogTab';
import { ErrorLogTab } from '../components/user/ErrorLogTab';

const sampleAuditRows = [
  {
    id: 1,
    organization_id: 'org-1',
    actor_user_id: 'user-1',
    table_name: 'leases',
    record_id: 'lease-abc',
    action: 'INSERT',
    old_data: null,
    new_data: { id: 'lease-abc', lease_name: 'Test Lease' },
    changed_fields: null,
    created_at: '2026-09-29T10:00:00Z',
  },
  {
    id: 2,
    organization_id: 'org-1',
    actor_user_id: 'user-2',
    table_name: 'transactions',
    record_id: 'tx-xyz',
    action: 'UPDATE',
    old_data: { status: 'open' },
    new_data: { status: 'closed' },
    changed_fields: ['status'],
    created_at: '2026-09-28T14:00:00Z',
  },
];

const sampleErrorRows = [
  {
    id: 1,
    organization_id: 'org-1',
    user_id: 'user-1',
    message: 'TypeError: Cannot read properties of undefined',
    stack: 'Error: at Component (app.tsx:42)',
    route: '/leases',
    user_agent: 'Mozilla/5.0',
    created_at: '2026-09-29T10:00:00Z',
  },
  {
    id: 2,
    organization_id: 'org-1',
    user_id: 'user-2',
    message: 'Network error',
    stack: null,
    route: '/billing',
    user_agent: 'Mozilla/5.0',
    created_at: '2026-09-28T14:00:00Z',
  },
];

const sampleUsers = [
  { user_id: 'user-1', email: 'admin@test.com' },
  { user_id: 'user-2', email: 'manager@test.com' },
];

function mockFromQuery(data: unknown, error: null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as never);
}

function mockFromWithUserList(auditData: unknown, error: null = null) {
  let callCount = 0;
  vi.mocked(supabase.from).mockImplementation(() => {
    callCount++;
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(callCount === 1 ? { data: sampleUsers, error: null } : { data: auditData, error }),
    };
    return chain as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditLogTab', () => {
  it('renders audit log entries on load', async () => {
    mockFromWithUserList(sampleAuditRows);
    render(<AuditLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('leases')).toBeInTheDocument();
      expect(screen.getByText('transactions')).toBeInTheDocument();
    });
  });

  it('shows INSERT and UPDATE action badges', async () => {
    mockFromWithUserList(sampleAuditRows);
    render(<AuditLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('INSERT')).toBeInTheDocument();
      expect(screen.getByText('UPDATE')).toBeInTheDocument();
    });
  });

  it('opens details modal when clicking a row', async () => {
    mockFromWithUserList(sampleAuditRows);
    const user = userEvent.setup();
    render(<AuditLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('leases')).toBeInTheDocument();
    });

    const detailButtons = screen.getAllByRole('button');
    const detailBtn = detailButtons.find((btn) => btn.querySelector('.lucide-chevron-right'));
    if (detailBtn) {
      await user.click(detailBtn);
      await waitFor(() => {
        expect(screen.getByText('Audit Details')).toBeInTheDocument();
      });
    }
  });

  it('calls exportToCsv when Export CSV is clicked', async () => {
    mockFromWithUserList(sampleAuditRows);
    const user = userEvent.setup();

    const blobUrlSpy = vi.fn();
    URL.createObjectURL = blobUrlSpy.mockReturnValue('blob:mock');
    URL.revokeObjectURL = vi.fn();
    const linkClick = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as unknown as HTMLAnchorElement;
      if (tag === 'a') {
        el.click = linkClick;
      }
      return el;
    });

    render(<AuditLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Export CSV'));
    expect(blobUrlSpy).toHaveBeenCalled();
  });

  it('shows empty state when no rows', async () => {
    mockFromWithUserList([]);
    render(<AuditLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No audit log entries found.')).toBeInTheDocument();
    });
  });
});

describe('ErrorLogTab', () => {
  it('renders error log entries on load', async () => {
    mockFromQuery(sampleErrorRows);
    render(<ErrorLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('TypeError: Cannot read properties of undefined')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('expands stack trace when row is clicked', async () => {
    mockFromQuery(sampleErrorRows);
    const user = userEvent.setup();
    render(<ErrorLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('TypeError: Cannot read properties of undefined')).toBeInTheDocument();
    });

    await user.click(screen.getByText('TypeError: Cannot read properties of undefined'));
    await waitFor(() => {
      expect(screen.getByText(/Error: at Component/)).toBeInTheDocument();
    });
  });

  it('calls exportToCsv when Export CSV is clicked', async () => {
    mockFromQuery(sampleErrorRows);
    const user = userEvent.setup();

    const blobUrlSpy = vi.fn();
    URL.createObjectURL = blobUrlSpy.mockReturnValue('blob:mock');
    URL.revokeObjectURL = vi.fn();
    const linkClick = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as unknown as HTMLAnchorElement;
      if (tag === 'a') {
        el.click = linkClick;
      }
      return el;
    });

    render(<ErrorLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Export CSV'));
    expect(blobUrlSpy).toHaveBeenCalled();
  });

  it('shows empty state when no rows', async () => {
    mockFromQuery([]);
    render(<ErrorLogTab onError={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No errors logged.')).toBeInTheDocument();
    });
  });
});
