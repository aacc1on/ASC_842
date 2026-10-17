const LIVE_ORIGIN = "https://asc-842.onrender.com";

// Bolt preview runs on per-session subdomains of webcontainer-api.io.
function isBoltPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".webcontainer-api.io");
  } catch {
    return false;
  }
}

function configuredOrigins(): string[] {
  const raw = Deno.env.get("APP_ORIGINS") ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(LIVE_ORIGIN) ? list : [...list, LIVE_ORIGIN];
}

// Secure by default: Bolt previews are only accepted when the ALLOW_BOLT_PREVIEW secret is explicitly "true"
// (development/staging). With it unset, only APP_ORIGINS and the live site are allowed.
// LAUNCH: set the ALLOW_BOLT_PREVIEW secret to "false" (or leave it unset) so only APP_ORIGINS and the live site are allowed.
function boltPreviewAllowed(): boolean {
  return (Deno.env.get("ALLOW_BOLT_PREVIEW") ?? "false").trim().toLowerCase() === "true";
}

export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return configuredOrigins().includes(origin) || (boltPreviewAllowed() && isBoltPreviewOrigin(origin));
}

/** Unknown or missing origins get no Access-Control-Allow-* headers at all. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

export function preflightResponse(req: Request): Response {
  const headers = corsHeaders(req);
  if (!headers["Access-Control-Allow-Origin"]) return new Response(null, { status: 403, headers });
  return new Response(null, { status: 200, headers });
}
