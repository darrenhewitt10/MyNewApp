// The landing page's "Check my AI visibility" form. Saves the request; the
// scheduler (run-checks) runs a short check and emails the report.
// Public: no sign-in, so it is rate-limited.
import { adminClient, json, preflight } from "../_shared/http.ts";

const PER_EMAIL_PER_DAY = 3;
const GLOBAL_PER_HOUR = 60;

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const body = await req.json().catch(() => ({}));
  // Bots fill in the hidden field; pretend it worked.
  if (body["bot-field"]) return json({ ok: true });

  const business = String(body.business ?? "").trim();
  const city = String(body.city ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!business || business.length > 200 || !city || city.length > 200) {
    return json({ error: "Please enter your business name and city." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  const admin = adminClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

  const [{ count: perEmail }, { count: global }] = await Promise.all([
    admin.from("leads").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", dayAgo),
    admin.from("leads").select("id", { count: "exact", head: true }).gte("created_at", hourAgo),
  ]);
  if ((perEmail ?? 0) >= PER_EMAIL_PER_DAY || (global ?? 0) >= GLOBAL_PER_HOUR) {
    return json({ error: "We’re getting a lot of requests. Please try again in a little while." }, 429);
  }

  const { error } = await admin.from("leads").insert({ business, city, email });
  // 23505 = already requested; that's fine, the report is on its way.
  if (error && error.code !== "23505") {
    console.error("Saving lead failed:", error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
  return json({ ok: true });
});
