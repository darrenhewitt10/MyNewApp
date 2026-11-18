import { supabase, getProfile, renderAvatar } from "/supabase.js?v=3";
import { ASSISTANT_LABELS, limitsFor } from "/plans.js?v=4";

const $ = (sel) => document.querySelector(sel);
const main = $(".dash");
const detail = $(".detail");
const detailEmpty = $(".detail-empty");

const state = {
  user: null,
  profile: { plan: "free", email_reports: true, stripe_customer_id: null },
  businesses: [],
  latestRuns: new Map(), // business_id -> latest run
  selectedId: null,
  pollTimer: null,
  doneRuns: [], // the selected business's finished checks, for the chart
};

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

// The OAuth redirect lands here with a ?code=...; supabase-js exchanges it for a session.
const params = new URLSearchParams(window.location.search);
const justSignedIn = params.has("code") || params.has("welcome");
const billing = params.get("billing");
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // Pass along any sign-in error (e.g. the user cancelled) so the login page can show it.
  window.location.replace(`/login.html${window.location.search}`);
} else {
  if (window.location.search) history.replaceState(null, "", "/dashboard.html");
  state.user = session.user;
  showUser(session.user);
  if (justSignedIn) playLightsOn(getProfile(session.user).firstName);
  main.hidden = false;
  await loadProfile();
  if (billing === "success") waitForUpgrade();
  if (billing === "cancelled") showBanner("Checkout cancelled. You haven’t been charged.");
  await loadBusinesses();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") window.location.replace("/login.html");
});
$("#sign-out").addEventListener("click", () => supabase.auth.signOut());

function showUser(user) {
  const profile = getProfile(user);
  $(".user-name").textContent = profile.name;
  $(".first-name").textContent = profile.firstName;
  renderAvatar($(".avatar"), profile);
}

// Welcome animation: a spotlight switches on and brightens the page, then fades away.
function playLightsOn(firstName) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const overlay = $(".lights-on");
  overlay.querySelector(".lo-name").textContent = firstName;
  overlay.hidden = false;
  document.body.classList.add("is-lighting-up");
  const finish = () => {
    overlay.remove();
    document.body.classList.remove("is-lighting-up");
  };
  overlay.addEventListener("animationend", (e) => { if (e.target === overlay) finish(); });
  overlay.addEventListener("click", finish); // tap to skip
  setTimeout(finish, 4000); // safety net
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build an element. Text always goes in as textContent, never as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Call an Edge Function and return its JSON, or throw with its error message.
async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await error.context.json();
      if (payload?.error) message = payload.error;
    } catch { /* not JSON */ }
    throw new Error(message);
  }
  return data;
}

function friendlyError(error) {
  const msg = error?.message ?? String(error);
  // Messages raised by the database's plan limits are written for people already.
  return msg.replace(/^.*?ERROR:\s*/, "");
}

function showMsg(el, text, ok) {
  el.hidden = false;
  el.textContent = text;
  el.className = `${el.className.replace(/\s*is-(ok|error)/g, "")} ${ok ? "is-ok" : "is-error"}`;
}

function showBanner(text, ok = false) {
  const b = $(".banner");
  b.textContent = text;
  b.className = `banner ${ok ? "is-ok" : ""}`;
  b.hidden = false;
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const limits = () => limitsFor(state.profile.plan);
const selected = () => state.businesses.find((b) => b.id === state.selectedId) ?? null;

// ---------------------------------------------------------------------------
// Plan & billing
// ---------------------------------------------------------------------------

async function loadProfile() {
  const { data } = await supabase
    .from("profiles")
    .select("plan, email_reports, stripe_customer_id")
    .eq("id", state.user.id)
    .maybeSingle();
  if (data) state.profile = { ...state.profile, ...data };
  renderPlan();
}

function renderPlan() {
  const plan = state.profile.plan;
  const l = limits();
  $(".plan-pill").textContent = `${l.name} plan`;
  $(".plan-note").textContent =
    plan === "free" ? "Your first report is free." : l.weekly ? "Weekly checks are on." : "";
  $("#upgrade-btn").hidden = plan === "growth" || plan === "multi";
  $("#upgrade-btn").textContent = plan === "starter" ? "Upgrade to Growth" : "Upgrade";
  $("#manage-billing").hidden = !state.profile.stripe_customer_id;
  $("#email-reports").checked = state.profile.email_reports !== false;
  $("#add-card").hidden = state.businesses.length >= l.maxBusinesses;
}

function showPlans() {
  const plans = $("#plans");
  plans.hidden = false;
  plans.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#upgrade-btn").addEventListener("click", showPlans);

document.querySelectorAll("[data-plan]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const { url } = await callFn("billing", { action: "checkout", plan: btn.dataset.plan });
      window.location.href = url;
    } catch (e) {
      showBanner(friendlyError(e));
      btn.disabled = false;
    }
  });
});

