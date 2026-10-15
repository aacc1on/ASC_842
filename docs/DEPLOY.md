# Deploying to your own server

The app is a static single-page app (`dist/`) plus a Supabase project (database, auth, storage, edge functions).
Only the static files go on your server; the backend stays in Supabase.

## 0. Prerequisites
- Linux server with nginx and a domain (e.g. `app.example.com`) with a TLS certificate (Let's Encrypt / certbot).
- Node.js **20.19+ or 22** on the build machine (Vite 8 / Vitest 4 do not run on Node 18).
- A Supabase project (production) and the Supabase CLI (`npm i -g supabase` or the pinned version from `.github/workflows/staging.yml`).
- Stripe account (live keys for production), Cloudflare Turnstile site key, optionally Resend for alert e-mail.

## 1. Database (once per environment)
Never apply the old history by hand; use the repository migrations, which are verified to rebuild an empty database.
```bash
supabase link --project-ref <PROJECT_REF>
supabase db push --linked --include-all      # applies supabase/migrations in order
```
Check before going live: `\d leases` shows `incremental_borrowing_rate` as `numeric(7,4)` (QA-001) and
`node scripts/check-migrations-empty-db.mjs` passes locally.

## 2. Edge functions and secrets
```bash
supabase secrets set \
  APP_ORIGINS=https://app.example.com \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  RESEND_API_KEY=... ALERT_EMAIL_TO=you@example.com
# Do NOT set ALLOW_BOLT_PREVIEW=true in production (unset = off).
supabase functions deploy --project-ref <PROJECT_REF>      # deploys all 15 functions, verify_jwt per config.toml
```
Register the Stripe webhook endpoint `https://<PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`.

Note: `supabase/functions/_shared/cors.ts` still always allows the original Bolt host
(`LIVE_ORIGIN`); change that constant to your domain if you want the old host switched off.

## 3. Supabase dashboard settings (cannot be set from code)
Authentication: site URL and redirect URLs = `https://app.example.com`; password min length 12 + leaked-password
protection; email confirmation ON; enable TOTP MFA; JWT expiry 600-900 s with refresh-token rotation; "secure password
change" ON; CAPTCHA (Turnstile) ON; rate limits default or stricter. API: disable OpenAPI exposure to anon.
Storage bucket `documents` private. Database: SSL enforced, daily backups/PITR (do a restore test).

## 4. Build the frontend
```bash
git clone <repo> && cd project_v2
cat > .env <<ENV
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_TURNSTILE_SITE_KEY=<turnstile site key>
ENV
npm ci
npm run check        # audit, migrations, typecheck, lint, tests, build (needs Node 20+)
```
`npm run build` alone is enough for a quick rebuild. Only the anon key goes in `.env`; never the service_role key.

## 5. Publish to the server
```bash
rsync -avz --delete dist/ user@server:/var/www/lease-manager/dist/
sudo cp deploy/nginx.conf /etc/nginx/sites-available/lease-manager   # edit domain + cert paths first
sudo ln -s /etc/nginx/sites-available/lease-manager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
`deploy/nginx.conf` sets the security headers (CSP, HSTS, nosniff, frame-ancestors none), caches `/assets/` for a year,
never caches `index.html`, and falls back to `index.html` for client-side routes.

## 6. Smoke test after deploy
1. `curl -sI https://app.example.com | grep -i -E "content-security|strict-transport|x-frame"` shows the headers.
2. Browser console: no CSP or CORS errors on login (if CORS fails, check `APP_ORIGINS`).
3. Sign up, create an operating lease with a 12% rate, run month-end, run reports.
4. "Add user" then log in as that user: correct organization and role. "Remove user": the person cannot sign in.
5. Health check: `https://<PROJECT_REF>.supabase.co/functions/v1/health` returns OK; point an uptime monitor at it.

## 7. Updating
Pull, `npm ci && npm run check`, `supabase db push --linked`, `supabase functions deploy`, rsync `dist/`.
Keep staging and production on separate Supabase projects (`docs/staging.md`).
