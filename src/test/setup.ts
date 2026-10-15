import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Background error logging would write into whichever fake client the next test installs.
vi.mock('../utils/unknownErrorLog', () => ({ logUnknownError: vi.fn() }));
// Every test client acts as the golden organization; currentOrg.test.ts covers the real lookup.
vi.mock('../utils/currentOrg', async (orig) => ({
  ...(await orig<typeof import('../utils/currentOrg')>()),
  currentOrgId: vi.fn(() => Promise.resolve('00000000-0000-0000-0000-0000000000a1')),
}));

// Forms get a stand-in security check; TurnstileWidget.test.tsx covers the real widget.
vi.mock('../components/TurnstileWidget', async (orig) => {
  const { MockTurnstileWidget } = await import('./fixtures/turnstileMock');
  return { ...(await orig<typeof import('../components/TurnstileWidget')>()), TurnstileWidget: MockTurnstileWidget };
});

afterEach(async () => {
  cleanup();
  (await import('./fixtures/turnstileMockState')).resetTurnstileMock();
  vi.restoreAllMocks();
});
