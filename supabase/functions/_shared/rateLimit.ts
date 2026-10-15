export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  "recreate-user": { limit: 10, windowSeconds: 600 },
  "remove-user": { limit: 10, windowSeconds: 600 },
  "admin-update-user-password": { limit: 10, windowSeconds: 600 },
  "platform-admin-edit-user": { limit: 10, windowSeconds: 600 },
  "platform-admin-delete-user": { limit: 10, windowSeconds: 600 },
  "export-backup": { limit: 5, windowSeconds: 3600 },
  "stripe-checkout": { limit: 20, windowSeconds: 3600 },
  "stripe-manage-subscription": { limit: 10, windowSeconds: 3600 },
  "stripe-customer-portal": { limit: 10, windowSeconds: 3600 },
  "stripe-change-plan": { limit: 20, windowSeconds: 3600 },
  "stripe-billing-sync": { limit: 60, windowSeconds: 3600 },
  "reopen-month-end": { limit: 10, windowSeconds: 3600 },
  "error-alert": { limit: 30, windowSeconds: 3600 },
  health: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitedFunction = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

interface RpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** First hop of X-Forwarded-For, else other proxy headers, else "unknown". */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimitKey(fn: RateLimitedFunction, subject: { userId?: string | null; ip?: string }): string {
  return subject.userId ? `${fn}:user:${subject.userId}` : `${fn}:ip:${subject.ip ?? "unknown"}`;
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Fails open: if the counter itself is unavailable the request proceeds,
 * so a limiter outage can never lock admins out of the app.
 */
export async function checkRateLimit(
  admin: RpcClient,
  fn: RateLimitedFunction,
  subject: { userId?: string | null; ip?: string },
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[fn];
  try {
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_key: rateLimitKey(fn, subject),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row !== "object") {
      console.error(`rate limiter unavailable for ${fn}:`, error?.message ?? "no result");
      return { allowed: true, retryAfter: 0 };
    }
    const r = row as { allowed?: unknown; retry_after?: unknown };
    return {
      allowed: r.allowed !== false,
      retryAfter: typeof r.retry_after === "number" ? r.retry_after : rule.windowSeconds,
    };
  } catch (e) {
    console.error(`rate limiter failed for ${fn}:`, e);
    return { allowed: true, retryAfter: 0 };
  }
}

export function tooManyRequests(headers: Record<string, string>, retryAfter: number): Response {
  const seconds = Math.max(1, Math.round(retryAfter));
  return new Response(
    JSON.stringify({
      error: `Too many requests. Please wait ${formatRetryAfter(seconds)} and try again.`,
      code: "RATE_LIMITED",
      retryAfter: seconds,
    }),
    {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json", "Retry-After": String(seconds) },
    },
  );
}
