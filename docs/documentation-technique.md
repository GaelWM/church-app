# Documentation technique

## Architecture
Monorepo Bun : `apps/api` (Hono sur Cloudflare Workers), `apps/web` (React 19, Vite, Tailwind/shadcn, PWA), `packages/db` (Drizzle + SQL), `packages/shared` (schémas zod, permissions, machines d'états, montants), `packages/emails`.
Base : PostgreSQL (Neon via Hyperdrive). Fichiers : R2. Authentification : Auth0 (JWT).

## Intégrité comptable
- Montants en entiers (unités mineures, `bigint`), jamais de flottants. Soldes calculés, non stockés : somme des écritures `validee`.
- Sécurité par ligne (RLS) par paroisse ; le rôle applicatif ne doit être ni superuser ni BYPASSRLS (`/api/health/ready`).
- Triggers : une écriture validée ou annulée est gelée (seuls le pointage bancaire et l'exécution d'une demande approuvée, `app.change_request_exec`, sont permis) ; période clôturée verrouillée ; `audit_log`, `transaction_events`, `change_request_events` en ajout seul.
- Références automatiques : `next_reference` (écritures), `next_request_reference` (demandes DEM-…).

## Permissions
Source unique : `packages/shared/src/permissions.ts` (API : `requirePerm`, web : `useSession().can`). Ségrégation des tâches : `CONFLICTING_ROLE_PAIRS`.
Permissions ajoutées : `registry.write`, `change.request` ; rôle `auditeur`.

## Modèle de données (ajouts)
`change_requests`, `change_request_events`, `engagement_releases`, `settings`, `workers`, `child_dedications`, `baptisms`, `marriages`, `record_files` ; colonnes ajoutées sur `transactions` (sous-catégorie, validateurs N1/N2, engagement), `members`, `pledges`/`commitments` (type), `attendance_records` (sexe × nature).
Migrations : `0001_registers_and_workflows.sql` (généré), `9999b_workflows_rls.sql` (RLS, triggers).

## Paramètres (`settings`, par paroisse)
`default_currency`, `piece_number_mode` (manual|auto|mixed), `negative_balance_alert`, `alert_recipients`, `closure_rule`, `retention_policy_note`, `backup_note`.

## Tests
`bun test` (PostgreSQL requis : `eval "$(scripts/test-db.sh)"`). Couvre flux de validation, RLS, triggers, demandes de modification/annulation, engagements, effectifs, registres, rapports, tableau de bord = journal.