$("#manage-billing").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const { url } = await callFn("billing", { action: "portal" });
    window.location.href = url;
  } catch (err) {
    showBanner(friendlyError(err));
    e.target.disabled = false;
  }
});

// Stripe confirms the payment to our webhook a moment after checkout; wait for it.
async function waitForUpgrade() {
  showBanner("Thanks! Activating your plan…", true);
  for (let i = 0; i < 10 && state.profile.plan === "free"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    await loadProfile();
  }
  if (state.profile.plan === "free") {
    showBanner("Payment received. Your plan will switch on in a minute or two. Refresh to check.", true);
  } else {
    showBanner(`You’re on ${limits().name}. Weekly checks are on.`, true);
    if (state.selectedId) renderDetail();
  }
}

$("#email-reports").addEventListener("change", async (e) => {
  const { error } = await supabase.from("profiles").update({ email_reports: e.target.checked }).eq("id", state.user.id);
  if (error) {
    e.target.checked = !e.target.checked;
    showBanner(`Couldn’t save: ${friendlyError(error)}`);
  } else {
    state.profile.email_reports = e.target.checked;
  }
});

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

async function loadBusinesses() {
  const [{ data, error }, { data: runs }] = await Promise.all([
    supabase.from("businesses").select("id, name, city, category, website, google_profile_url, created_at, last_checked_at, next_check_at").order("created_at", { ascending: true }),
    supabase.from("check_runs").select("id, business_id, status, score, started_at, finished_at, error").order("started_at", { ascending: false }).limit(200),
  ]);

  const list = $(".biz-list");
  list.replaceChildren();
  if (error) {
    $(".biz-empty").textContent = `Couldn’t load businesses: ${error.message}`;
    $(".biz-empty").hidden = false;
    return;
  }
  state.businesses = data;
  state.latestRuns = new Map();
  for (const run of runs ?? []) if (!state.latestRuns.has(run.business_id)) state.latestRuns.set(run.business_id, run);

  $(".biz-empty").hidden = data.length > 0;
  for (const biz of data) {
    const run = state.latestRuns.get(biz.id);
    const badge =
      run?.status === "running" ? h("span", { class: "biz-badge" }, "Checking…")
      : run?.score != null ? h("span", { class: "biz-badge" }, `${run.score}/100`)
      : null;
    list.append(
      h("li", { class: biz.id === state.selectedId ? "is-selected" : "" },
        h("button", { class: "biz-select", type: "button", onclick: () => selectBusiness(biz.id) },
          h("strong", {}, biz.name),
          h("span", {}, [biz.category, biz.city].filter(Boolean).join(" · ")),
        ),
        badge,
      ),
    );
  }
  renderPlan();

  if (!data.some((b) => b.id === state.selectedId)) state.selectedId = data[0]?.id ?? null;
  if (state.selectedId) selectBusiness(state.selectedId, { refreshList: false });
  else {
    detail.hidden = true;
    detailEmpty.hidden = false;
  }
}

function selectBusiness(id, { refreshList = true } = {}) {
  state.selectedId = id;
  if (refreshList) {
    document.querySelectorAll(".biz-list li").forEach((li, i) => li.classList.toggle("is-selected", state.businesses[i]?.id === id));
  }
  renderDetail();
}

