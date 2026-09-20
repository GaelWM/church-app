# Procédure de mise en production
Voir le README (« Go live ») pour GitHub, Neon, Cloudflare et Auth0. Ordre :
1. `deploy` → staging (tests, migrations, rôle applicatif, seed, build, smoke).
2. Recette sur staging avec `docs/pv-recette.md` (les 15 critères §22).
3. Renseigner les points §25 dans Configuration › Paramètres et créer comptes, taux de change, utilisateurs.
4. `deploy` → production ; `bun run smoke` ; sauvegarde manuelle initiale (`nightly-backup` → Run workflow).
5. Retour arrière : voir README §8 (redéployer la version précédente ; les migrations sont additives).
