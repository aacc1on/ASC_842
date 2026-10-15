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
      const ipLimit = await checkRateLimit(supabaseAdmin, "reopen-month-end", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "reopen-month-end", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can reopen month-end documents" }),
        { status: 403, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const { docId, reason } = await req.json();

    if (!docId || typeof docId !== "string") {
      return new Response(
        JSON.stringify({ error: "Document ID is required" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "A reason is required to reopen a month-end document" }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      token,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabaseUser.rpc("reopen_month_end", {
      p_doc_id: docId,
      p_reason: reason,
    });

    if (error) {
      console.error("Reopen failed:", error);
      return new Response(
        JSON.stringify({
          error: /Remove later months first/.test(error.message ?? "")
            ? error.message
            : "Failed to reopen month-end document",
        }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, document: data }),
      { headers: { ...ch, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("reopen-month-end error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
