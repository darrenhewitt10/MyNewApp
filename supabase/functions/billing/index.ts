// Start a Stripe Checkout for a plan, or open the Stripe billing portal.
// Body: { action: "checkout", plan: "starter" | "growth" } or { action: "portal" }
import { adminClient, env, getUser, json, preflight } from "../_shared/http.ts";
import { priceFor, stripe } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => ({}));
  const site = env("SITE_URL").replace(/\/$/, "");
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, stripe_customer_id, stripe_subscription_id")
    .eq("id", user.id)
    .single();

  try {
    if (body.action === "portal") {
      if (!profile?.stripe_customer_id) return json({ error: "No billing account yet." }, 400);
      const session = await stripe("POST", "billing_portal/sessions", {
        customer: profile.stripe_customer_id,
        return_url: `${site}/dashboard.html`,
      });
      return json({ url: session.url });
    }

    if (body.action === "checkout") {
      const price = priceFor(body.plan);
      if (!price) return json({ error: "That plan isn’t available to buy online." }, 400);
      // Already subscribed: change plans in the portal instead of a second subscription.
      if (profile?.stripe_subscription_id && profile.plan !== "free" && profile.stripe_customer_id) {
        const session = await stripe("POST", "billing_portal/sessions", {
          customer: profile.stripe_customer_id,
          return_url: `${site}/dashboard.html`,
        });
        return json({ url: session.url });
      }
      const session = await stripe("POST", "checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": 1,
        success_url: `${site}/dashboard.html?billing=success`,
        cancel_url: `${site}/dashboard.html?billing=cancelled`,
        client_reference_id: user.id,
        customer: profile?.stripe_customer_id ?? undefined,
        customer_email: profile?.stripe_customer_id ? undefined : user.email,
        "metadata[user_id]": user.id,
        "subscription_data[metadata][user_id]": user.id,
        allow_promotion_codes: true,
      });
      return json({ url: session.url });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("Billing error:", e);
    return json({ error: "Billing isn’t available right now. Please try again." }, 502);
  }
});
