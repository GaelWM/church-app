# Comptabilité de l'église

Multi-parish church accounting app. See "Church Accounting App — Architecture Plan" for the design.
React 19 + Vite (`apps/web`), Hono on Cloudflare Workers (`apps/api`), Neon Postgres + Drizzle (`packages/db`),
shared Zod schemas / permissions / money / workflow (`packages/shared`), French email templates (`packages/emails`).

## Run it locally (no Auth0 or Cloudflare account needed)
Requires Bun and Docker.
```bash
bun run dev:setup     # Postgres in Docker (port 54320), migrations, categories, demo data, apps/api/.dev.vars
bun run dev           # API (wrangler dev, :8787) + web (vite, :5173)
```
Open **http://localhost:5173** (not :8787, which only serves the production build) and pick a demo user (Administrateur, Caissier, Trésorier, Pasteur). Log out to switch users;
try the flow: Caissier enters and submits a recette → Trésorier and Pasteur validate it under « À valider » → it appears in the dashboard.
`bun run dev:db:reset` wipes the local database and re-seeds it. Emails are printed to the API console instead of sent.

The dev login is only honoured when `DEV_AUTH=1` is in the git-ignored `apps/api/.dev.vars` **and** `APP_URL` is `localhost`
(it is never set in `wrangler.jsonc`); the web side needs `VITE_DEV_AUTH=1`, which only the `dev:local` script sets.

## Tests
```bash
eval "$(scripts/test-db.sh)"   # throwaway Postgres in Docker, migrated + seeded
bun test                       # unit + API integration tests (RLS, triggers, workflow)
bun run typecheck
```

## Go live (staging first, then production)
Everything below needs your own accounts. Do **staging completely** before touching production.
`apps/api/wrangler.jsonc` has a self-contained block per environment (Wrangler does not inherit bindings/vars into `env.*`),
and CI refuses to deploy while any `REPLACE_ME` remains. Check locally any time (deploys nothing):
```bash
cd apps/api && bunx wrangler deploy --dry-run --env staging      # lists every resolved binding/var
```

