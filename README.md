# Spotlight

Landing page for **Spotlight** — shows local businesses whether AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend them, and helps them get recommended.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | The landing page |
| `styles.css` | All styles — the "Spotlight Glass" design (frosted glass over soft light orbs) |
| `script.js` | Mobile menu, form submission, scroll animations |
| `thanks.html` | Fallback page after the sign-up form is submitted |
| `login.html` / `login.js` | Log in with Google |
| `dashboard.html` / `dashboard.js` | Signed-in page: add and list tracked businesses |
| `supabase.js` | Supabase connection (project URL + publishable key) and profile helpers |
| `nav-user.js` | Shows the signed-in user's name and picture in the landing page nav |
| `supabase/migrations/` | Database schema (already applied to the Supabase project) |
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
- `businesses` — the business name + city each user wants tracked.

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

## Things to update before launch

- Pricing in the Pricing section is placeholder — set your real plans.
- `hello@spotlight.example` in the Multi-location plan — swap for your real email.
- The sample report and chat answer use made-up example businesses.