const normalizeUrl = (v) => {
  const s = v.trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

$("#business-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = form.querySelector(".form-msg");
  const button = form.querySelector("button");
  button.disabled = true;

  const row = {
    name: form.elements.name.value.trim(),
    city: form.elements.city.value.trim(),
    category: form.elements.category.value.trim() || null,
    website: normalizeUrl(form.elements.website.value),
    google_profile_url: normalizeUrl(form.elements.google_profile_url.value),
  };
  const { data: biz, error } = await supabase.from("businesses").insert(row).select("id").single();
  if (error) {
    button.disabled = false;
    showMsg(msg, `Couldn’t save: ${friendlyError(error)}`, false);
    if (/upgrade/i.test(error.message)) showPlans();
    return;
  }

  showMsg(msg, `✅ ${row.name} added. Writing your customer questions…`, true);
  form.reset();
  state.selectedId = biz.id;
  try {
    await callFn("generate-questions", { business_id: biz.id });
  } catch (err) {
    console.warn("Question suggestions failed:", err); // the first check writes them instead
  }
  // Start the first check straight away; if checks aren't available yet, the
  // scheduler picks the business up as soon as they are.
  try {
    await callFn("run-checks", { business_id: biz.id });
    showMsg(msg, `✅ ${row.name} added. Your first check has started.`, true);
  } catch {
    showMsg(msg, `✅ ${row.name} added. Your first check is queued.`, true);
  }
  button.disabled = false;
  await loadBusinesses();
});

$("#delete-biz").addEventListener("click", async () => {
  const biz = selected();
  if (!biz) return;
  if (!confirm(`Stop tracking ${biz.name}? Its questions, results and history will be deleted.`)) return;
  const { error } = await supabase.from("businesses").delete().eq("id", biz.id);
  if (error) {
    showBanner(`Couldn’t remove ${biz.name}: ${friendlyError(error)}`);
    return;
  }
  state.selectedId = null;
  await loadBusinesses();
});

// ---------------------------------------------------------------------------
// The selected business's report
// ---------------------------------------------------------------------------

async function renderDetail() {
  clearTimeout(state.pollTimer);
  const biz = selected();
  if (!biz) return;
  detailEmpty.hidden = true;
  detail.hidden = false;

  $(".d-name").textContent = biz.name;
  $(".d-meta").textContent = [biz.category, biz.city].filter(Boolean).join(" · ");

  const [{ data: runs }, { data: fixes }, { data: questions }] = await Promise.all([
    supabase.from("check_runs").select("id, status, score, mention_rate, assistants, started_at, finished_at, error").eq("business_id", biz.id).order("started_at", { ascending: false }).limit(60),
    supabase.from("fixes").select("id, area, impact, title, detail, done, position, created_at").eq("business_id", biz.id).order("position"),
    supabase.from("questions").select("id, text, active, source, created_at").eq("business_id", biz.id).order("created_at"),
  ]);
  if (state.selectedId !== biz.id) return; // the user switched businesses meanwhile

  const allRuns = (runs ?? []).reverse(); // newest 60, oldest first
  const done = allRuns.filter((r) => r.status === "done");
  const latestDone = done.at(-1) ?? null;
  const latest = allRuns.at(-1) ?? null;

  renderRunStatus(biz, latest, latestDone);
  state.doneRuns = done;
  renderStats(done);
  renderChart(done);
  const results = latestDone
    ? (await supabase.from("results").select("question, question_id, assistant, mentioned, rank, competitors, answer, error").eq("run_id", latestDone.id)).data ?? []
    : [];
  if (state.selectedId !== biz.id) return;
  renderResults(latestDone, results);
  renderCompetitors(results);
  renderFixes(fixes ?? []);
  renderQuestions(questions ?? []);

  if (latest?.status === "running") {
    state.pollTimer = setTimeout(async () => {
      await loadBusinesses();
    }, 15000);
  }
}

function renderRunStatus(biz, latest, latestDone) {
  const status = $(".run-status");
  const runBtn = $("#run-now");
  const l = limits();
  status.hidden = false;
  status.className = "run-status";
  runBtn.hidden = false;
  runBtn.disabled = false;

  if (latest?.status === "running") {
    status.classList.add("is-running");
    status.textContent = `Checking now: asking AI assistants your customer questions (started ${fmtDateTime(latest.started_at)}). This takes a few minutes.`;
    runBtn.disabled = true;
  } else if (latest?.status === "failed" && !latestDone) {
    status.classList.add("is-error");
    status.textContent = "The last check didn’t finish. We’ll try again automatically, or you can run it now.";
  } else if (!latestDone) {
    status.textContent = biz.next_check_at
      ? "Your first check is queued and will start within about 10 minutes."
      : "Run your first check to see where you stand.";
  } else if (!l.weekly) {
    status.textContent = `Your free report is ready (checked ${fmtDate(latestDone.finished_at ?? latestDone.started_at)}). Upgrade to track changes every week.`;
    runBtn.textContent = "Get weekly checks";
    runBtn.onclick = showPlans;
    return;
  } else {
    status.textContent = `Last checked ${fmtDate(latestDone.finished_at ?? latestDone.started_at)}.` +
      (biz.next_check_at ? ` Next automatic check ${fmtDate(biz.next_check_at)}.` : "");
  }
  runBtn.textContent = "Run check now";
  runBtn.onclick = runNow;
}

