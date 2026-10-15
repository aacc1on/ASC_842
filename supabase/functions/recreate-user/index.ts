import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";
import { checkUserCapacity } from "../_shared/userCapacity.ts";

const ALLOWED_ROLES = ["admin", "manage", "view"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

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
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "recreate-user", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Your session has expired. Please sign in again.", code: "AUTH_EXPIRED" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "recreate-user", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can create users.", code: "NOT_ADMIN" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const callerOrgId = callerProfile.organization_id;
    if (!callerOrgId) {
      return new Response(
        JSON.stringify({ error: "Your account is not properly linked to an organization.", code: "NO_ORG" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    // Plan enforcement: adding users requires Enterprise or active Trial
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_key, status, trial_ends_at, current_period_end")
      .eq("organization_id", callerOrgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let planKey = "trial";
    if (sub && !subError) {
      if (sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date()) {
        planKey = "trial";
      } else if (sub.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date())) {
        planKey = sub.plan_key;
      } else if (sub.status === "past_due" && sub.current_period_end) {
        const graceEnd = new Date(sub.current_period_end);
        graceEnd.setDate(graceEnd.getDate() + 7);
        if (graceEnd > new Date()) planKey = sub.plan_key;
      }
    }

    if (planKey !== "enterprise" && planKey !== "trial") {
      return new Response(
        JSON.stringify({ error: "Multiple users require the Enterprise plan. Please upgrade to add team members.", code: "PLAN_RESTRICTED" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { email, password, role } = await req.json();

    const userLimitResponse = await checkUserCapacity(supabaseAdmin, callerOrgId, ch);
    if (userLimitResponse) return userLimitResponse;

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required.", code: "INVALID_EMAIL" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, code: "WEAK_PASSWORD" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (!role || !ALLOWED_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role. Must be one of: admin, manage, view.", code: "INVALID_ROLE" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { organization_id: callerOrgId },
    });

    if (error) {
      console.error("Failed to create auth user:", error);
      const msg = error.message || "";
      const limitAfterFailure = await checkUserCapacity(supabaseAdmin, callerOrgId, ch);
      if (limitAfterFailure) return limitAfterFailure;
      if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
        return new Response(
          JSON.stringify({ error: "This email is already registered. Use a different email or remove the existing user first.", code: "EMAIL_EXISTS" }),
          { status: 409, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to create user account.", code: "CREATE_FAILED" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (!data?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Failed to create user account" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const newUserId = data.user.id;

    const defaultPermissions = role === "admin"
      ? '{"create_edit_leases":true,"delete_leases":true,"create_transactions":true,"run_month_end":true,"manage_modifications":true,"upload_documents":true,"manage_user_roles":true,"access_user_management":true,"view_reports_documents":true,"view_leases_transactions":true}'
      : role === "manage"
      ? '{"create_edit_leases":true,"delete_leases":true,"create_transactions":true,"run_month_end":true,"manage_modifications":true,"upload_documents":true,"manage_user_roles":false,"access_user_management":false,"view_reports_documents":true,"view_leases_transactions":true}'
      : '{"create_edit_leases":false,"delete_leases":false,"create_transactions":false,"run_month_end":false,"manage_modifications":false,"upload_documents":false,"manage_user_roles":false,"access_user_management":false,"view_reports_documents":true,"view_leases_transactions":true}';

    const { error: upsertError } = await supabaseAdmin
      .from("user_profiles")
      .upsert({
        user_id: newUserId,
        email,
        organization_id: callerOrgId,
        role,
        permissions: JSON.parse(defaultPermissions),
      }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("Failed to upsert profile:", upsertError);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      const upsertMsg = upsertError.message || "";
      if (upsertMsg.includes("Your plan allows up to")) {
        return new Response(
          JSON.stringify({ error: upsertMsg, code: "USER_LIMIT" }),
          { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
      if (upsertMsg.includes("Multiple users require")) {
        return new Response(
          JSON.stringify({ error: "Adding users requires the Enterprise plan. Please upgrade to add team members.", code: "PLAN_RESTRICTED" }),
          { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to set up user profile. Please try again or contact support if it continues.", code: "PROFILE_FAILED" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: this handler must never touch organizations other than the
    // caller's. A previous revision enumerated every other organization and
    // deleted the ones with a single member, which destroyed other tenants'
    // accounts on each user creation.

    const { data: verifyProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("organization_id, role")
      .eq("user_id", newUserId)
      .maybeSingle();

    if (!verifyProfile || verifyProfile.organization_id !== callerOrgId || verifyProfile.role !== role) {
      console.error("Profile verification failed:", verifyProfile);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({ error: "Failed to create user with correct organization and role" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, userId: newUserId, email }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("recreate-user error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again or contact support if it continues.", code: "UNEXPECTED" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
