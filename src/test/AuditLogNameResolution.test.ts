import { describe, it, expect } from 'vitest';
import { resolveRecordLabel } from '../hooks/useAuditLog';

describe('resolveRecordLabel', () => {
  it('returns resolved label from the map', () => {
    const labels = new Map([['branches:4c34d53e', 'Brooklyn']]);
    expect(resolveRecordLabel('branches', '4c34d53e', labels)).toBe('Brooklyn');
  });

  it('returns (deleted branch) for unresolved branch record', () => {
    expect(resolveRecordLabel('branches', 'nonexistent-id', new Map())).toBe('(deleted branch)');
  });

  it('returns (deleted lease) for unresolved lease record', () => {
    expect(resolveRecordLabel('leases', 'nonexistent-id', new Map())).toBe('(deleted lease)');
  });

  it('returns (deleted company) for unresolved company record', () => {
    expect(resolveRecordLabel('companies', 'nonexistent-id', new Map())).toBe('(deleted company)');
  });

  it('returns (deleted user) for unresolved user_profiles record', () => {
    expect(resolveRecordLabel('user_profiles', 'nonexistent-id', new Map())).toBe('(deleted user)');
  });

  it('returns (deleted modification) for unresolved contract_modifications record', () => {
    expect(resolveRecordLabel('contract_modifications', 'nonexistent-id', new Map())).toBe('(deleted modification)');
  });

  it('returns truncated id for unknown table_name', () => {
    expect(resolveRecordLabel('unknown_table', 'abcdef1234567890', new Map())).toBe('abcdef12');
  });
});
