# Procès-verbal de recette (§22)
| # | Critère | Test automatisé | Résultat (OK / KO) | Date / Visa |
|---|---|---|---|---|
| 1 | Utilisateurs et rôles | app.test.ts, effectifs.test.ts | | |
| 2 | Caissier saisit, ne valide pas | app.test.ts | | |
| 3 | Trésorier 1re validation, pas sa propre saisie | app.test.ts | | |
| 4 | Pasteur 2e validation et consultation | app.test.ts | | |
| 5 | Auditeur consulte sans modifier | effectifs.test.ts, registres.test.ts | | |
| 6 | Recette validée met à jour compte et journal | app.test.ts | | |
| 7 | Dépense validée met à jour compte et journal | app.test.ts | | |
| 8 | Transfert sans recette/dépense | app.test.ts, reports.test.ts | | |
| 9 | Dashboard = journaux | journal-dashboard.test.ts | | |
| 10 | Filtres de période | journal-dashboard.test.ts | | |
| 11 | Exports PDF/Excel sans perte | manuel | | |
| 12 | Pièces téléversées/récupérées selon droits | registres.test.ts | | |
| 13 | Actions sensibles dans le journal d'audit | tous | | |
| 14 | Alertes de solde négatif | manuel + engagements-settings.test.ts | | |
| 15 | Effectifs par date, culte, sexe, nature | effectifs.test.ts | | |
Extra §27 : change-requests.test.ts (demande, double approbation, rejet, exécution).
