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

## Immobilisations
Module `apps/api/src/modules/immobilisations` (+ `asset-requests`, `asset-refs`, `asset-inventory`), écran `apps/web/src/features/immobilisations`. Calculs et règles dans `packages/shared` : `depreciation.ts` (linéaire/dégressif/non amortissable, prorata mensuel, bigint), `asset-accounts.ts` (comptes et sous-comptes), `asset-code.ts`, `asset-schemas.ts`, `asset-reports.ts`, `asset-inventory.ts`, `asset-labels.ts`, `workflow.ts` (circuit d'approbation).
- **Tables** : `fixed_assets` (le coût `cost_minor = pa_minor + faa_minor` est une colonne générée), `asset_code_prefixes`, `asset_locations`, `asset_suppliers`, `asset_requests` + `asset_request_events` (création, modification, annulation, changement d'état sensible), `asset_condition_history` (historique de l'état, en ajout seul), `asset_inventories` + `asset_inventory_lines`. Compteurs : `asset_code_counters` / `next_asset_code(parish, acronyme, AAAAMM)`, `inventory_counters`.
- **Code** : `MI 202610 00001`, mois de l'enregistrement (fuseau Africa/Kinshasa), séquence atomique par paroisse, acronyme et mois ; unique `(parish_id, code)`.
- **Immuabilité** (triggers) : un bien hors brouillon ne se modifie que par l'exécution d'une demande approuvée (`app.asset_request_exec`) ; `etat` n'est écrit que depuis l'historique ; historique, événements et demandes ne se suppriment pas ; un inventaire clôturé est figé.
- **Approbation** : `changeRequestTransition` (Trésorier puis Pasteur, jamais le demandeur). Un demandeur Trésorier ou Pasteur saute son propre niveau (`n1_skipped`/`n2_skipped`, tracé dans l'audit) ; un demandeur cumulant les deux rôles est refusé.
- **Audit** : actions `asset.*` et `asset_prefix|location|supplier.*` dans `audit_log` ; `GET /api/immobilisations/:id/audit` donne la piste d'un bien (approbations et dates incluses).
- **Devises** : USD, CDF, EUR pour les immobilisations seulement ; chaque bien fige son taux « 1 USD = X devise ». Pas de conversion implicite : les rapports restent par devise.
- **Migrations** : `0003_immobilisations_spec.sql` (**vide `fixed_assets`**: l'ancien registre ne contenait que des données de test), `9999d_assets_rls_triggers.sql`, `0004_asset_inventory.sql`, `9999e_asset_inventory_rls.sql`. `0003` s'exécute avant les `9999*` sur une base neuve et après sur une base existante : elle ne doit donc jamais référencer leurs fonctions.
- **Étiquettes** : PDF généré dans le navigateur (`jspdf`, `qrcode`, `jsbarcode`), mise en page dans `asset-labels.ts`.

## Paramètres (`settings`, par paroisse)
`default_currency`, `piece_number_mode` (manual|auto|mixed), `negative_balance_alert`, `alert_recipients`, `closure_rule`, `retention_policy_note`, `backup_note`, `asset_degressive_coefficients`, `asset_label_format`.

## Tests
`bun test` (PostgreSQL requis : `eval "$(scripts/test-db.sh)"`). Couvre flux de validation, RLS, triggers, demandes de modification/annulation, engagements, effectifs, registres, rapports, tableau de bord = journal.
