// Shared Supabase client. The publishable key is safe to ship in the browser:
// row level security in the database decides what each signed-in user can see.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

const SUPABASE_URL = "https://mmzkgsgwclgtqrpeectd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_N502ml39iWf8BjEUc_0c_g_AddawCSM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: "pkce" },
});

// Name and profile picture from the signed-in user's Google profile (user_metadata).
export function getProfile(user) {
  const meta = user?.user_metadata ?? {};
  const name = meta.full_name || meta.name || user?.email || "there";
  const avatarUrl = meta.avatar_url || meta.picture || "";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return { name, firstName: name.split(" ")[0], avatarUrl, initials };
}

// Fill an avatar <img> with the user's picture, or swap in their initials if there isn't one.
export function renderAvatar(img, profile) {
  const fallback = () => {
    const span = document.createElement("span");
    span.className = "avatar avatar-initials";
    span.setAttribute("aria-hidden", "true");
    span.textContent = profile.initials || "?";
    img.replaceWith(span);
  };
  if (!profile.avatarUrl) return fallback();
  img.referrerPolicy = "no-referrer"; // Google profile images can refuse requests that send a referrer
  img.addEventListener("error", fallback, { once: true });
  img.src = profile.avatarUrl;
  img.hidden = false;
}
