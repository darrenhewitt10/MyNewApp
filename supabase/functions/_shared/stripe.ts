// Minimal Stripe REST client (form-encoded requests) and webhook signature check.
import { env } from "./http.ts";
import type { Plan } from "./plans.ts";

type Params = Record<string, string | number | boolean | undefined | null>;

export async function stripe<T = any>(method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? body : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe returned ${res.status}`);
  return data as T;
}

// Plan <-> Stripe price, configured with STRIPE_PRICE_STARTER / STRIPE_PRICE_GROWTH.
export function priceFor(plan: Plan): string | null {
  if (plan === "starter") return Deno.env.get("STRIPE_PRICE_STARTER") ?? null;
  if (plan === "growth") return Deno.env.get("STRIPE_PRICE_GROWTH") ?? null;
  return null;
}

export function planForPrice(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("STRIPE_PRICE_STARTER")) return "starter";
  if (priceId === Deno.env.get("STRIPE_PRICE_GROWTH")) return "growth";
  if (priceId === Deno.env.get("STRIPE_PRICE_MULTI")) return "multi";
  return null;
}

// Check the Stripe-Signature header (v1 HMAC-SHA256 of "timestamp.payload").
export async function verifyStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // replay window: 5 minutes

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
