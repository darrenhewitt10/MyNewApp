// Read an assistant's answer: which businesses did it recommend, in what order,
// and was ours one of them?
import { z } from "npm:zod@4.1.12";
import { claudeConfigured, structured } from "./claude.ts";

export interface Analysis {
  mentioned: boolean;
  rank: number | null; // 1 = first recommendation
  competitors: string[]; // other businesses recommended, in order
}

const AnalysisSchema = z.object({
  recommended: z.array(z.string()).describe("Every business the answer recommends or names, in the order given"),
  target_position: z
    .number()
    .int()
    .nullable()
    .describe("1-based position of the target business in `recommended`, or null if it is not there"),
});

const SYSTEM =
  "You read answers from AI assistants to local-business questions and list the businesses they recommend. " +
  "Match the target business generously: different capitalisation, punctuation, a missing 'The', an abbreviation, " +
  "or the name with its location appended all count as the target. A different business with a similar name does not.";

export async function analyzeAnswer(answer: string, businessName: string, city: string): Promise<Analysis> {
  if (!answer) return { mentioned: false, rank: null, competitors: [] };
  if (claudeConfigured()) {
    try {
      const out = await structured({
        system: SYSTEM,
        prompt:
          `Target business: ${businessName} (${city})\n\n` +
          `Assistant's answer:\n<answer>\n${answer}\n</answer>\n\n` +
          "List the recommended businesses in order, and give the target's position.",
        schema: AnalysisSchema,
        maxTokens: 2000,
      });
      if (out) {
        const pos = out.target_position && out.target_position <= out.recommended.length ? out.target_position : null;
        const competitors = out.recommended
          .filter((_, i) => i + 1 !== pos)
          .filter((name) => !sameBusiness(name, businessName))
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, 10);
        const mentioned = pos !== null || normalize(answer).includes(normalize(businessName));
        return { mentioned, rank: pos, competitors };
      }
    } catch (e) {
      console.warn("Claude analysis failed, using simple matching:", e);
    }
  }
  return simpleAnalysis(answer, businessName);
}

// Rule-based fallback: numbered/bulleted list items and bold names.
export function simpleAnalysis(answer: string, businessName: string): Analysis {
  const names: string[] = [];
  for (const line of answer.split("\n")) {
    const item = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (!item) continue;
    const bold = item[1].match(/\*\*(.+?)\*\*/);
    const name = (bold ? bold[1] : item[1].split(/\s[–—-]\s|:/)[0]).replace(/[*_#]/g, "").trim();
    if (name && name.length <= 80) names.push(name);
  }
  const idx = names.findIndex((n) => sameBusiness(n, businessName));
  const mentioned = idx >= 0 || normalize(answer).includes(normalize(businessName));
  return {
    mentioned,
    rank: idx >= 0 ? idx + 1 : null,
    competitors: names.filter((n) => !sameBusiness(n, businessName)).slice(0, 10),
  };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, "and")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameBusiness(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || (nb.length >= 4 && na.includes(nb)) || (na.length >= 4 && nb.includes(na));
}

// One number per check, 0-100: first pick scores highest, a mention lower down
// scores less, and a missing answer scores 0.
export function scoreResults(results: { mentioned: boolean; rank: number | null; error?: string | null }[]): {
  score: number;
  mentionRate: number;
} {
  const valid = results.filter((r) => !r.error);
  if (valid.length === 0) return { score: 0, mentionRate: 0 };
  const points = valid.map((r) => {
    if (!r.mentioned) return 0;
    if (r.rank === null) return 40;
    return [100, 80, 65, 50][r.rank - 1] ?? 35;
  });
  const score = Math.round(points.reduce((a, b) => a + b, 0) / valid.length);
  const mentionRate = valid.filter((r) => r.mentioned).length / valid.length;
  return { score, mentionRate };
}

// Competitors recommended most often across all answers.
export function topCompetitors(results: { competitors: string[] }[], limit = 5): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of results) {
    for (const name of new Set(r.competitors)) {
      const key = normalize(name);
      if (!key) continue;
      const entry = counts.get(key) ?? { name, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
