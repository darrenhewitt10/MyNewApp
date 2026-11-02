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

// Fill an avatar <img> with the user's photo. If they have no photo, or Google only
// gave its plain letter placeholder, show a glowing Spotlight-style orb with their initials.
export function renderAvatar(img, profile) {
  const useOrb = () => {
    const orb = document.createElement("span");
    orb.className = "avatar avatar-orb";
    orb.setAttribute("aria-hidden", "true");
    orb.textContent = profile.initials || "?";
    img.replaceWith(orb);
  };
  if (!profile.avatarUrl) return useOrb();

  let triedWithCors = false;
  img.referrerPolicy = "no-referrer"; // Google profile images can refuse requests that send a referrer
  img.addEventListener("load", () => {
    let isLetter = false;
    try { isLetter = isLetterPlaceholder(img); } catch { /* image can't be inspected; show it as is */ }
    if (isLetter) useOrb();
    else img.hidden = false;
  });
  img.addEventListener("error", () => {
    if (triedWithCors) return useOrb();
    // The host didn't allow inspecting the image: load it plainly instead.
    triedWithCors = true;
    img.removeAttribute("crossorigin");
    img.src = profile.avatarUrl;
  });
  img.crossOrigin = "anonymous";
  img.src = profile.avatarUrl;
}

// Google's placeholder is one letter on a flat colour: very few distinct colours,
// with one colour covering most of the image. Real photos have many.
function isLetterPlaceholder(img) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const counts = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = Math.max(...counts.values());
  return counts.size <= 16 && top / (size * size) >= 0.5;
}
