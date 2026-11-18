// Turn a check's results into a prioritized, plain-English fix list.
import { z } from "npm:zod@4.1.12";
import { claudeConfigured, structured } from "./claude.ts";
import type { BusinessInfo } from "./questions.ts";

export type Area = "google" | "reviews" | "website" | "listings" | "content" | "other";
export type Impact = "high" | "medium" | "low";
export interface Fix {
  area: Area;
  impact: Impact;
  title: string;
  detail: string;
}

export interface FixInput {
  biz: BusinessInfo & { google_profile_url?: string | null };
  score: number;
  missedQuestions: string[];
  wonQuestions: string[];
  competitors: { name: string; count: number }[];
  websiteText: string | null;
}

const FixSchema = z.object({
  fixes: z.array(
    z.object({
      area: z.enum(["google", "reviews", "website", "listings", "content", "other"]),
      impact: z.enum(["high", "medium", "low"]),
      title: z.string().describe("A short instruction, under 90 characters, e.g. 'Add your Saturday hours to Google'"),
      detail: z.string().describe("Two or three plain sentences: why it matters and exactly how to do it"),
    }),
  ),
});

const SYSTEM =
  "You are Spotlight's local-visibility advisor. Small-business owners (not marketers) read your advice. " +
  "AI assistants recommend local businesses based on public signals: a complete Google Business Profile " +
  "(categories, services, hours, photos, Q&A), plenty of recent reviews that mention specific strengths, a website " +
  "that plainly says what the business offers, where, and for whom (with LocalBusiness structured data), consistent " +
  "name/address/phone across directories (Yelp, Apple Maps, Bing Places, industry sites), and mentions in local press " +
  "and 'best of' lists. Write specific, doable fixes in plain English, no jargon. Tie each fix to the questions the " +
  "business is missing where you can. Only claim something is missing from the website if the website text shows it. " +
  "Order fixes from highest to lowest impact.";

export async function generateFixes(input: FixInput, count = 8): Promise<Fix[]> {
  if (claudeConfigured()) {
    try {
      const out = await structured({
        system: SYSTEM,
        prompt: describe(input) + `\n\nWrite the ${count} most valuable fixes.`,
        schema: FixSchema,
        effort: "medium",
      });
      const fixes = (out?.fixes ?? [])
        .filter((f) => f.title.trim())
        .map((f) => ({ ...f, title: f.title.trim().slice(0, 200), detail: f.detail.trim().slice(0, 2000) }));
      if (fixes.length) return fixes.slice(0, count);
    } catch (e) {
      console.warn("Claude fix list failed, using standard fixes:", e);
    }
  }
  return ruleBasedFixes(input).slice(0, count);
}

function describe(i: FixInput): string {
  return [
    `Business: ${i.biz.name}, ${i.biz.city}${i.biz.category ? ` (${i.biz.category})` : ""}`,
    `Website: ${i.biz.website || "none given"}`,
    `Google Business Profile link: ${i.biz.google_profile_url || "none given"}`,
    `AI visibility score this week: ${i.score}/100`,
    `Questions where AI assistants did NOT recommend them:\n${list(i.missedQuestions)}`,
    `Questions where they WERE recommended:\n${list(i.wonQuestions)}`,
    `Competitors recommended instead, most often first:\n${list(i.competitors.map((c) => `${c.name} (${c.count}×)`))}`,
    i.websiteText ? `Their website, as text:\n<website>\n${i.websiteText}\n</website>` : "Their website could not be read.",
  ].join("\n\n");
}

function list(items: string[]): string {
  return items.length ? items.map((s) => `- ${s}`).join("\n") : "- (none)";
}

function ruleBasedFixes(i: FixInput): Fix[] {
  const fixes: Fix[] = [];
  const what = i.biz.category || "business";
  fixes.push({
    area: "google",
    impact: "high",
    title: "Complete every section of your Google Business Profile",
    detail: `Add your categories, a full list of services, opening hours (including holidays) and at least 10 recent photos. AI assistants use these details to match you to questions like "${i.missedQuestions[0] ?? `best ${what} in ${i.biz.city}`}".`,
  });
  fixes.push({
    area: "reviews",
    impact: "high",
    title: "Ask five recent customers for a Google review this week",
    detail: "A steady stream of fresh reviews is one of the strongest signals. Ask happy customers to mention what they came for, so reviews contain the words people search with.",
  });
  if (!i.biz.website) {
    fixes.push({
      area: "website",
      impact: "high",
      title: "Get a simple website that says what you do and where",
      detail: `Even a one-page site with your services, ${i.biz.city} address, hours and phone number gives AI assistants something to read and quote.`,
    });
  } else if (i.websiteText && /structured data: no/.test(i.websiteText)) {
    fixes.push({
      area: "website",
      impact: "medium",
      title: "Add LocalBusiness structured data to your website",
      detail: "This is a small code snippet that tells search engines and AI your name, address, hours and services in a machine-readable way. Most website builders have a setting or plugin for it.",
    });
  }
  if (i.missedQuestions.length) {
    fixes.push({
      area: "content",
      impact: "medium",
      title: "Answer the questions you're missing on your website",
      detail: `Add a short section or FAQ covering: ${i.missedQuestions.slice(0, 3).join("; ")}. Assistants recommend businesses whose pages clearly match the question.`,
    });
  }
  fixes.push({
    area: "listings",
    impact: "medium",
    title: "Make your name, address and phone identical everywhere",
    detail: "Check Yelp, Apple Maps, Bing Places, Facebook and industry directories. Small differences (Suite vs Ste, old phone numbers) make AI less confident it's the same business.",
  });
  if (i.competitors[0]) {
    fixes.push({
      area: "other",
      impact: "low",
      title: `See what ${i.competitors[0].name} does differently`,
      detail: `They were recommended ${i.competitors[0].count} time(s) this week. Compare their Google profile, review count and website with yours and close the gaps.`,
    });
  }
  return fixes;
}
