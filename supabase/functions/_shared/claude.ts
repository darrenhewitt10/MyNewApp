// Claude, via the official Anthropic SDK. Used two ways:
//   1. As one of the assistants a customer might ask (askClaude).
//   2. As Spotlight's own analyst: writing questions, reading answers, and
//      drafting fix lists (structured()).
import Anthropic from "npm:@anthropic-ai/sdk@1.9.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.9.0/helpers/beta/zod";
import type { z } from "npm:zod@4.1.12";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5";

// If Claude's safety classifiers decline a request, the API re-runs it on
// Anthropic's recommended fallback model in the same call.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;
export function claudeConfigured(): boolean {
  return Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
}
function getClient(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

// Ask Claude a question the way a customer would, and return the plain answer.
export async function askClaude(question: string): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: question }],
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to answer");
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

// Get a JSON answer that matches `schema`. Returns null if Claude refused or the
// output could not be parsed, so callers can fall back to rule-based logic.
export async function structured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T> | null> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.prompt }],
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal") return null;
  return (response.parsed_output as z.infer<T> | null) ?? null;
}
