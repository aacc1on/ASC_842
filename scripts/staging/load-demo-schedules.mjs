// Bundles demo-schedules.ts (and the app calculation modules it imports) in memory with esbuild and loads it,
// so Node scripts reuse the app's TypeScript engine without a separate build step or copied logic.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./demo-schedules.ts', import.meta.url));

// The calculation modules only reach the browser Supabase client from their unexpected-error logger; stub it out.
const stubBrowserClient = {
  name: 'stub-browser-supabase-client',
  setup(b) {
    b.onResolve({ filter: /\/lib\/supabase$/ }, () => ({ path: 'supabase-client-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase = null;', loader: 'js' }));
  },
};

export async function loadDemoSchedules() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    plugins: [stubBrowserClient],
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
