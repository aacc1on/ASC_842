import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";

const VERSION = "2026.10.13-e1";

// Public uptime probe: reveals only liveness, never data or configuration.
Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...ch, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "Method not allowed" }, 405);

  const time = new Date().toISOString();
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const limit = await checkRateLimit(admin, "health", { ip: clientIp(req) });
    if (!limit.allowed) return tooManyRequests(ch, limit.retryAfter);

    const { data, error } = await admin.rpc("health_ping");
    const db = !error && data === true ? "ok" : "error";
    return json({ status: db === "ok" ? "ok" : "degraded", db, version: VERSION, time }, db === "ok" ? 200 : 503);
  } catch {
    return json({ status: "degraded", db: "error", version: VERSION, time }, 503);
  }
});
