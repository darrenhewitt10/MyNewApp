# Spotlight

Landing page for **Spotlight** — shows local businesses whether AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend them, and helps them get recommended.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | The landing page |
| `styles.css` | All styles — the "Spotlight Glass" design (frosted glass over soft light orbs) |
| `script.js` | Mobile menu, free-check form (sends to the `free-check` function + Netlify Forms), scroll animations |
| `thanks.html` | Fallback page after the sign-up form is submitted without JavaScript |
| `login.html` / `login.js` | Log in with Google |
| `dashboard.html` / `dashboard.js` | Signed-in app: businesses, score, trend chart, results per assistant, competitors, fix list, questions, plan & billing |
| `plans.js` | What each plan includes, for the browser |
| `privacy.html` / `terms.html` | Privacy policy and terms of service |
| `supabase.js` | Supabase connection (project URL + publishable key) and profile helpers |
| `nav-user.js` | Shows the signed-in user's name and picture in the landing page nav |
| `supabase/migrations/` | Database schema |
| `supabase/functions/` | Edge Functions — the tracking engine (see below) |
| `supabase/setup/schedule-checks.sql` | One-time SQL that schedules the weekly checks |
| `favicon.svg` | Site icon |
| `netlify.toml` | Netlify config (no build step, publishes the repo root) |

Plain HTML/CSS/JS — no build tools. The Supabase library loads from a CDN.

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. Branch: `main`. Leave the build command empty. Publish directory: `.` (already set in `netlify.toml`).
3. Deploy.

## Sign-ups (Netlify Forms)