async function runNow() {
  const biz = selected();
  const btn = $("#run-now");
  btn.disabled = true;
  try {
    await callFn("run-checks", { business_id: biz.id });
    await loadBusinesses();
  } catch (e) {
    const status = $(".run-status");
    status.hidden = false;
    status.className = "run-status is-error";
    status.textContent = friendlyError(e);
    btn.disabled = false;
    if (/upgrade/i.test(e.message)) showPlans();
  }
}

function scoreColor(score) {
  return score >= 70 ? "var(--good)" : score >= 40 ? "var(--warn)" : "var(--bad)";
}

function renderStats(done) {
  const latest = done.at(-1);
  const prev = done.at(-2);
  const ring = $(".score-ring.big");
  if (!latest) {
    ring.style.setProperty("--pct", "0%");
    $(".s-score").textContent = "–";
    $(".s-score-sub").textContent = "No checks yet";
    $(".s-mention").textContent = "–";
    $(".s-change").textContent = "–";
    $(".s-change-sub").textContent = " ";
    return;
  }
  ring.style.setProperty("--pct", `${latest.score}%`);
  ring.style.setProperty("--ring", scoreColor(latest.score));
  $(".s-score").textContent = latest.score;
  $(".s-score-sub").textContent = latest.score >= 70 ? "AI assistants recommend you often" : latest.score >= 40 ? "You show up sometimes" : "You’re mostly missing";
  $(".s-mention").textContent = `${Math.round((latest.mention_rate ?? 0) * 100)}%`;
  const change = $(".s-change");
  if (prev) {
    const d = latest.score - prev.score;
    change.textContent = d === 0 ? "No change" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} pts`;
    change.style.color = d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : "";
    $(".s-change-sub").textContent = `vs ${fmtDate(prev.started_at)}`;
  } else {
    change.textContent = "First check";
    change.style.color = "";
    $(".s-change-sub").textContent = "Trend starts next week";
  }
}

// Score history: one series, so no legend; hover/focus shows the value.
function renderChart(done) {
  const box = $("#score-chart");
  box.replaceChildren();
  const points = done.slice(-12).map((r) => ({ score: r.score, date: r.finished_at ?? r.started_at }));
  if (points.length === 0) {
    box.append(h("p", { class: "muted chart-empty" }, "Your score history starts with your first check."));
    return;
  }

  const width = Math.max(280, box.clientWidth || 600);
  const height = 200;
  const pad = { top: 14, right: 16, bottom: 28, left: 34 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const x = (i) => pad.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.top + ih - (v / 100) * ih;
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "AI visibility score over time" });
  for (const v of [0, 50, 100]) {
    svg.append(s("line", { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: "grid" }));
    const t = s("text", { x: pad.left - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" });
    t.textContent = v;
    svg.append(t);
  }
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const i of labelIdx) {
    const t = s("text", { x: x(i), y: height - 8, class: "axis", "text-anchor": points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle" });
    t.textContent = fmtDate(points[i].date);
    svg.append(t);
  }
  if (points.length > 1) {
    svg.append(s("path", { d: points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" "), class: "line" }));
  }
  const cross = s("line", { y1: pad.top, y2: pad.top + ih, class: "crosshair", visibility: "hidden" });
  svg.append(cross);
  const dots = points.map((p, i) => {
    const c = s("circle", { cx: x(i), cy: y(p.score), r: 4, class: "dot" });
    svg.append(c);
    return c;
  });

  const tip = h("div", { class: "chart-tip", hidden: true });
  const show = (i) => {
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    dots.forEach((d, j) => d.classList.toggle("is-active", j === i));
    tip.replaceChildren(h("strong", {}, `${points[i].score}/100`), h("span", {}, fmtDate(points[i].date)));
    tip.hidden = false;
    const left = Math.min(Math.max(x(i), 50), width - 50);
    tip.style.left = `${left}px`;
    tip.style.top = `${y(points[i].score) - 12}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.classList.remove("is-active"));
    tip.hidden = true;
  };
  // The whole plot is the hit target: snap to the nearest check.
  const hit = s("rect", { x: pad.left - 10, y: 0, width: iw + 20, height, fill: "transparent", tabindex: 0 });
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    show(best);
  });
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(points.length - 1));
  hit.addEventListener("blur", hide);
  svg.append(hit);

  // Same data as a table for screen readers.
  const table = h("table", { class: "sr-only" },
    h("caption", {}, "AI visibility score by check"),
    h("tr", {}, h("th", {}, "Date"), h("th", {}, "Score")),
    points.map((p) => h("tr", {}, h("td", {}, fmtDate(p.date)), h("td", {}, p.score))),
  );
  box.append(svg, tip, table);
  if (points.length === 1) box.append(h("p", { class: "muted chart-note" }, "Your trend line appears after your second check."));
}

