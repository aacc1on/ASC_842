import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { Lease } from '../../types/lease';
import { buildDashboardRow } from '../../utils/leaseDashboard';
import { todayYmd } from '../../utils/leaseLifecycle';
import { LeaseDashboard } from './LeaseDashboard';

function lease(over: Partial<Lease>): Lease {
  return {
    lease_start_date: '2020-01-01', lease_end_date: '2099-12-31', lease_term_months: 12, payment_amount: 1000,
    payment_frequency: 'monthly', payment_timing: 'beginning', lease_classification: 'operating', status: 'active',
    component_policy: 'not_applicable', branch_id: 'b1', ...over,
  } as Lease;
}

const rows = [
  buildDashboardRow(lease({ id: 'f1', lease_name: 'Forklift', lease_classification: 'finance', payment_amount: 500, nonlease_component_amount: 20, component_policy: 'separate' }), [], 'Main', todayYmd()),
  buildDashboardRow(lease({ id: 'o1', lease_name: 'Office', payment_amount: 2000, branch_id: 'b2' }), [], 'North', todayYmd()),
  buildDashboardRow(lease({ id: 'o2', lease_name: 'Old Depot', lease_start_date: '2015-01-01', lease_end_date: '2016-12-31' }), [], 'Main', todayYmd()),
];
const branches = [{ id: 'b1', branch_name: 'Main' }, { id: 'b2', branch_name: 'North' }];

function renderDashboard(onOpenLease = vi.fn(), data = { rows, branches }) {
  render(<LeaseDashboard data={data} loading={false} error={null} onRetry={vi.fn()} onOpenLease={onOpenLease} />);
  return onOpenLease;
}

const section = (name: string) => screen.getByRole('rowgroup', { name });

describe('LeaseDashboard', () => {
  it('shows active leases grouped by type with subtotals, a grand total and dashes for no non-lease', () => {
    renderDashboard();
    expect(within(section('Finance leases')).getByText('Forklift')).toBeTruthy();
    expect(within(section('Operating leases')).getByText('Office')).toBeTruthy();
    expect(screen.queryByText('Old Depot')).toBeNull();
    expect(within(section('Finance leases')).getByText('Finance leases subtotal')).toBeTruthy();
    const grand = screen.getByText('Grand total').closest('tr') as HTMLElement;
    expect(within(grand).getByText('$30,000.00')).toBeTruthy();
    expect(within(grand).getByText('$240.00')).toBeTruthy();
    const officeRow = screen.getByText('Office').closest('tr') as HTMLElement;
    expect(within(officeRow).getAllByText('—')).toHaveLength(2);
  });

  it('filters by status, type and branch', () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText('Filter dashboard by status'), { target: { value: 'expired' } });
    expect(screen.getByText('Old Depot')).toBeTruthy();
    expect(screen.queryByText('Office')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter dashboard by status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Filter dashboard by lease type'), { target: { value: 'finance' } });
    expect(screen.queryByRole('rowgroup', { name: 'Operating leases' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter dashboard by lease type'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Filter dashboard by branch'), { target: { value: 'b2' } });
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.queryByText('Forklift')).toBeNull();
  });

  it('sorts when a column header is clicked', () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText('Filter dashboard by status'), { target: { value: 'all' } });
    const names = () => within(section('Operating leases')).getAllByRole('button').map((b) => b.textContent);
    expect(names()).toEqual(['Office', 'Old Depot']);
    fireEvent.click(screen.getByRole('button', { name: /Lease name/ }));
    expect(names()).toEqual(['Old Depot', 'Office']);
  });

  it('opens the lease when its name is clicked', () => {
    const onOpen = renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Forklift' }));
    expect(onOpen).toHaveBeenCalledWith(rows[0].lease);
  });

  it('shows an empty state when there are no leases', () => {
    renderDashboard(vi.fn(), { rows: [], branches: [] });
    expect(screen.getByText('No leases match these filters')).toBeTruthy();
    expect(screen.getByText('Add a lease to see it here.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Export to Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
