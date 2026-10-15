import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LegalPage } from '../components/legal/LegalPage';

describe('published legal pages', () => {
  it('terms: shows the approved text, the plans table and the contact block with line breaks, and no draft note', () => {
    const { container } = render(<LegalPage doc="terms" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lease Accountant Terms of Service' })).toBeInTheDocument();
    expect(screen.queryByText(/Draft pending legal review/)).not.toBeInTheDocument();
    expect(screen.getByText('Version 2026-10-14')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Plan', 'Price (USD/month)', 'Leases', 'Users', 'Key Features']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Starter', 'Professional', 'Enterprise']);
    expect(within(rows[2]).getAllByRole('cell')[3].textContent).toBe('Up to 10');

    const contact = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.startsWith('MS Finance Group366'));
    expect(contact).toBeDefined();
    expect(contact!.querySelectorAll('br')).toHaveLength(3);
    expect(screen.getByText(/Annual billing receives a 15% discount/)).toBeInTheDocument();
  });

  it('privacy: renders all three tables and the contact block on separate lines', () => {
    const { container } = render(<LegalPage doc="privacy" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lease Accountant Privacy Policy' })).toBeInTheDocument();
    expect(screen.queryByText(/Draft pending legal review/)).not.toBeInTheDocument();
    expect(screen.getByText('Version 2026-10-15')).toBeInTheDocument();

    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(within(tables[0]).getAllByRole('row')).toHaveLength(7);
    expect(within(tables[1]).getAllByRole('row')).toHaveLength(7);
    expect(within(tables[2]).getAllByRole('row')).toHaveLength(6);
    const lastSubprocessor = within(tables[1]).getAllByRole('row')[6];
    expect(within(lastSubprocessor).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Resend', 'Authentication and service emails (sent through Supabase Auth)', 'Name and email address', 'USA']);
    expect(screen.queryByText('Supabase Auth email')).not.toBeInTheDocument();

    const contact = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.startsWith('MS Finance Group366'));
    expect(contact!.querySelectorAll('br')).toHaveLength(3);
    expect(screen.getByText('We do not sell personal information or share it for cross-context behavioral advertising.')).toBeInTheDocument();
  });
});
