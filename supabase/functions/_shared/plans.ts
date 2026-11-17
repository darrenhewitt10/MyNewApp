// What each plan includes. The database enforces the location and question limits
// too (see the tracking_engine migration), so keep the numbers in sync.

export type Plan = "free" | "starter" | "growth" | "multi";
export type Assistant = "chatgpt" | "claude" | "gemini" | "perplexity";

export interface PlanLimits {
  maxBusinesses: number;
  maxQuestions: number;
  assistants: Assistant[];
  weekly: boolean; // automatic weekly checks
  competitorTracking: boolean;
  maxFixes: number; // fixes shown and emailed (Infinity = full list)
}

export const PLANS: Record<Plan, PlanLimits> = {
  // One free first report, so owners see where they stand before paying.
  free: { maxBusinesses: 1, maxQuestions: 10, assistants: ["chatgpt", "claude", "gemini"], weekly: false, competitorTracking: true, maxFixes: 3 },
  starter: { maxBusinesses: 1, maxQuestions: 10, assistants: ["chatgpt", "claude", "gemini"], weekly: true, competitorTracking: false, maxFixes: 3 },
  growth: { maxBusinesses: 1, maxQuestions: 30, assistants: ["chatgpt", "claude", "gemini", "perplexity"], weekly: true, competitorTracking: true, maxFixes: Infinity },
  multi: { maxBusinesses: 1000, maxQuestions: 100, assistants: ["chatgpt", "claude", "gemini", "perplexity"], weekly: true, competitorTracking: true, maxFixes: Infinity },
};

export function limitsFor(plan: string | null | undefined): PlanLimits {
  return PLANS[(plan as Plan) in PLANS ? (plan as Plan) : "free"];
}

export const ASSISTANT_LABELS: Record<Assistant, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

// How long after a check the next automatic one is due.
export const CHECK_INTERVAL_DAYS = 7;
// Paid plans may also run one extra check by hand per this many hours.
export const MANUAL_RUN_COOLDOWN_HOURS = 24;
