// On the landing page: if someone is signed in, swap "Log in" for their name and
// profile picture, linking to their dashboard.
import { supabase, getProfile, renderAvatar } from "/supabase.js";

const { data: { session } } = await supabase.auth.getSession();

// If Supabase sent someone here straight after Google sign-in (?code=...), the
// code has just been swapped for a session above, so take them to their dashboard.
if (session && new URLSearchParams(window.location.search).has("code")) {
  window.location.replace("/dashboard.html");
}

const login = document.querySelector(".nav-login");

if (session && login) {
  const profile = getProfile(session.user);
  const img = document.createElement("img");
  img.className = "avatar";
  img.alt = "";
  img.hidden = true;
  const name = document.createElement("span");
  name.className = "user-name";
  name.textContent = profile.name;

  login.href = "/dashboard.html";
  login.classList.add("nav-user");
  login.setAttribute("aria-label", `${profile.name} — go to your dashboard`);
  login.replaceChildren(img, name);
  renderAvatar(img, profile);
}
