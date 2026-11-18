// Runs AI visibility checks. Two callers:
//   * The scheduler (pg_cron, every 10 minutes) with the x-cron-secret header:
//     checks the most overdue business and processes one free-check lead.
//   * A signed-in user pressing "Run check now" for one of their businesses.
// Checks take minutes, so the work continues after the response is sent.
import { availableAssistants } from "../_shared/assistants.ts";
import { runBusinessCheck, runLeadCheck, type BusinessRow, type LeadRow } from "../_shared/checks.ts";
import { emailConfigured } from "../_shared/email.ts";
import { adminClient, getUser, json, preflight, runInBackground } from "../_shared/http.ts";
import { limitsFor, MANUAL_RUN_COOLDOWN_HOURS, PLANS } from "../_shared/plans.ts";

const BUSINESS_COLUMNS = "id, owner_id, name, city, category, website, google_profile_url";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = cronHeader ? (await admin.rpc("verify_cron_secret", { candidate: cronHeader })).data === true : false;

  if (isCron) {
    // A run that has been "running" for 20+ minutes died with its worker.
    await admin
      .from("check_runs")
      .update({ status: "failed", error: "Timed out", finished_at: new Date().toISOString() })
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 20 * 60_000).toISOString());

    // Don't claim work (and burn retries) until at least one assistant is set up.
    if (availableAssistants(PLANS.growth.assistants).length === 0) {
      return json({ skipped: "No AI assistant API keys are configured" });
    }

    const jobs: Promise<unknown>[] = [];
    const claimed: Record<string, string | null> = { business: null, lead: null };

    const { data: due } = await admin.rpc("claim_due_business");
    const biz = (due as BusinessRow[] | null)?.[0];
    if (biz) {
      const { count: running } = await admin
        .from("check_runs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", biz.id)
        .eq("status", "running");
      if (!running) {
        claimed.business = biz.id;
        jobs.push(runBusinessCheck(admin, biz, "scheduled"));
      }
    }

    // Free checks are delivered by email, so they wait in line until email is set up.
    if (emailConfigured()) {
      const { data: pending } = await admin.rpc("claim_pending_lead");
      const lead = (pending as LeadRow[] | null)?.[0];
      if (lead) {
        claimed.lead = lead.id;
        jobs.push(runLeadCheck(admin, lead));
      }
    }

    runInBackground(Promise.all(jobs));
    return json({ started: claimed });
  }

  // --- A signed-in user asking for a check now ---
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const { business_id } = await req.json().catch(() => ({}));
  if (typeof business_id !== "string") return json({ error: "business_id is required" }, 400);

  const { data: biz } = await admin
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("id", business_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!biz) return json({ error: "Business not found" }, 404);

  const { data: profile } = await admin.from("profiles").select("plan").eq("id", user.id).single();
  const limits = limitsFor(profile?.plan);
  if (availableAssistants(limits.assistants).length === 0) {
    return json({ error: "Checks aren’t switched on yet. Please try again later." }, 503);
  }

  const { data: runs } = await admin
    .from("check_runs")
    .select("status, started_at")
    .eq("business_id", biz.id)
    .order("started_at", { ascending: false })
    .limit(20);

  if (runs?.some((r) => r.status === "running")) {
    return json({ error: "A check is already running for this business." }, 409);
  }
  if (!limits.weekly && runs?.some((r) => r.status === "done")) {
    return json({ error: "Your free report is done. Upgrade to check every week.", upgrade: true }, 403);
  }
  const cooldownStart = Date.now() - MANUAL_RUN_COOLDOWN_HOURS * 3_600_000;
  if (limits.weekly && runs?.some((r) => r.status === "done" && Date.parse(r.started_at) > cooldownStart)) {
    return json({ error: `You can run one extra check every ${MANUAL_RUN_COOLDOWN_HOURS} hours.` }, 429);
  }

  const { data: run, error } = await admin
    .from("check_runs")
    .insert({ business_id: biz.id, owner_id: user.id, trigger: "manual", status: "running" })
    .select("id")
    .single();
  if (error) return json({ error: error.message }, 500);

  runInBackground(runBusinessCheck(admin, biz as BusinessRow, "manual", run.id));
  return json({ run_id: run.id }, 202);
});
