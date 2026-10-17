export interface PendingAlert {
  id: number;
  created_at: string;
  reason: string;
  error_count: number;
  sample_message: string | null;
  sample_source: string | null;
  sample_route: string | null;
  sample_org_id?: string | null;
  suppressed_count?: number | null;
}

interface RpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export interface AlertConfig {
  resendApiKey: string | null;
  emailTo: string;
  webhookUrl: string | null;
  appUrl: string;
}

export type DeliveryStatus = "sent" | "failed" | "not_configured" | "throttled";

export interface DeliveryResult {
  claimed: number;
  sent: number;
  failed: number;
  notConfigured: number;
  throttled: number;
}

export const RESEND_URL = "https://api.resend.com/emails";
export const ALERT_FROM = "Lease Accountant Alerts <alerts@ms-consult.us>";
export const DEFAULT_ALERT_EMAIL_TO = "minas@ms-consult.us";
export const DEFAULT_APP_URL = "https://asc-842.onrender.com";
export const EMAIL_THROTTLE_MINUTES = 15;
const TEST_THROTTLE_MINUTES = 1;

const SOURCE_LABELS: Record<string, string> = {
  save_lease: "Saving a lease",
  month_end: "Month-end",
  stripe_webhook: "Stripe payments",
  test: "Platform Admin test",
};

const optionalEnv = (name: string): string | null => Deno.env.get(name)?.trim() || null;

