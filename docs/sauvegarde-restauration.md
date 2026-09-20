# Plan de sauvegarde et de restauration

## Sauvegardes
- Base : `pg_dump` quotidien à 02:00 UTC (workflow `nightly-backup`) vers un bucket R2 indépendant, en plus de la restauration à un instant donné de Neon.
- Fichiers (R2 `FILES`) : activer le versionnement du bucket ; copie périodique recommandée vers un second bucket.
- Fréquence, conservation et personnes autorisées à restaurer : à fixer par la CEPD MBUDI (points §25) et à saisir dans Configuration › Paramètres (notes de conservation/sauvegarde).

## Restauration (base)
1. Créer une base vide (Neon : nouvelle branche).
2. `gunzip -c church-AAAA-MM-JJ.sql.gz | psql "$DATABASE_URL"`.
3. `bun run db:migrate` puis `APP_DB_PASSWORD=… bun run --cwd packages/db grant` pour recréer le rôle applicatif.
4. Vérifier `/api/health/ready` puis le smoke test : `bun run smoke`.
5. Contrôler que les soldes du tableau de bord égalent le journal.

## Exercice
Réaliser un exercice de restauration sur un environnement de test avant la mise en production, puis chaque trimestre.
Seuls les administrateurs techniques désignés restaurent ; toute restauration est consignée par écrit.
