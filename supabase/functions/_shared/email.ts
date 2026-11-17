// Weekly report emails, sent through Resend (https://resend.com).
import { ASSISTANT_LABELS, type Assistant } from "./plans.ts";

export function emailConfigured(): boolean {
  return Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("REPORT_FROM_EMAIL"));
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("REPORT_FROM_EMAIL"), to: [to], subject, html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// Rank used for "mentioned, but not in a ranked list".
export const MENTIONED_NO_RANK = 99;

export interface ReportData {
  businessName: string;
  city: string;
  score: number;
  previousScore: number | null;
  assistants: Assistant[];
  rows: { question: string; ranks: Partial<Record<Assistant, number | null | "error">> }[];
  competitors: { name: string; count: number }[] | null; // null = not on this plan
  fixes: { title: string; detail: string; impact: string }[];
  moreFixes: number; // fixes held back by the plan
  ctaUrl: string;
  ctaLabel: string;
  intro: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function reportSubject(d: ReportData): string {
  const change = d.previousScore === null ? "" : d.score >= d.previousScore ? ` (▲ ${d.score - d.previousScore})` : ` (▼ ${d.previousScore - d.score})`;
  return `${d.businessName}: AI visibility ${d.score}/100${change}`;
}

// Email clients need tables and inline styles; keep it simple and light-themed.
export function reportHtml(d: ReportData): string {
  const cell = (v: number | null | "error" | undefined) =>
    v === "error" ? "?" : v == null ? '<span style="color:#c0392b">—</span>' : v === 1 ? '<b style="color:#1e8e3e">#1</b>' : v >= MENTIONED_NO_RANK ? "✓" : `#${v}`;
  const change =
    d.previousScore === null
      ? ""
      : `<div style="font-size:14px;color:${d.score >= d.previousScore ? "#1e8e3e" : "#c0392b"}">${d.score >= d.previousScore ? "▲" : "▼"} ${Math.abs(d.score - d.previousScore)} pts since last check</div>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 28px 8px">
  <div style="font-size:15px;font-weight:600">✦ Spotlight</div>
  <h1 style="margin:16px 0 4px;font-size:22px">${esc(d.businessName)} · ${esc(d.city)}</h1>
  <p style="margin:0;color:#5f6368;font-size:15px">${esc(d.intro)}</p>
</td></tr>
<tr><td style="padding:16px 28px">
  <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#80868b">AI visibility score</div>
  <div style="font-size:40px;font-weight:700">${d.score}<span style="font-size:18px;color:#80868b">/100</span></div>
  ${change}
</td></tr>
<tr><td style="padding:8px 28px">
  <table role="presentation" width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    <tr style="color:#80868b;font-size:12px;text-transform:uppercase"><td>Customer question</td>${d.assistants.map((a) => `<td align="center">${ASSISTANT_LABELS[a]}</td>`).join("")}</tr>
    ${d.rows
      .map(
        (r) =>
          `<tr style="border-top:1px solid #e8eaed"><td>“${esc(r.question)}”</td>${d.assistants.map((a) => `<td align="center">${cell(r.ranks[a])}</td>`).join("")}</tr>`,
      )
      .join("")}
  </table>
</td></tr>
${
  d.competitors === null
    ? `<tr><td style="padding:16px 28px;color:#5f6368;font-size:14px">See which competitors beat you with the Growth plan.</td></tr>`
    : d.competitors.length
      ? `<tr><td style="padding:16px 28px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#80868b;margin-bottom:6px">Recommended instead of you most often</div>${d.competitors
          .map((c) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 12px;border-radius:99px;background:#f1f3f4;font-size:14px">${esc(c.name)}</span>`)
          .join("")}</td></tr>`
      : ""
}
${
  d.fixes.length
    ? `<tr><td style="padding:16px 28px"><h2 style="margin:0 0 8px;font-size:17px">This week's fixes</h2>${d.fixes
        .map(
          (f, i) =>
            `<div style="padding:12px 0;border-top:1px solid #e8eaed"><b>${i + 1}. ${esc(f.title)}</b> <span style="font-size:12px;color:${f.impact === "high" ? "#c0392b" : "#e37400"}">${esc(f.impact)} impact</span><div style="color:#5f6368;font-size:14px;margin-top:4px">${esc(f.detail)}</div></div>`,
        )
        .join("")}${d.moreFixes > 0 ? `<p style="color:#5f6368;font-size:14px">+ ${d.moreFixes} more fixes with the Growth plan.</p>` : ""}</td></tr>`
    : ""
}
<tr><td style="padding:16px 28px 32px"><a href="${esc(d.ctaUrl)}" style="display:inline-block;padding:12px 22px;border-radius:99px;background:#1c1d1f;color:#fff;text-decoration:none;font-weight:600">${esc(d.ctaLabel)}</a></td></tr>
</table>
<p style="color:#80868b;font-size:12px;margin:16px 0">AI answers change week to week. Spotlight checks ChatGPT, Claude, Gemini and Perplexity for you.</p>
</td></tr></table></body></html>`;
}
