# Comptabilité de l'église

Multi-parish church accounting app. See "Church Accounting App — Architecture Plan" for the design.
React 19 + Vite (`apps/web`), Hono on Cloudflare Workers (`apps/api`), Neon Postgres + Drizzle (`packages/db`),
shared Zod schemas / permissions / money / workflow (`packages/shared`), French email templates (`packages/emails`).

## Local development
```bash
bun install
eval "$(scripts/test-db.sh)"        # throwaway Postgres in Docker, migrated + seeded (needs Docker)
bun test                            # unit + API integration tests (RLS, triggers, workflow)
bun run typecheck
```
Run the app: set `apps/web/.env.local` (`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`),
create `apps/api/.dev.vars` (`AUTH0_M2M_CLIENT_ID`, `AUTH0_M2M_CLIENT_SECRET`), then `bun run dev:api` and `bun run dev:web`.

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
