/** Sends errors the mapper could not explain to error_logs (fire-and-forget, rate limited by the reporter). */
export function logUnknownError(error: unknown, message: string): void {
  void Promise.all([import('./errorReporter'), import('../lib/supabase')])
    .then(([{ reportError }, { supabase }]) =>
      reportError(supabase, {
        message: `unmapped: ${message || 'empty error'}`,
        stack: error instanceof Error ? error.stack : undefined,
      }),
    )
    .catch(() => undefined);
}
