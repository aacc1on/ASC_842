import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "platform-admin-delete-user", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Your session has expired. Please sign in again.", code: "AUTH_EXPIRED" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "platform-admin-delete-user", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: isPlatformAdmin, error: platformAdminError } = await supabaseAdmin.rpc(
      "is_platform_admin_for_user",
      { target_user_id: user.id },
    );

    if (platformAdminError || isPlatformAdmin !== true) {
      return new Response(
        JSON.stringify({ error: "Only the platform owner can delete users.", code: "NOT_PLATFORM_ADMIN" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { targetUserId } = await req.json();

    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(
        JSON.stringify({ error: "Target user ID is required.", code: "MISSING_ID" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetUserId === user.id) {
      return new Response(
        JSON.stringify({ error: "You cannot delete your own account from here.", code: "SELF_DELETE" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, email, organization_id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "User not found.", code: "NOT_FOUND" }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const [leaseCount, customerCount] = await Promise.all([
      supabaseAdmin.from("leases").select("id", { count: "exact", head: true }).eq("user_id", targetUserId),
      supabaseAdmin.from("stripe_customers").select("user_id", { count: "exact", head: true }).eq("user_id", targetUserId),
    ]);

    if (leaseCount.error || customerCount.error) {
      console.error("Failed to check owned records:", leaseCount.error ?? customerCount.error);
      return new Response(
        JSON.stringify({ error: "Failed to remove user account.", code: "DELETE_FAILED" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const leases = leaseCount.count ?? 0;
    const customers = customerCount.count ?? 0;
    if (leases > 0 || customers > 0) {
      const reasons = [
        leases > 0 ? `${leases} lease${leases === 1 ? "" : "s"}` : null,
        customers > 0 ? "a billing record" : null,
      ].filter(Boolean).join(" and ");
      return new Response(
        JSON.stringify({
          error: `This user can't be deleted because they still own ${reasons}. Their accounting and billing history is protected.`,
          code: "HAS_OWNED_RECORDS",
        }),
        { status: 409, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data: ownedCompanies, error: companiesError } = await supabaseAdmin
      .from("companies")
      .select("organization_id")
      .eq("user_id", targetUserId);
    const companyOrgIds = [...new Set((ownedCompanies ?? []).map((c) => c.organization_id).filter(Boolean))];

    const [ownedPeriods, ownedDocs, companyOrgPeriods] = await Promise.all([
      supabaseAdmin.from("accounting_periods").select("id", { count: "exact", head: true })
        .eq("user_id", targetUserId).in("status", ["locked", "closed"]),
      supabaseAdmin.from("month_end_documents").select("id", { count: "exact", head: true })
        .eq("user_id", targetUserId).in("status", ["posted", "finalized", "closed"]),
      companyOrgIds.length > 0
        ? supabaseAdmin.from("accounting_periods").select("id", { count: "exact", head: true })
          .in("organization_id", companyOrgIds).in("status", ["locked", "closed"])
        : Promise.resolve({ count: 0, error: null }),
    ]);

    const postedError = companiesError ?? ownedPeriods.error ?? ownedDocs.error ?? companyOrgPeriods.error;
    if (postedError) {
      console.error("Failed to check posted months:", postedError);
      return new Response(
        JSON.stringify({ error: "Failed to remove user account.", code: "DELETE_FAILED" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if ((ownedPeriods.count ?? 0) > 0 || (ownedDocs.count ?? 0) > 0 || (companyOrgPeriods.count ?? 0) > 0) {
      return new Response(
        JSON.stringify({
          error: "This user can't be deleted because their company has posted months. Use the platform-owner deletion with confirmation.",
          code: "HAS_POSTED_MONTHS",
        }),
        { status: 409, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteAuthError) {
      console.error("Failed to delete auth user:", deleteAuthError);
      return new Response(
        JSON.stringify({ error: "Failed to remove user account.", code: "DELETE_FAILED" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin
      .from("user_profiles")
      .delete()
      .eq("user_id", targetUserId);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("platform-admin-delete-user error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred.", code: "UNEXPECTED" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
