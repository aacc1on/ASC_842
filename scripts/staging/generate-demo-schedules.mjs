#!/usr/bin/env node
// Staging RESET step: signs in as the demo user and generates schedules + journal entries for every demo lease
// via the app's calculation code and its save_lease / refresh_lease_journal_entries server functions.
// Needs SUPABASE_URL and SUPABASE_ANON_KEY. Never point this at production.
import { loadDemoSchedules } from './load-demo-schedules.mjs';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'StagingDemo-2026!';
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  process.exit(1);
}

async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? data.message || data.msg || data.error_description || data.error : data;
    throw new Error(`${method} ${path.split('?')[0]} failed (HTTP ${res.status}): ${detail || 'no details'}`);
  }
  return data;
}

function demoStore(token) {
  return {
    listLeases: () => request('/rest/v1/leases?select=*&order=lease_name.asc', { token }),
    async getLease(id) {
      const rows = await request(`/rest/v1/leases?select=*&id=eq.${encodeURIComponent(id)}`, { token });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`Lease ${id} could not be read back.`);
      return rows[0];
    },
    listSchedule: (id) =>
      request(`/rest/v1/amortization_schedules?select=*&lease_id=eq.${encodeURIComponent(id)}&order=period_number.asc`, { token }),
    rpc: (fn, args) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args }),
  };
}

try {
  const session = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  const token = session?.access_token;
  if (!token) throw new Error('Demo sign-in returned no session.');
  const { generateDemoSchedules } = await loadDemoSchedules();
  const results = await generateDemoSchedules(demoStore(token));
  for (const r of results) console.log(`${r.lease}: ${r.periods} schedule periods, ${r.journalEntries} journal entries`);
  console.log(`Generated schedules and journal entries for ${results.length} demo leases.`);
} catch (err) {
  console.error(`Demo schedule generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