The hero form ("Check my AI visibility") uses [Netlify Forms](https://docs.netlify.com/forms/setup/). After the first deploy, submissions appear in the Netlify dashboard under **Forms → visibility-check**. Make sure form detection is enabled in **Site configuration → Forms**. You can add email notifications there too.

## Login (Supabase)

Supabase project: **spotlight** (`mmzkgsgwclgtqrpeectd`, region us-east-1).

Database tables (row level security on, so each user only sees their own rows):
- `profiles` — created automatically when someone signs up (email, name, avatar).
- `businesses` — the businesses each user tracks (name, city, type, website, Google profile, next check time).
- `questions`, `check_runs`, `results`, `fixes` — the tracking engine's data (see below).
- `leads` — free-check requests from the landing page (only the Edge Functions can read them).

### One-time setup in the Supabase dashboard

Google uses this **callback URL**:

```
https://mmzkgsgwclgtqrpeectd.supabase.co/auth/v1/callback
```

**1. URL configuration** — Authentication → URL Configuration
- Site URL: your Netlify URL, e.g. `https://your-site.netlify.app`
- Redirect URLs: add `https://your-site.netlify.app/dashboard.html` (and `http://localhost:8000/dashboard.html` for local testing)

**2. Google** — Authentication → Providers → Google
- In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** (type: Web application).
- Authorized JavaScript origins: your Netlify URL. Authorized redirect URI: the callback URL above.
- Paste the Client ID and Client Secret into Supabase and enable Google.

Until Google is enabled, clicking the button lands on a Supabase "provider is not enabled" error page.

Once signed in, the user's name and profile picture (from Google, via `user_metadata`) show in the dashboard header and in the landing page nav (`nav-user.js`).

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

(The form only saves submissions once deployed on Netlify.)

## The tracking engine

How a check works:

1. A user adds a business (name, city, type, optional website and Google profile link).
2. `generate-questions` writes 10–30 realistic customer questions with Claude (or templates if no Anthropic key is set). Users can edit, pause, add and remove them.
3. `run-checks` asks each question to ChatGPT, Claude, Gemini and Perplexity (whichever the plan includes **and** have an API key set), uses Claude to read each answer (was the business mentioned? at what position? who else was recommended?), and saves everything.
4. It scores the check 0–100, writes a prioritized fix list (Claude reads the business's website and the results), and emails the report through Resend.
5. The scheduler (pg_cron, authenticated by a secret kept in Vault) calls `run-checks` every 10 minutes; each call checks the most overdue business and processes one free-check lead. Paid plans are checked every 7 days. The free plan gets one report.

| Function | Called by | What it does |
| --- | --- | --- |
| `run-checks` | Scheduler (`x-cron-secret`) or a signed-in user ("Run check now") | Runs a check |
| `generate-questions` | Dashboard | Suggests customer questions |
| `free-check` | Landing page form (public, rate-limited) | Queues a free 3-question check, emailed to the visitor |
| `billing` | Dashboard | Opens Stripe Checkout or the billing portal |
| `stripe-webhook` | Stripe | Sets the user's plan when they subscribe, change or cancel |

Plans (also enforced by the database): **Free** — 1 location, 10 questions, one report. **Starter** — weekly, ChatGPT/Claude/Gemini, top 3 fixes. **Growth** — 30 questions, all four assistants, competitor tracking, full fix list. **Multi-location** — set by hand (see below).

### One-time setup

**1. Database.** Apply `supabase/migrations/20261117000000_tracking_engine.sql` (Supabase dashboard → SQL editor, or `supabase db push`). It adds plans, questions, check runs, results, fixes and leads, and turns on `pg_cron` and `pg_net`.

**2. Secrets.** Supabase dashboard → Edge Functions → Secrets:

| Secret | Needed for |
| --- | --- |
| `SITE_URL` | Links in emails and Stripe redirects, e.g. `https://your-site.netlify.app` |
| `ANTHROPIC_API_KEY` | Claude as an assistant, and for questions, answer reading and fix lists |
| `OPENAI_API_KEY` | ChatGPT |
| `GEMINI_API_KEY` | Gemini |
| `PERPLEXITY_API_KEY` | Perplexity (Growth and Multi-location) |
| `RESEND_API_KEY`, `REPORT_FROM_EMAIL` | Report emails, e.g. `Spotlight <reports@yourdomain.com>` (a domain verified in Resend) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH` | Stripe price IDs for the $49 and $99 monthly plans (optional `STRIPE_PRICE_MULTI`) |

Optional: `CLAUDE_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`, `PERPLEXITY_MODEL` to change which model each assistant uses.

Assistants without a key are simply skipped, so you can start with one or two.

**3. Deploy the functions** with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase functions deploy --project-ref mmzkgsgwclgtqrpeectd
```

`supabase/config.toml` already turns off the gateway's JWT check for `run-checks`, `free-check` and `stripe-webhook`, which authenticate callers themselves.

**4. Schedule the checks.** Run `supabase/setup/schedule-checks.sql` in the SQL editor. It generates the scheduler's secret inside Vault, so there's nothing to copy.

**5. Stripe.** Create two monthly prices (Starter $49, Growth $99) and copy their IDs into the secrets. Add a webhook endpoint at `https://mmzkgsgwclgtqrpeectd.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`, and copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Turn on the customer portal (Settings → Billing → Customer portal).

**Multi-location customers:** set their plan by hand in the SQL editor:

```sql
update public.profiles set plan = 'multi' where email = 'customer@example.com';
```

### Limits to know about

- A check runs inside one Edge Function call. It stops asking new questions after 5 minutes and records the rest as skipped, so very large Multi-location question lists may need the paid Supabase plan's longer function time limit.
- The assistants are called through their APIs, which can answer differently from the consumer apps (those may use web search and your location). Perplexity always searches the web.

## Things to update before launch

- Pricing in the Pricing section is placeholder — set your real plans (and the matching Stripe prices).
- `hello@spotlight.example` — swap for your real email in `index.html`, `dashboard.html`, `privacy.html` and `terms.html`.
- `privacy.html` and `terms.html` are plain-English starting points, not legal advice — have them reviewed.
- The sample report and chat answer use made-up example businesses.
