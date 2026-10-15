import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";

const ALLOWED_ROLES = ["admin", "manage", "view"];
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
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "platform-admin-edit-user", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Your session has expired. Please sign in again.", code: "AUTH_EXPIRED" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "platform-admin-edit-user", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: isPlatformAdmin, error: platformAdminError } = await supabaseAdmin.rpc(
      "is_platform_admin_for_user",
      { target_user_id: user.id },
    );

    if (platformAdminError || isPlatformAdmin !== true) {
      return new Response(
        JSON.stringify({ error: "Only the platform owner can edit users.", code: "NOT_PLATFORM_ADMIN" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { targetUserId, fullName, role, newPassword } = await req.json();

    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(
        JSON.stringify({ error: "Target user ID is required.", code: "MISSING_ID" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetUserId === user.id && role && role !== "admin") {
      return new Response(
        JSON.stringify({ error: "You cannot demote yourself.", code: "SELF_DEMOTE" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("email, role, organization_id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "User not found.", code: "NOT_FOUND" }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const updates: Record<string, unknown> = {};
    if (typeof fullName === "string") {
      updates.full_name = fullName;
    }
    if (role && ALLOWED_ROLES.includes(role) && role !== targetProfile.role) {
      updates.role = role;

      if (role === "admin") {
        updates.permissions = {
          view_leases_transactions: true, view_reports_documents: true,
          create_edit_leases: true, delete_leases: true, create_transactions: true,
          run_month_end: true, manage_modifications: true, upload_documents: true,
          manage_user_roles: true, access_user_management: true,
        };
      } else if (role === "manage") {
        updates.permissions = {
          view_leases_transactions: true, view_reports_documents: true,
          create_edit_leases: true, delete_leases: true, create_transactions: true,
          run_month_end: true, manage_modifications: true, upload_documents: true,
          manage_user_roles: false, access_user_management: false,
        };
      } else {
        updates.permissions = {
          view_leases_transactions: true, view_reports_documents: true,
          create_edit_leases: false, delete_leases: false, create_transactions: false,
          run_month_end: false, manage_modifications: false, upload_documents: false,
          manage_user_roles: false, access_user_management: false,
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("user_profiles")
        .update(updates)
        .eq("user_id", targetUserId);

      if (updateError) {
        console.error("Failed to update profile:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update user profile.", code: "UPDATE_FAILED" }),
          { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
    }

    if (newPassword && typeof newPassword === "string") {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, code: "WEAK_PASSWORD" }),
          { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }

      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        { password: newPassword }
      );

      if (pwError) {
        console.error("Failed to update password:", pwError);
        return new Response(
          JSON.stringify({ error: "Failed to update password.", code: "PASSWORD_FAILED" }),
          { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("platform-admin-edit-user error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred.", code: "UNEXPECTED" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
