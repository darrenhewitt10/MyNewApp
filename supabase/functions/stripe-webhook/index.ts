// Stripe tells us about subscription changes here; we set the user's plan.
// Register this URL in Stripe (Developers → Webhooks) for the events:
//   checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted
import { adminClient, env, json } from "../_shared/http.ts";
import type { Plan } from "../_shared/plans.ts";
import { planForPrice, stripe, verifyStripeSignature } from "../_shared/stripe.ts";

const ACTIVE = new Set(["active", "trialing", "past_due"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const payload = await req.text();
  const ok = await verifyStripeSignature(payload, req.headers.get("Stripe-Signature"), env("STRIPE_WEBHOOK_SECRET"));
  if (!ok) return json({ error: "Bad signature" }, 400);

  const event = JSON.parse(payload);
  const admin = adminClient();

  try {
    let subscription: any = null;
    if (event.type === "checkout.session.completed" && event.data.object.subscription) {
      subscription = await stripe("GET", `subscriptions/${event.data.object.subscription}`);
    } else if (event.type.startsWith("customer.subscription.")) {
      subscription = event.data.object;
    }
    if (!subscription) return json({ received: true });

    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
    let userId: string | undefined = subscription.metadata?.user_id;
    if (!userId) {
      const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
      userId = data?.id;
    }
    if (!userId) {
      console.warn("Stripe event for unknown customer", customerId);
      return json({ received: true });
    }

    const paidPlan = planForPrice(subscription.items?.data?.[0]?.price?.id);
    const isActive = event.type !== "customer.subscription.deleted" && ACTIVE.has(subscription.status);
    const plan: Plan = isActive && paidPlan ? paidPlan : "free";

    const { error } = await admin
      .from("profiles")
      .update({
        plan,
        stripe_customer_id: customerId,
        stripe_subscription_id: isActive ? subscription.id : null,
      })
      .eq("id", userId);
    if (error) throw error;

    // Newly paid: start weekly checks for businesses that had stopped after the free report.
    if (plan !== "free") {
      await admin
        .from("businesses")
        .update({ next_check_at: new Date().toISOString() })
        .eq("owner_id", userId)
        .is("next_check_at", null);
    }
    return json({ received: true, plan });
  } catch (e) {
    console.error("Webhook handling failed:", e);
    return json({ error: "Webhook handling failed" }, 500); // Stripe retries
  }
});
