import { describe, it, expect } from 'vitest';
import type { Lease } from '../../types/lease';
import { formatLessorType, getLiab, getRou, nextSort, sortLeases } from './leaseListHelpers';

const lease = (over: Record<string, unknown>) => ({ id: String(over.id), ...over }) as unknown as Lease;

describe('leaseListHelpers', () => {
  it('toggles direction on the same column and picks a default for new columns', () => {
    expect(nextSort({ key: 'lease_name', dir: 'asc' }, 'lease_name')).toEqual({ key: 'lease_name', dir: 'desc' });
    expect(nextSort({ key: 'lease_name', dir: 'desc' }, 'lease_name')).toEqual({ key: 'lease_name', dir: 'asc' });
    expect(nextSort({ key: 'lease_name', dir: 'asc' }, 'payment_amount')).toEqual({ key: 'payment_amount', dir: 'desc' });
    expect(nextSort({ key: 'payment_amount', dir: 'desc' }, 'lessor_name')).toEqual({ key: 'lessor_name', dir: 'asc' });
  });

  it('sorts text and numeric columns without mutating the input', () => {
    const input = [
      lease({ id: 'a', lease_name: 'Bravo', payment_amount: '100' }),
      lease({ id: 'b', lease_name: 'Alpha', payment_amount: '300' }),
      lease({ id: 'c', lease_name: 'Charlie', payment_amount: null }),
    ];
    expect(sortLeases(input, 'lease_name', 'asc').map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(sortLeases(input, 'payment_amount', 'desc').map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(input.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by current balances and asset type, defaulting missing values', () => {
    const input = [
      lease({ id: 'a', currentBalances: { currentRouAsset: 50, currentLiability: 10 } }),
      lease({ id: 'b', fixed_asset_types: { type_name: 'Vehicles', type_code: 'V' } }),
      lease({ id: 'c', currentBalances: { currentRouAsset: 80, currentLiability: 90 } }),
    ];
    expect(getRou(input[1])).toBe(0);
    expect(getLiab(input[2])).toBe(90);
    expect(sortLeases(input, 'rou_asset', 'desc').map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(sortLeases(input, 'fixed_asset_type', 'desc').map((l) => l.id)[0]).toBe('b');
  });

  it('labels lessor types and passes unknown values through', () => {
    expect(formatLessorType('financial_institution')).toBe('Financial Institution');
    expect(formatLessorType('custom')).toBe('custom');
  });
});