function renderResults(run, results) {
  const table = $(".results-table");
  table.replaceChildren();
  $(".results-empty").hidden = results.length > 0;
  if (!results.length) return;

  const assistants = (run.assistants?.length ? run.assistants : [...new Set(results.map((r) => r.assistant))]);
  const byQuestion = new Map();
  for (const r of results) {
    if (!byQuestion.has(r.question)) byQuestion.set(r.question, {});
    byQuestion.get(r.question)[r.assistant] = r;
  }

  table.append(h("thead", {}, h("tr", {}, h("th", {}, "Customer question"), assistants.map((a) => h("th", {}, ASSISTANT_LABELS[a] ?? a)))));
  const body = h("tbody");
  for (const [question, cells] of byQuestion) {
    const missed = assistants.every((a) => cells[a] && !cells[a].error && !cells[a].mentioned);
    body.append(
      h("tr", { class: missed ? "row-miss" : "" },
        h("td", {}, `“${question}”`),
        assistants.map((a) => {
          const r = cells[a];
          if (!r) return h("td", { class: "faint" }, "–");
          const label = r.error ? "!" : !r.mentioned ? "—" : r.rank ? `#${r.rank}` : "✓";
          const cls = r.error ? "faint" : !r.mentioned ? "" : r.rank === 1 ? "rank-top" : "muted";
          const title = r.error ? "This assistant didn’t answer" : !r.mentioned ? "Not mentioned" : r.rank ? `Recommended #${r.rank}` : "Mentioned";
          return h("td", {},
            h("button", { class: `cell-btn ${cls}`, type: "button", title, "aria-label": `${ASSISTANT_LABELS[a] ?? a}: ${title}. Read answer`, onclick: () => openAnswer(a, question, r) }, label),
          );
        }),
      ),
    );
  }
  table.append(body);
}

function openAnswer(assistant, question, result) {
  const dialog = $(".answer-dialog");
  dialog.querySelector(".answer-assistant").textContent = ASSISTANT_LABELS[assistant] ?? assistant;
  dialog.querySelector(".answer-question").textContent = `“${question}”`;
  const text = dialog.querySelector(".answer-text");
  text.replaceChildren();
  if (result.error) text.append(h("p", { class: "muted" }, "This assistant didn’t answer this time. It will be asked again on the next check."));
  else text.append(...(result.answer ?? "").split(/\n{2,}/).map((para) => h("p", {}, para)));
  dialog.showModal();
}
$(".answer-dialog").addEventListener("click", (e) => {
  if (e.target.matches("[data-close]") || e.target === e.currentTarget) e.currentTarget.close();
});

