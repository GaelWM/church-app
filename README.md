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

## First-time setup (needs your accounts)
1. **Cloudflare**: Workers Paid; create Hyperdrive (Neon URL), R2 bucket `church-files`, KV namespace, Email Service on your domain; put the ids in `apps/api/wrangler.jsonc`.
2. **Neon**: one branch per environment; run `bun run db:migrate` then `bun run --cwd packages/db seed` with `DATABASE_URL`.
   The Worker must connect as a **non-superuser** role (superusers bypass row-level security): create one and grant it the tables (see `packages/db/test-setup.sql`).
3. **Auth0**: SPA application, API (audience), M2M application allowed on the Management API (`create:users`, `update:users`, `create:user_tickets`), disable sign-ups on the database connection, no social logins, MFA for Administrateur/Trésorier/Pasteur; point Auth0's email provider at a real sender before go-live.
4. **First administrator**: create the user in Auth0, then `DATABASE_URL=... bun src/bootstrap.ts --parish "..." --code KIN01 --email ... --name "..." --auth0-id "auth0|..."` in `packages/db`.
5. **Secrets**: `wrangler secret put AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET`; GitHub secrets/vars used by `.github/workflows`.
6. Set the first exchange rate in Configuration → Taux de change (entries cannot be created without one) and create accounts (one caisse per currency, banks, mobile money) per parish.

## Design notes
- One `transactions` table; Recettes/Dépenses/Banques are filtered views, the Journal is the same table unfiltered.
- Only `validee` rows count in balances; validated rows and closed periods are frozen by database triggers; corrections are reversing entries.
- Every parish table has row-level security driven by `SET LOCAL app.parish_ids` per request transaction.
- Separation of duties: nobody validates what they entered; Administrateur never enters/validates; Caissier/Trésorier/Pasteur/Administrateur profiles cannot be combined in one parish.
- Excel/PDF exports and the reçu are generated in the browser (keeps Worker CPU low).
