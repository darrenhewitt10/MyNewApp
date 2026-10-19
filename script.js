// Mobile nav toggle
const toggle = document.querySelector(".nav-toggle");
const links = document.getElementById("nav-links");

toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

links.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }
});

// Submit the visibility-check form to Netlify Forms without leaving the page.
// If JS fails, the form still posts normally and lands on /thanks.html.
const form = document.querySelector(".check-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const success = form.querySelector(".form-success");
  button.disabled = true;
  button.textContent = "Sending…";

  try {
    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(new FormData(form)).toString(),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    form.querySelectorAll(".field, .form-note, button").forEach((el) => (el.hidden = true));
    success.hidden = false;
  } catch {
    // Fall back to a normal form post
    form.submit();
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
