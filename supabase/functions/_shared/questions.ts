// Turn a business into the questions its customers would ask an AI assistant.
import { z } from "npm:zod@4.1.12";
import { claudeConfigured, structured } from "./claude.ts";

export interface BusinessInfo {
  name: string;
  city: string;
  category?: string | null;
  website?: string | null;
}

const QuestionsSchema = z.object({
  questions: z.array(z.string()).describe("Customer questions, one per item"),
});

const SYSTEM =
  "You write the questions real customers type into AI assistants like ChatGPT when looking for a local business. " +
  "Write them the way people actually ask: short, plain, sometimes casual. Mix broad questions " +
  "('best X in CITY') with specific needs (price, hours, occasions, dietary or accessibility needs, emergencies, " +
  "neighbourhoods). Every question must name the city or a neighbourhood in it, because assistants have no location. " +
  "Never include the business's own name: we want to see whether the assistant suggests it unprompted.";

export async function generateQuestions(biz: BusinessInfo, count: number, avoid: string[] = []): Promise<string[]> {
  if (claudeConfigured()) {
    try {
      const out = await structured({
        system: SYSTEM,
        prompt:
          `Business: ${biz.name}\nCity: ${biz.city}\n` +
          (biz.category ? `Type of business: ${biz.category}\n` : "") +
          (biz.website ? `Website: ${biz.website}\n` : "") +
          (avoid.length ? `\nAlready tracking (don't repeat these):\n${avoid.map((q) => `- ${q}`).join("\n")}\n` : "") +
          `\nWrite ${count} questions.`,
        schema: QuestionsSchema,
        effort: "medium",
      });
      const cleaned = clean(out?.questions ?? [], biz, avoid);
      if (cleaned.length) return cleaned.slice(0, count);
    } catch (e) {
      console.warn("Claude question generation failed, using templates:", e);
    }
  }
  return clean(templateQuestions(biz), biz, avoid).slice(0, count);
}

function clean(questions: string[], biz: BusinessInfo, avoid: string[]): string[] {
  const seen = new Set(avoid.map((q) => q.toLowerCase().trim()));
  const ownName = biz.name.toLowerCase();
  const out: string[] = [];
  for (const raw of questions) {
    const q = raw.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
    const key = q.toLowerCase();
    if (q.length < 3 || q.length > 300 || seen.has(key) || key.includes(ownName)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

// Used when no Anthropic key is set, or Claude is unavailable.
function templateQuestions(biz: BusinessInfo): string[] {
  const what = (biz.category || "local business").toLowerCase();
  const c = biz.city;
  return [
    `What's the best ${what} in ${c}?`,
    `Can you recommend a good ${what} in ${c}?`,
    `Top rated ${what} near ${c}`,
    `Affordable ${what} in ${c}`,
    `Which ${what} in ${c} has the best reviews?`,
    `Best ${what} in ${c} open on weekends`,
    `I'm new to ${c} — where should I go for a ${what}?`,
    `Most popular ${what} in ${c} right now`,
    `Family-friendly ${what} in ${c}`,
    `Highly recommended ${what} in downtown ${c}`,
    `Who is the most trusted ${what} in ${c}?`,
    `Best value ${what} in ${c}`,
  ];
}