export function readAlertConfig(): AlertConfig {
  const to = optionalEnv("ALERT_EMAIL_TO");
  const origin = (optionalEnv("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).find((s) => s.startsWith("https://"));
  return {
    resendApiKey: Deno.env.get("RESEND_API_KEY")?.trim() || null,
    emailTo: to && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) ? to : DEFAULT_ALERT_EMAIL_TO,
    webhookUrl: optionalEnv("ALERT_WEBHOOK_URL"),
    appUrl: origin ?? DEFAULT_APP_URL,
  };
}

/** Strips anything that could identify a customer or leak a secret; keeps only a short first line. */
export function sanitizeAlertText(raw: string | null | undefined, max = 160): string {
  if (!raw) return "";
  let s = String(raw).split(/\r?\n/)[0];
  s = s
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [token]")
    .replace(/\b(sk|pk|rk|whsec|re)_[A-Za-z0-9_]{6,}/g, "[key]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|apikey)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/=\([^)]*\)/g, "=(...)")
    .replace(/"[^"]*"/g, '"..."')
    .replace(/'[^']*'/g, "'...'")
    .replace(/\b[A-Za-z0-9+/_-]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function maskOrgId(id: string | null | undefined): string {
  if (!id || id.length < 8) return "not recorded";
  return `${id.slice(0, 4)}****${id.slice(-4)}`;
}

export function alertTypeKey(alert: Pick<PendingAlert, "reason" | "sample_source">): string {
  if (alert.reason === "test") return "test";
  const source = (alert.sample_source ?? "general").replace(/[^a-z0-9_-]/gi, "").slice(0, 50) || "general";
  return `${alert.reason}:${source}`;
}

function whereLabel(alert: PendingAlert): string {
  if (alert.sample_source && SOURCE_LABELS[alert.sample_source]) return SOURCE_LABELS[alert.sample_source];
  return sanitizeAlertText(alert.sample_source ?? alert.sample_route ?? "", 80) || "Unknown";
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function buildAlertEmail(alert: PendingAlert, appUrl: string) {
  const isTest = alert.reason === "test";
  const type = isTest ? "Test alert" : alert.reason === "critical" ? "Critical error" : "Error spike";
  const severity = isTest ? "Info" : alert.reason === "critical" ? "Critical" : "Warning";
  const occurrences = alert.error_count + Number(alert.suppressed_count ?? 0);
  const rows: [string, string][] = [
    ["Alert type", type],
    ["Severity", severity],
    ["Time (UTC)", formatUtc(alert.created_at)],
    ["Function / screen", whereLabel(alert)],
    ["Message", sanitizeAlertText(alert.sample_message) || "(none)"],
    ["Organization", maskOrgId(alert.sample_org_id)],
    ["Occurrences", String(occurrences)],
  ];
  const link = `${appUrl.replace(/\/+$/, "")}/admin#error-alerts`;
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return {
    subject: `[Lease Accountant] ${severity}: ${type} - ${whereLabel(alert)}`,
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen Platform Admin > Error log: ${link}\n`,
    html: `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#475569"><b>${esc(k)}</b></td><td style="padding:4px 0;color:#0f172a">${esc(v)}</td></tr>`)
      .join("")}</table><p style="font-family:Arial,sans-serif;font-size:14px"><a href="${esc(link)}">Open Platform Admin &gt; Error log</a></p>`,
  };
}

export function buildAlertPayload(alert: PendingAlert) {
  const headline = alert.reason === "critical"
    ? `Critical error in ${alert.sample_source ?? "the app"}`
    : alert.reason === "test"
    ? "Test alert from Platform Admin"
    : `Error spike: ${alert.error_count} errors in 15 minutes`;
  const detail = sanitizeAlertText(alert.sample_message, 300);
  return {
    text: `[Lease Accountant] ${headline}${detail ? ` - ${detail}` : ""}`,
    alert: {
      id: alert.id,
      reason: alert.reason,
      errorCount: alert.error_count,
      source: alert.sample_source,
      organization: maskOrgId(alert.sample_org_id),
      message: detail,
      createdAt: alert.created_at,
    },
  };
}

export function isValidWebhookUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, label: string): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    return res.ok ? null : `${label} responded ${res.status}`;
  } catch (e) {
    return `${label}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Sends one alert by email (Resend) and optional webhook, at most once per alert type per window. */
export async function deliverAlert(
  admin: RpcClient,
  alert: PendingAlert,
  config: AlertConfig,
  fetchImpl: FetchLike = fetch,
  windowMinutes = EMAIL_THROTTLE_MINUTES,
): Promise<{ status: DeliveryStatus; error: string | null }> {
  const emailOn = Boolean(config.resendApiKey);
  const hookOn = isValidWebhookUrl(config.webhookUrl);
  if (!emailOn && !hookOn) return { status: "not_configured", error: "No alert email key or webhook configured" };

  const { data: granted, error: slotError } = await admin.rpc("claim_alert_email_slot", {
    p_alert_type: alertTypeKey(alert),
    p_window_minutes: windowMinutes,
  });
  if (slotError) return { status: "failed", error: `throttle check failed: ${slotError.message}` };
  if (granted !== true) return { status: "throttled", error: null };

  const errors: string[] = [];
  let delivered = false;
  if (emailOn) {
    const email = buildAlertEmail(alert, config.appUrl);
    const err = await post(fetchImpl, RESEND_URL, { Authorization: `Bearer ${config.resendApiKey}` }, {
      from: ALERT_FROM,
      to: [config.emailTo],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }, "Email");
    if (err) errors.push(err); else delivered = true;
  }
  if (hookOn) {
    const err = await post(fetchImpl, config.webhookUrl as string, {}, buildAlertPayload(alert), "Webhook");
    if (err) errors.push(err); else delivered = true;
  }
  return { status: delivered ? "sent" : "failed", error: errors.length ? errors.join("; ") : null };
}

export async function deliverPendingAlerts(
  admin: RpcClient,
  config: AlertConfig,
  fetchImpl: FetchLike = fetch,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { claimed: 0, sent: 0, failed: 0, notConfigured: 0, throttled: 0 };
  const { data, error } = await admin.rpc("claim_pending_error_alerts");
  if (error) throw new Error(`claim failed: ${error.message}`);
  const alerts = Array.isArray(data) ? (data as PendingAlert[]) : [];
  result.claimed = alerts.length;

  for (const alert of alerts) {
    const { status, error: deliveryError } = await deliverAlert(admin, alert, config, fetchImpl);
    await admin.rpc("mark_error_alert", deliveryError
      ? { p_id: alert.id, p_status: status, p_error: deliveryError }
      : { p_id: alert.id, p_status: status });
    if (status === "sent") result.sent++;
    else if (status === "failed") result.failed++;
    else if (status === "throttled") result.throttled++;
    else result.notConfigured++;
  }
  return result;
}

export function sendTestAlert(admin: RpcClient, config: AlertConfig, fetchImpl: FetchLike = fetch) {
  const alert: PendingAlert = {
    id: 0,
    created_at: new Date().toISOString(),
    reason: "test",
    error_count: 1,
    sample_message: "This is a test alert sent from Platform Admin. No action is needed.",
    sample_source: "test",
    sample_route: null,
    sample_org_id: null,
  };
  return deliverAlert(admin, alert, config, fetchImpl, TEST_THROTTLE_MINUTES);
}

/** Records a server-side error (which may raise an alert) and delivers any pending alert. Never throws. */
export async function logServerError(
  admin: RpcClient,
  source: string,
  message: string,
  config: AlertConfig,
): Promise<void> {
  try {
    await admin.from("error_logs").insert({ message: message.slice(0, 2000), source, route: source });
    await deliverPendingAlerts(admin, config);
  } catch (e) {
    console.error("logServerError failed:", e);
  }
}
