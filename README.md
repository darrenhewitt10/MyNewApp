# Spotlight

Landing page for **Spotlight** — shows local businesses whether AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend them, and helps them get recommended.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | The landing page |
| `styles.css` | All styles (dark "stage" theme, amber spotlight accent) |
| `script.js` | Mobile menu, form submission, scroll animations |
| `thanks.html` | Fallback page after the sign-up form is submitted |
| `favicon.svg` | Site icon |
| `netlify.toml` | Netlify config (no build step, publishes the repo root) |

Plain HTML/CSS/JS — no build tools or dependencies.

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. Branch: `main`. Leave the build command empty. Publish directory: `.` (already set in `netlify.toml`).
3. Deploy.

## Sign-ups (Netlify Forms)

The hero form ("Check my AI visibility") uses [Netlify Forms](https://docs.netlify.com/forms/setup/). After the first deploy, submissions appear in the Netlify dashboard under **Forms → visibility-check**. Make sure form detection is enabled in **Site configuration → Forms**. You can add email notifications there too.

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
