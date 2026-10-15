import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    testTimeout: 20000,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Placeholders only: unit tests must mock Supabase and never need real credentials.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts', 'src/hooks/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/utils/testSupabaseMock.ts'],
      thresholds: {
        lines: 60,
        perFile: false,
        'src/hooks/**': { lines: 70, branches: 60 },
        'src/utils/**': { lines: 90 },
        'src/utils/discountRate.ts': { lines: 85 },
        'src/utils/transactionGenerator.ts': { lines: 85 },
        'src/utils/financialReports.ts': { lines: 85 },
        'src/utils/leaseModification.ts': { lines: 85 },
      },
    },
  },
});
