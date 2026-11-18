// Runs a full Spotlight check: ask every assistant every question, read the
// answers, score them, write the fix list and email the report.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { analyzeAnswer, scoreResults, topCompetitors } from "./analyze.ts";
import { askAssistant, availableAssistants } from "./assistants.ts";
import { emailConfigured, MENTIONED_NO_RANK, reportHtml, reportSubject, sendEmail, type ReportData } from "./email.ts";
import { generateFixes } from "./fixes.ts";
import { mapLimit } from "./http.ts";
import { CHECK_INTERVAL_DAYS, limitsFor, PLANS, type Assistant } from "./plans.ts";
import { generateQuestions } from "./questions.ts";
import { fetchWebsiteText } from "./website.ts";

const CONCURRENCY = 12;
// Stop asking new questions after this long, so the run finishes inside the
// Edge Function's time limit. Unasked questions are recorded as skipped.
const TIME_BUDGET_MS = 300_000;

interface AskResult {
  questionId: string | null;
  question: string;
  assistant: Assistant;
  answer: string | null;
  mentioned: boolean;
  rank: number | null;
  competitors: string[];
  error: string | null;
}

async function askAll(
  questions: { id: string | null; text: string }[],
  assistants: Assistant[],
  businessName: string,
  city: string,
): Promise<AskResult[]> {
  const started = Date.now();
  const jobs = questions.flatMap((q) => assistants.map((a) => ({ q, a })));
  return mapLimit(jobs, CONCURRENCY, async ({ q, a }): Promise<AskResult> => {
    const base = { questionId: q.id, question: q.text, assistant: a };
    if (Date.now() - started > TIME_BUDGET_MS) {
      return { ...base, answer: null, mentioned: false, rank: null, competitors: [], error: "Skipped: out of time" };
    }
    try {
      const answer = await askAssistant(a, q.text);
      const analysis = await analyzeAnswer(answer, businessName, city);
      return { ...base, answer, ...analysis, error: null };
    } catch (e) {
      return { ...base, answer: null, mentioned: false, rank: null, competitors: [], error: String((e as Error).message ?? e).slice(0, 500) };
    }
  });
}

