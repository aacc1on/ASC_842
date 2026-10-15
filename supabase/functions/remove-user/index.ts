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
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "remove-user", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "remove-user", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can remove users" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const callerOrgId = callerProfile.organization_id;
    if (!callerOrgId) {
      return new Response(
        JSON.stringify({ error: "Admin has no organization" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { targetUserId } = await req.json();

    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(
        JSON.stringify({ error: "Target user ID is required" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetUserId === user.id) {
      return new Response(
        JSON.stringify({ error: "You cannot remove yourself" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id, email")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetProfile.organization_id !== callerOrgId) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (targetProfile.role === "admin") {
      const { count: adminCount } = await supabaseAdmin
        .from("user_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", callerOrgId)
        .eq("role", "admin");

      if (adminCount !== null && adminCount <= 1) {
        return new Response(
          JSON.stringify({ error: "Cannot remove the last admin of the organization" }),
          { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteAuthError) {
      console.error("Failed to delete auth user:", deleteAuthError);
      return new Response(
        JSON.stringify({ error: "Failed to remove user account" }),
        { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin
      .from("user_profiles")
      .delete()
      .eq("user_id", targetUserId);

    await supabaseAdmin
      .from("audit_log")
      .insert({
        organization_id: callerOrgId,
        actor_user_id: user.id,
        table_name: "user_profiles",
        record_id: targetUserId,
        action: "DELETE",
        old_data: { email: targetProfile.email, role: targetProfile.role },
      });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("remove-user error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
