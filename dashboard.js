import { supabase } from "/supabase.js";

const main = document.querySelector(".dash");
const form = document.getElementById("business-form");
const formMsg = form.querySelector(".form-msg");
const list = document.querySelector(".biz-list");
const empty = document.querySelector(".biz-empty");

// The OAuth redirect lands here with a ?code=...; supabase-js exchanges it for a session.
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // Pass along any sign-in error (e.g. the user cancelled) so the login page can show it.
  window.location.replace(`/login.html${window.location.search}`);
} else {
  // Remove the one-time code from the address bar.
  if (window.location.search) history.replaceState(null, "", "/dashboard.html");
  showUser(session.user);
  main.hidden = false;
  loadBusinesses();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") window.location.replace("/login.html");
});

document.getElementById("sign-out").addEventListener("click", () => supabase.auth.signOut());

function showUser(user) {
  const meta = user.user_metadata ?? {};
  const name = meta.full_name || meta.name || user.email || "there";
  document.querySelector(".user-name").textContent = user.email ?? name;
  document.querySelector(".first-name").textContent = name.split(" ")[0];
  const avatarUrl = meta.avatar_url || meta.picture;
  if (avatarUrl) {
    const avatar = document.querySelector(".avatar");
    avatar.src = avatarUrl;
    avatar.hidden = false;
  }
}

async function loadBusinesses() {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, city, created_at")
    .order("created_at", { ascending: false });

  list.replaceChildren();
  if (error) {
    empty.textContent = `Couldn’t load businesses: ${error.message}`;
    empty.hidden = false;
    return;
  }
  empty.hidden = data.length > 0;

  for (const biz of data) {
    const li = document.createElement("li");
    const text = document.createElement("div");
    const strong = document.createElement("strong");
    const city = document.createElement("span");
    strong.textContent = biz.name;
    city.textContent = biz.city;
    text.append(strong, city);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "biz-remove";
    remove.setAttribute("aria-label", `Remove ${biz.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await supabase.from("businesses").delete().eq("id", biz.id);
      loadBusinesses();
    });

    li.append(text, remove);
    list.append(li);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;

  const name = form.elements.name.value.trim();
  const city = form.elements.city.value.trim();
  const { error } = await supabase.from("businesses").insert({ name, city });

  button.disabled = false;
  formMsg.hidden = false;
  if (error) {
    formMsg.textContent = `Couldn’t save: ${error.message}`;
    formMsg.className = "form-msg is-error";
    return;
  }
  formMsg.textContent = `✅ ${name} added. Your first report is on its way.`;
  formMsg.className = "form-msg is-ok";
  form.reset();
  loadBusinesses();
});
