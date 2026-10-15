import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";
import { deliverPendingAlerts, readAlertConfig, sendTestAlert } from "../_shared/alerts.ts";

// Delivers pending error alerts by email (RESEND_API_KEY) and/or ALERT_WEBHOOK_URL; {action:"test"} sends a test (platform owner only).
Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req);
  if (req.method === "OPTIONS") return preflightResponse(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...ch, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error("missing token") };

    if (authError || !user) {
      const ipLimit = await checkRateLimit(supabaseAdmin, "error-alert", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return json({ error: "Authentication failed" }, 401);
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "error-alert", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const body = await req.json().catch(() => null) as { action?: unknown } | null;
    const config = readAlertConfig();

    if (body?.action === "test") {
      const { data: isOwner, error: ownerError } = await supabaseAdmin.rpc("is_platform_admin_for_user", { target_user_id: user.id });
      if (ownerError || isOwner !== true) {
        return json({ error: "Only the platform owner can send a test alert.", code: "NOT_PLATFORM_ADMIN" }, 403);
      }
      const result = await sendTestAlert(supabaseAdmin, config);
      return json({ status: result.status, emailConfigured: Boolean(config.resendApiKey) });
    }

    const result = await deliverPendingAlerts(supabaseAdmin, config);
    return json(result);
  } catch (e) {
    console.error("error-alert failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "Failed to deliver alerts" }, 500);
  }
});
