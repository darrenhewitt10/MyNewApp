// Ask each AI assistant a customer's question and return its plain-text answer.
// Each assistant is only used when its API key is set as an Edge Function secret.
import { askClaude, claudeConfigured } from "./claude.ts";
import type { Assistant } from "./plans.ts";

const TIMEOUT_MS = 60_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function askChatGPT(question: string): Promise<string> {
  const data = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    { model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini", messages: [{ role: "user", content: question }] },
  );
  return String(data.choices?.[0]?.message?.content ?? "").trim();
}

async function askGemini(question: string): Promise<string> {
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "" },
    { contents: [{ role: "user", parts: [{ text: question }] }] },
  );
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
}

async function askPerplexity(question: string): Promise<string> {
  const data = await postJson(
    "https://api.perplexity.ai/chat/completions",
    { Authorization: `Bearer ${Deno.env.get("PERPLEXITY_API_KEY")}` },
    { model: Deno.env.get("PERPLEXITY_MODEL") ?? "sonar", messages: [{ role: "user", content: question }] },
  );
  return String(data.choices?.[0]?.message?.content ?? "").trim();
}

const ASK: Record<Assistant, (q: string) => Promise<string>> = {
  chatgpt: askChatGPT,
  claude: askClaude,
  gemini: askGemini,
  perplexity: askPerplexity,
};

const CONFIGURED: Record<Assistant, () => boolean> = {
  chatgpt: () => Boolean(Deno.env.get("OPENAI_API_KEY")),
  claude: claudeConfigured,
  gemini: () => Boolean(Deno.env.get("GEMINI_API_KEY")),
  perplexity: () => Boolean(Deno.env.get("PERPLEXITY_API_KEY")),
};

// The assistants the plan includes that also have an API key set.
export function availableAssistants(wanted: Assistant[]): Assistant[] {
  return wanted.filter((a) => CONFIGURED[a]());
}

export function askAssistant(assistant: Assistant, question: string): Promise<string> {
  return ASK[assistant](question);
}