### 1. GitHub
- Create the repo and push (include `bun.lock`; CI uses `--frozen-lockfile`).
- Settings → Environments: create `staging` and `production` (**production: required reviewers**).
- Per environment, **secrets**: `CLOUDFLARE_API_TOKEN` (Workers, KV, R2, Hyperdrive edit), `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL` (Neon **direct** URL of the *owner* role), `APP_DB_PASSWORD` (new random password for the app role). **Variables**: `APP_URL` (`https://…`), `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`.
- Repo-level for the nightly backup: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID` (secrets), `R2_BACKUP_BUCKET` (variable).

### 2. Neon
- One project, one branch per environment (`staging`, `main`). Use the **Launch** plan for production (7-day restore).
- Use the **direct** (non-pooler) connection string for migrations and for Hyperdrive; Hyperdrive already pools.
- The owner role runs migrations. The Worker connects as a separate **non-superuser** role created by `packages/db/src/grant-app-role.ts` (CI runs it after every migration; it also sets default privileges so future tables just work).

### 3. Cloudflare
```bash
cd apps/api
bunx wrangler hyperdrive create church-staging --connection-string "postgres://app_user:<APP_DB_PASSWORD>@<neon-direct-host>/<db>?sslmode=require"
bunx wrangler kv namespace create church-kv-staging
bunx wrangler r2 bucket create church-files-staging          # and a private bucket for backups
bunx wrangler secret put AUTH0_M2M_CLIENT_ID --env staging
bunx wrangler secret put AUTH0_M2M_CLIENT_SECRET --env staging
```
Put the returned ids in `wrangler.jsonc` (`env.staging`), replace `REPLACE_ME` for `AUTH0_DOMAIN`, `APP_URL`, `MAIL_FROM`.
Repeat with `-production` names. Add a custom domain to the Worker. Onboard your domain in **Email Service** (SPF/DKIM/DMARC):
until the sender domain is verified, sends fail with `E_SENDER_NOT_VERIFIED` (visible in Workers logs as `[mail] failed … code=…`).
The 18:00 digest cron is `0 17 * * *` (UTC+1, Kinshasa); change it if you need Lubumbashi time (UTC+2).

### 4. Auth0
- Application (SPA): callback, logout and web-origin URLs = your app URL; refresh-token rotation on.
- API: identifier = `AUTH0_AUDIENCE`. Machine-to-Machine app authorised for the **Management API** with `create:users`, `update:users`, `create:user_tickets`.
- Database connection: **Disable Sign Ups**; no social connections. Security: MFA policy on (required for Administrateur/Trésorier/Pasteur), brute-force and breached-password protection on.
- Email provider: configure a real one (not the built-in test sender) before go-live.
- If you use an Auth0 **custom domain**, add it to `connect-src`/`frame-src` in `apps/web/public/_headers`.

### 5. First deploy and bootstrap
```bash
# GitHub → Actions → deploy → Run workflow → staging   (test, migrate, grant, seed, build, dry-run guard, deploy, smoke)
# create the first admin in the Auth0 dashboard, copy its user id (auth0|…), then:
cd packages/db && DATABASE_URL=<owner direct url> bun src/bootstrap.ts --parish "Paroisse Centrale" --code KIN01 --email admin@… --name "…" --auth0-id "auth0|…"
```
Then log in, set the first exchange rate (Configuration → Taux de change), create each parish's accounts, and invite real users.

### 6. Verify staging (do not skip)
```bash
bun run smoke https://<staging-url>      # health, readiness (RLS not bypassable), 401s, SPA, security headers, dev login OFF, https
```
Then by hand, with three real accounts: Caissier enters + submits → Trésorier validates → Pasteur validates → appears in the dashboard;
rejection emails the Caissier; a closed month refuses a back-dated entry; a receipt uploads to R2 and opens; an invited user gets the
email and can set a password; sign-up is unavailable; a valid Auth0 login with no `users` row shows « Accès non configuré »; MFA prompts.
Trigger the cron once from the dashboard and confirm one digest per parish and step.

### 7. Backups and restore drill
Run the `nightly-backup` workflow once, then restore the dump into a scratch Neon branch and check row counts:
```bash
gunzip -c church-YYYY-MM-DD.sql.gz | psql "<scratch branch url>"
```
Do this before production, and again after any schema change to the backup job.

### 8. Rollback
- Code: `cd apps/api && bunx wrangler rollback --env production` (previous Worker version, instant). The static assets ship with the Worker version.
- Data: Neon point-in-time restore to a new branch (7 days on Launch); validated rows are immutable, so fix mistakes with reversing entries, not restores.
- Migrations are forward-only; write a corrective migration rather than editing an applied one.

### Production
Only after staging is clean: Actions → deploy → `production` (waits for reviewer approval), then repeat steps 5–6 with the production URL.

## Design notes
- One `transactions` table; Recettes/Dépenses/Banques are filtered views, the Journal is the same table unfiltered.
- Only `validee` rows count in balances; validated rows and closed periods are frozen by database triggers; corrections are reversing entries.
- Every parish table has row-level security driven by `SET LOCAL app.parish_ids` per request transaction.
- Separation of duties: nobody validates what they entered; Administrateur never enters/validates; Caissier/Trésorier/Pasteur/Administrateur profiles cannot be combined in one parish.
- Excel/PDF exports and the reçu are generated in the browser (keeps Worker CPU low).

## UI
The web app uses [shadcn/ui](https://ui.shadcn.com) (radix, `radix-nova` preset, Tailwind v4, Lucide icons). Generated components live in
`apps/web/src/components/ui/`; add more with `cd apps/web && bunx shadcn@latest add <component>`. App-level wrappers
(`Card`, `Field`, `DataTable`, `StatusBadge`, …) are in `apps/web/src/components/common.tsx`. Selects use shadcn's `NativeSelect`
so they work directly with React Hook Form's `register`.
