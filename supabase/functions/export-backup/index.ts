import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, clientIp, tooManyRequests } from "../_shared/rateLimit.ts";

const BACKUP_TABLES = [
  "leases",
  "amortization_schedules",
  "lease_payment_schedules",
  "transactions",
  "lease_transactions",
  "journal_entries",
  "contract_modifications",
  "contract_cancellations",
  "lease_modifications",
  "lease_impairments",
  "accounting_policy_elections",
  "lessors",
  "branches",
  "fixed_asset_types",
  "documents",
  "month_end_documents",
  "accounting_periods",
  "audit_log",
  "month_end_catch_up_batches",
  "month_end_catch_up_lines",
];

// The API returns at most 1,000 rows per request, so every table is read in pages.
const PAGE_SIZE = 1000;

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
      const ipLimit = await checkRateLimit(supabaseAdmin, "export-backup", { ip: clientIp(req) });
      if (!ipLimit.allowed) return tooManyRequests(ch, ipLimit.retryAfter);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    const userLimit = await checkRateLimit(supabaseAdmin, "export-backup", { userId: user.id });
    if (!userLimit.allowed) return tooManyRequests(ch, userLimit.retryAfter);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can export backups" }),
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

    const backup: Record<string, unknown[]> = {};
    const tableCounts: Record<string, number> = {};

    for (const table of BACKUP_TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select("*")
          .eq("organization_id", callerOrgId)
          .order("id")
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          console.error(`Failed to export ${table}:`, error);
          return new Response(
            JSON.stringify({ error: `Backup failed while reading ${table}. Nothing was exported.` }),
            { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
          );
        }
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      backup[table] = rows;
      tableCounts[table] = rows.length;
    }

    await supabaseAdmin
      .from("audit_log")
      .insert({
        organization_id: callerOrgId,
        actor_user_id: user.id,
        table_name: "export-backup",
        record_id: "",
        action: "EXPORT",
        old_data: null,
        new_data: { table_counts: tableCounts } as Record<string, unknown>,
        changed_fields: null,
      });

    const payload = {
      organization_id: callerOrgId,
      exported_at: new Date().toISOString(),
      exported_by: user.email,
      table_counts: tableCounts,
      data: backup,
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        ...ch,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="backup-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    console.error("export-backup error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } }
    );
  }
});
