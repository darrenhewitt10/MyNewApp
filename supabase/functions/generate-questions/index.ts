// Suggest customer questions for one of the signed-in user's businesses and add
// them to its question list, up to the plan's limit.
import { adminClient, getUser, json, preflight } from "../_shared/http.ts";
import { limitsFor } from "../_shared/plans.ts";
import { generateQuestions } from "../_shared/questions.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => ({}));
  if (typeof body.business_id !== "string") return json({ error: "business_id is required" }, 400);

  const { data: biz } = await admin
    .from("businesses")
    .select("id, owner_id, name, city, category, website")
    .eq("id", body.business_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!biz) return json({ error: "Business not found" }, 404);

  const { data: profile } = await admin.from("profiles").select("plan").eq("id", user.id).single();
  const { maxQuestions } = limitsFor(profile?.plan);

  const { data: existing } = await admin.from("questions").select("text, active").eq("business_id", biz.id);
  const activeCount = (existing ?? []).filter((q) => q.active).length;
  const slots = maxQuestions - activeCount;
  if (slots <= 0) {
    return json({ error: `You’re tracking ${maxQuestions} questions, the most your plan allows. Pause or remove one first.` }, 400);
  }

  const wanted = Math.min(slots, Number.isInteger(body.count) && body.count > 0 ? body.count : slots);
  const texts = await generateQuestions(biz, wanted, (existing ?? []).map((q) => q.text));
  if (!texts.length) return json({ added: [] });

  const { data: added, error } = await admin
    .from("questions")
    .insert(texts.map((text) => ({ business_id: biz.id, owner_id: user.id, text, source: "generated" })))
    .select("id, text, active, source, created_at");
  if (error) return json({ error: error.message }, 400);
  return json({ added });
});
