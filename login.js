import { supabase } from "/supabase.js";

const errorBox = document.querySelector(".auth-error");
const buttons = document.querySelectorAll(".provider-btn");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

// Already signed in? Skip straight to the dashboard.
const { data } = await supabase.auth.getSession();
if (data.session) window.location.replace("/dashboard.html");

// Errors from the provider come back on the URL (e.g. the user cancelled).
const params = new URLSearchParams(window.location.search + window.location.hash.replace("#", "&"));
if (params.get("error_description")) showError(params.get("error_description"));

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    buttons.forEach((b) => (b.disabled = true));
    errorBox.hidden = true;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: button.dataset.provider,
      options: { redirectTo: `${window.location.origin}/dashboard.html` },
    });

    if (error) {
      showError(`Couldn’t start sign-in: ${error.message}`);
      buttons.forEach((b) => (b.disabled = false));
    }
  });
});
