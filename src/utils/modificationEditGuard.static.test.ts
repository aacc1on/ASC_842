import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find((f) => f.endsWith('_guard_modification_owner_org_status_on_edit.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

describe('database guard: edits cannot change owner, organization or status', () => {
  it('has the guard migration', () => {
    expect(file).toBeDefined();
  });

  it.each(['contract_modifications', 'contract_cancellations', 'lease_impairments'])('attaches the guard to %s before the approval trigger', (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TRIGGER a01_guard_workflow_fields BEFORE UPDATE ON public\\.${table}`));
    expect('a01_guard_workflow_fields' < 'aa_approval_workflow').toBe(true);
    expect('a00_set_organization_id' < 'a01_guard_workflow_fields').toBe(true);
  });

  it('rejects owner and organization changes, and status mixed with content edits', () => {
    expect(sql).toContain("The owner of this record cannot be changed");
    expect(sql).toContain("The organization of this record cannot be changed");
    expect(sql).toMatch(/\(v_new->'status'\) IS DISTINCT FROM \(v_old->'status'\)\s+AND \(v_new - v_workflow\) IS DISTINCT FROM \(v_old - v_workflow\)/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION internal\.guard_workflow_fields\(\) FROM PUBLIC, anon, authenticated/);
  });
});
