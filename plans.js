// What each plan includes, for the browser. Mirrors supabase/functions/_shared/plans.ts;
// the database and Edge Functions enforce the real limits.
export const PLANS = {
  free: { name: "Free", maxBusinesses: 1, maxQuestions: 10, assistants: ["chatgpt", "claude", "gemini"], weekly: false, competitorTracking: true, maxFixes: 3 },
  starter: { name: "Starter", maxBusinesses: 1, maxQuestions: 10, assistants: ["chatgpt", "claude", "gemini"], weekly: true, competitorTracking: false, maxFixes: 3 },
  growth: { name: "Growth", maxBusinesses: 1, maxQuestions: 30, assistants: ["chatgpt", "claude", "gemini", "perplexity"], weekly: true, competitorTracking: true, maxFixes: Infinity },
  multi: { name: "Multi-location", maxBusinesses: 1000, maxQuestions: 100, assistants: ["chatgpt", "claude", "gemini", "perplexity"], weekly: true, competitorTracking: true, maxFixes: Infinity },
};

export const limitsFor = (plan) => PLANS[plan] ?? PLANS.free;

export const ASSISTANT_LABELS = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity" };
