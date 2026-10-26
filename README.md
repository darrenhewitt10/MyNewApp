# Spotlight

Landing page for **Spotlight** — shows local businesses whether AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend them, and helps them get recommended.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | The landing page |
| `styles.css` | All styles — the "Spotlight Glass" design (frosted glass over soft light orbs) |
| `script.js` | Mobile menu, form submission, scroll animations |
| `thanks.html` | Fallback page after the sign-up form is submitted |
| `login.html` / `login.js` | Log in with Google, Apple (iCloud) or Yahoo |
| `dashboard.html` / `dashboard.js` | Signed-in page: add and list tracked businesses |
| `supabase.js` | Supabase connection (project URL + publishable key) |
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

All three providers use this **callback URL**:

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

**3. Apple (iCloud)** — Authentication → Providers → Apple
- Requires a paid [Apple Developer](https://developer.apple.com/account) account.
- Create an App ID with "Sign in with Apple", then a **Services ID** (this is the Client ID) with your domain and the callback URL above as the return URL.
- Create a Sign in with Apple **key** (.p8 file) and use it to generate the client secret — follow [Supabase's Apple login guide](https://supabase.com/docs/guides/auth/social-login/auth-apple), which includes a secret generator. Apple secrets expire every 6 months — set a reminder to regenerate it.

**4. Yahoo** — Authentication → Providers → **New Provider** (custom)
- Create an app at [developer.yahoo.com/apps](https://developer.yahoo.com/apps/) with **OpenID Connect** permissions (Email, Profile) and the callback URL above as the redirect URI.
- In Supabase choose **Auto-discovery (OIDC)**:
  - Identifier: `custom:yahoo` (must match exactly — the login button uses it)
  - Issuer URL: `https://api.login.yahoo.com`
  - Client ID / Client Secret from Yahoo
  - Scopes: `openid email profile`

Until a provider is enabled, clicking its button lands on a Supabase "provider is not enabled" error page.

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
