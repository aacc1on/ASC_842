export function userLimitMessage(max: number): string {
  return `Your plan allows up to ${max} users. Remove a user or contact us to add more.`;
}

interface CapacityClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

// The database trigger is the authoritative, lock-protected check; this pre-check gives a clear message
// instead of the generic error the auth service returns when that trigger rejects the new user.
export async function checkUserCapacity(
  supabaseAdmin: CapacityClient,
  orgId: string,
  ch: Record<string, string>,
): Promise<Response | null> {
  const { data, error } = await supabaseAdmin.rpc("org_user_capacity", { p_org: orgId });
  const used = (data as { used?: unknown } | null)?.used;
  const max = (data as { max?: unknown } | null)?.max;
  if (error || typeof used !== "number" || typeof max !== "number") {
    console.error("Failed to check user capacity:", error);
    return new Response(
      JSON.stringify({ error: "Could not check your plan's user limit. Please try again.", code: "CAPACITY_CHECK_FAILED" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
  if (used < max) return null;
  const message = max <= 1
    ? "Multiple users require the Enterprise plan. Please upgrade to add team members."
    : userLimitMessage(max);
  return new Response(
    JSON.stringify({ error: message, code: max <= 1 ? "PLAN_RESTRICTED" : "USER_LIMIT", used, max }),
    { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
  );
}
