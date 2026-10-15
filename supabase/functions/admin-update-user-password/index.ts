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
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "admin-update-user-password", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "admin-update-user-password", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (callerProfile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can change user passwords" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const callerOrgId = callerProfile?.organization_id;

    if (!callerOrgId) {
      return new Response(
        JSON.stringify({ error: "Admin has no organization" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { targetUserId, newPassword } = await req.json();

    if (!targetUserId || !newPassword) {
      return new Response(
        JSON.stringify({ error: "Target user ID and new password are required" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (typeof newPassword !== "string" || newPassword.length < 12) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 12 characters" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("organization_id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "Target user not found" }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetProfile.organization_id !== callerOrgId) {
      return new Response(
        JSON.stringify({ error: "Target user is not in your organization" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Failed to update password:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update password" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("admin-update-user-password error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