function renderCompetitors(results) {
  const chips = $(".competitor-chips");
  const note = $(".competitors-note");
  chips.replaceChildren();
  note.hidden = true;
  if (!results.length) {
    note.textContent = "After your first check, you’ll see who AI recommends instead of you.";
    note.hidden = false;
    return;
  }
  const counts = new Map();
  for (const r of results) {
    for (const name of new Set(r.competitors ?? [])) {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const entry = counts.get(key) ?? { name, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  if (!limits().competitorTracking) {
    note.replaceChildren(
      `${top.length} competitor${top.length === 1 ? " was" : "s were"} recommended instead of you. `,
      h("button", { class: "link-btn", type: "button", onclick: showPlans }, "See who with Growth →"),
    );
    note.hidden = false;
    return;
  }
  if (!top.length) {
    note.textContent = "No competitors were named. Nice.";
    note.hidden = false;
    return;
  }
  chips.append(...top.map((c) => h("span", { title: `Recommended in ${c.count} answer${c.count === 1 ? "" : "s"}` }, `${c.name} · ${c.count}`)));
}

const IMPACT_LABEL = { high: "High impact", medium: "Medium impact", low: "Low impact" };
const AREA_LABEL = { google: "Google profile", reviews: "Reviews", website: "Website", listings: "Listings", content: "Content", other: "Other" };

function renderFixes(fixes) {
  const list = $(".fix-list");
  const note = $(".fixes-note");
  list.replaceChildren();
  note.hidden = true;
  if (!fixes.length) {
    note.textContent = "Your fix list is written after each check.";
    note.hidden = false;
    return;
  }
  const max = limits().maxFixes;
  const open = fixes.filter((f) => !f.done);
  const shown = [...open.slice(0, max), ...fixes.filter((f) => f.done)];
  for (const fix of shown) {
    const id = `fix-${fix.id}`;
    list.append(
      h("li", { class: `fix-item ${fix.done ? "is-done" : ""}` },
        h("input", {
          type: "checkbox", id, checked: fix.done,
          onchange: async (e) => {
            const { error } = await supabase.from("fixes").update({ done: e.target.checked }).eq("id", fix.id);
            if (error) e.target.checked = !e.target.checked;
            else e.target.closest("li").classList.toggle("is-done", e.target.checked);
          },
        }),
        h("label", { for: id },
          h("span", { class: "fix-tags" },
            h("span", { class: `tag tag-${fix.impact === "high" ? "high" : fix.impact === "medium" ? "med" : "low"}` }, IMPACT_LABEL[fix.impact]),
            h("span", { class: "fix-area" }, AREA_LABEL[fix.area] ?? fix.area),
          ),
          h("strong", {}, fix.title),
          fix.detail ? h("span", { class: "fix-detail" }, fix.detail) : null,
        ),
      ),
    );
  }
  const hiddenCount = open.length - Math.min(open.length, max);
  if (hiddenCount > 0) {
    note.replaceChildren(`+ ${hiddenCount} more fix${hiddenCount === 1 ? "" : "es"} on your list. `, h("button", { class: "link-btn", type: "button", onclick: showPlans }, "Unlock the full list with Growth →"));
    note.hidden = false;
  }
}

function renderQuestions(questions) {
  const list = $(".q-list");
  list.replaceChildren();
  const max = limits().maxQuestions;
  const active = questions.filter((q) => q.active).length;
  $(".q-count").textContent = `${active} of ${max} active`;
  $("#suggest-questions").disabled = active >= max;

  if (!questions.length) {
    list.append(h("li", { class: "muted q-empty" }, "No questions yet. Tap “Suggest questions” or add your own."));
  }
  for (const q of questions) {
    list.append(
      h("li", { class: q.active ? "" : "is-paused" },
        h("span", { class: "q-text" }, q.text),
        h("button", { class: "link-btn", type: "button", onclick: () => updateQuestion(q.id, { active: !q.active }) }, q.active ? "Pause" : "Resume"),
        h("button", { class: "biz-remove", type: "button", "aria-label": `Remove question: ${q.text}`, onclick: () => deleteQuestion(q.id) }, "×"),
      ),
    );
  }
}

async function updateQuestion(id, changes) {
  const { error } = await supabase.from("questions").update(changes).eq("id", id);
  if (error) showMsg($(".q-msg"), friendlyError(error), false);
  else { $(".q-msg").hidden = true; renderDetail(); }
}

async function deleteQuestion(id) {
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) showMsg($(".q-msg"), friendlyError(error), false);
  else renderDetail();
}

$("#question-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim();
  if (!text || !state.selectedId) return;
  const { error } = await supabase.from("questions").insert({ business_id: state.selectedId, text, source: "custom" });
  if (error) {
    showMsg($(".q-msg"), friendlyError(error), false);
    return;
  }
  input.value = "";
  $(".q-msg").hidden = true;
  renderDetail();
});

$("#suggest-questions").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Writing questions…";
  try {
    const { added } = await callFn("generate-questions", { business_id: state.selectedId, count: 5 });
    showMsg($(".q-msg"), added.length ? `Added ${added.length} question${added.length === 1 ? "" : "s"}.` : "No new questions to add.", true);
  } catch (err) {
    showMsg($(".q-msg"), friendlyError(err), false);
  }
  btn.textContent = label;
  renderDetail();
});

// Redraw the chart at the new width when the window is resized.
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!detail.hidden) renderChart(state.doneRuns); }, 250);
});