function reportRows(results: AskResult[]): ReportData["rows"] {
  const rows = new Map<string, ReportData["rows"][number]>();
  for (const r of results) {
    const row = rows.get(r.question) ?? { question: r.question, ranks: {} };
    row.ranks[r.assistant] = r.error ? "error" : r.mentioned ? (r.rank ?? MENTIONED_NO_RANK) : null;
    rows.set(r.question, row);
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Signed-up businesses
// ---------------------------------------------------------------------------

export interface BusinessRow {
  id: string;
  owner_id: string;
  name: string;
  city: string;
  category: string | null;
  website: string | null;
  google_profile_url: string | null;
}

export async function ensureQuestions(admin: SupabaseClient, biz: BusinessRow, plan: string): Promise<void> {
  const { count } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", biz.id);
  if ((count ?? 0) > 0) return;
  const texts = await generateQuestions(biz, limitsFor(plan).maxQuestions);
  if (texts.length) {
    await admin
      .from("questions")
      .insert(texts.map((text) => ({ business_id: biz.id, owner_id: biz.owner_id, text, source: "generated" })));
  }
}

export async function runBusinessCheck(
  admin: SupabaseClient,
  biz: BusinessRow,
  trigger: "scheduled" | "manual",
  existingRunId?: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("email, plan, email_reports")
    .eq("id", biz.owner_id)
    .single();
  const plan = profile?.plan ?? "free";
  const limits = limitsFor(plan);
  const assistants = availableAssistants(limits.assistants);

  let runId = existingRunId;
  if (!runId) {
    const { data: run, error } = await admin
      .from("check_runs")
      .insert({ business_id: biz.id, owner_id: biz.owner_id, trigger, status: "running", assistants })
      .select("id")
      .single();
    if (error) throw error;
    runId = run.id;
  } else {
    await admin.from("check_runs").update({ assistants }).eq("id", runId);
  }

  try {
    if (assistants.length === 0) throw new Error("No AI assistant API keys are configured.");

    await ensureQuestions(admin, biz, plan);
    const { data: questions } = await admin
      .from("questions")
      .select("id, text")
      .eq("business_id", biz.id)
      .eq("active", true)
      .order("created_at")
      .limit(limits.maxQuestions);
    if (!questions?.length) throw new Error("This business has no active questions.");

    const results = await askAll(questions, assistants, biz.name, biz.city);
    const { error: insertError } = await admin.from("results").insert(
      results.map((r) => ({
        run_id: runId,
        business_id: biz.id,
        owner_id: biz.owner_id,
        question_id: r.questionId,
        question: r.question,
        assistant: r.assistant,
        mentioned: r.mentioned,
        rank: r.rank,
        competitors: r.competitors,
        answer: r.answer?.slice(0, 20_000) ?? null,
        error: r.error,
      })),
    );
    if (insertError) throw insertError;

    if (results.every((r) => r.error)) throw new Error(`Every assistant call failed. First error: ${results[0]?.error}`);

    const { score, mentionRate } = scoreResults(results);
    const competitors = topCompetitors(results);
    const byQuestion = reportRows(results);
    const missed = byQuestion.filter((r) => Object.values(r.ranks).every((v) => v === null)).map((r) => r.question);
    const won = byQuestion.filter((r) => Object.values(r.ranks).some((v) => typeof v === "number")).map((r) => r.question);

    // The fix list: replace last week's open fixes, keep the ones already ticked off.
    const fixes = await generateFixes({
      biz,
      score,
      missedQuestions: missed,
      wonQuestions: won,
      competitors,
      websiteText: await fetchWebsiteText(biz.website),
    });
    await admin.from("fixes").delete().eq("business_id", biz.id).eq("done", false);
    if (fixes.length) {
      await admin.from("fixes").insert(
        fixes.map((f, i) => ({ ...f, business_id: biz.id, owner_id: biz.owner_id, run_id: runId, position: i })),
      );
    }

    const { data: previous } = await admin
      .from("check_runs")
      .select("score")
      .eq("business_id", biz.id)
      .eq("status", "done")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await admin
      .from("check_runs")
      .update({ status: "done", score, mention_rate: mentionRate, finished_at: new Date().toISOString() })
      .eq("id", runId);

    const now = new Date();
    await admin
      .from("businesses")
      .update({
        last_checked_at: now.toISOString(),
        // Free plan: one report, then no more automatic checks until they upgrade.
        next_check_at: limits.weekly ? new Date(now.getTime() + CHECK_INTERVAL_DAYS * 86_400_000).toISOString() : null,
      })
      .eq("id", biz.id);

    if (profile?.email && profile.email_reports && emailConfigured()) {
      const shownFixes = fixes.slice(0, limits.maxFixes);
      const site = Deno.env.get("SITE_URL") ?? "";
      const data: ReportData = {
        businessName: biz.name,
        city: biz.city,
        score,
        previousScore: previous?.score ?? null,
        assistants,
        rows: byQuestion,
        competitors: limits.competitorTracking ? competitors : null,
        fixes: shownFixes,
        moreFixes: fixes.length - shownFixes.length,
        ctaUrl: `${site}/dashboard.html`,
        ctaLabel: "Open your dashboard",
        intro:
          plan === "free"
            ? "Here’s your free AI visibility report. Upgrade to get it every week."
            : "Here’s what AI assistants said about you this week.",
      };
      try {
        await sendEmail(profile.email, reportSubject(data), reportHtml(data));
        await admin.from("check_runs").update({ report_sent_at: new Date().toISOString() }).eq("id", runId);
      } catch (e) {
        console.error("Report email failed:", e);
      }
    }
  } catch (e) {
    console.error(`Check for business ${biz.id} failed:`, e);
    await admin
      .from("check_runs")
      .update({ status: "failed", error: String((e as Error).message ?? e).slice(0, 1000), finished_at: new Date().toISOString() })
      .eq("id", runId);
  }
}

// ---------------------------------------------------------------------------
// Free checks requested from the landing page (no account yet)
// ---------------------------------------------------------------------------

const LEAD_QUESTIONS = 3;

export interface LeadRow {
  id: string;
  business: string;
  city: string;
  email: string;
}

export async function runLeadCheck(admin: SupabaseClient, lead: LeadRow): Promise<void> {
  try {
    const assistants = availableAssistants(PLANS.free.assistants);
    if (assistants.length === 0) throw new Error("No AI assistant API keys are configured.");
    if (!emailConfigured()) throw new Error("Email is not configured (RESEND_API_KEY / REPORT_FROM_EMAIL).");

    const biz = { name: lead.business, city: lead.city };
    const texts = await generateQuestions(biz, LEAD_QUESTIONS);
    const results = await askAll(texts.map((text) => ({ id: null, text })), assistants, lead.business, lead.city);
    const { score } = scoreResults(results);
    const competitors = topCompetitors(results, 3);
    const rows = reportRows(results);
    const fixes = await generateFixes(
      {
        biz,
        score,
        missedQuestions: rows.filter((r) => Object.values(r.ranks).every((v) => v === null)).map((r) => r.question),
        wonQuestions: rows.filter((r) => Object.values(r.ranks).some((v) => typeof v === "number")).map((r) => r.question),
        competitors,
        websiteText: null,
      },
      3,
    );

    const site = Deno.env.get("SITE_URL") ?? "";
    const data: ReportData = {
      businessName: lead.business,
      city: lead.city,
      score,
      previousScore: null,
      assistants,
      rows,
      competitors,
      fixes,
      moreFixes: 0,
      ctaUrl: `${site}/login.html`,
      ctaLabel: "Track this every week →",
      intro: `We asked ${assistants.length} AI assistants ${rows.length} questions your customers ask. Here’s what they said.`,
    };
    await sendEmail(lead.email, reportSubject(data), reportHtml(data));
    await admin.from("leads").update({ status: "sent", score, processed_at: new Date().toISOString() }).eq("id", lead.id);
  } catch (e) {
    console.error(`Free check for lead ${lead.id} failed:`, e);
    await admin
      .from("leads")
      .update({ status: "failed", error: String((e as Error).message ?? e).slice(0, 1000), processed_at: new Date().toISOString() })
      .eq("id", lead.id);
  }
}
