// The visibility-check form. It goes to two places:
//   * Spotlight's free-check function, which runs a short AI check and emails the report.
//   * Netlify Forms, as a backup record of every request.
// If JS fails, the form still posts normally to Netlify and lands on /thanks.html.
const FREE_CHECK_URL = "https://mmzkgsgwclgtqrpeectd.supabase.co/functions/v1/free-check";
const form = document.querySelector(".check-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const success = form.querySelector(".form-success");
  const note = form.querySelector(".form-note");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Sending…";

  const fields = Object.fromEntries(new FormData(form));
  const [check, netlify] = await Promise.allSettled([
    fetch(FREE_CHECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: fields.business, city: fields.city, email: fields.email, "bot-field": fields["bot-field"] }),
    }),
    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(new FormData(form)).toString(),
    }),
  ]);

  const checkRes = check.status === "fulfilled" ? check.value : null;
  // A clear "no" from our function (bad email, too many requests): show why.
  if (checkRes && checkRes.status >= 400 && checkRes.status < 500) {
    const { error } = await checkRes.json().catch(() => ({}));
    note.textContent = error || "Please check your details and try again.";
    note.classList.add("is-error");
    button.disabled = false;
    button.textContent = label;
    return;
  }

  if (checkRes?.ok || (netlify.status === "fulfilled" && netlify.value.ok)) {
    form.querySelectorAll(".field, .form-note, button").forEach((el) => (el.hidden = true));
    success.hidden = false;
  } else {
    form.submit(); // fall back to a normal form post
  }
});

// Fade sections in as they scroll into view
const revealTargets = document.querySelectorAll(".section-head, .card, .step, .plan, .report-card, .chat-card, .faq details");
revealTargets.forEach((el) => el.classList.add("reveal"));

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealTargets.forEach((el) => io.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("in"));
}

document.getElementById("year").textContent = new Date().getFullYear();
