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

## Pasteur titulaire / Pasteur assistant, Affermissement (demande du 11/10/2026)
| # | Critère | Test automatisé | Résultat (OK / KO) | Date / Visa |
|---|---|---|---|---|
| P1 | Deux profils distincts, Pasteur titulaire et Pasteur assistant, incompatibles entre eux | workflow.test.ts | | |
| P2 | Pasteur assistant : 1re validation des effectifs ; le Trésorier ne valide plus les effectifs ; Pasteur titulaire validateur final | effectifs.test.ts, workflow.test.ts | | |
| P3 | Baptêmes et mariages : Brouillon → Soumise → Validée 1 (Pasteur assistant) → Validée (Pasteur titulaire), rejet motivé, entrée gelée une fois soumise (API et base) | registres.test.ts, workflow.test.ts | | |
| P4 | Les deux validations par deux personnes différentes ; niveau de l'auteur sauté et tracé | registres.test.ts, effectifs.test.ts, workflow.test.ts | | |
| P5 | Pasteur assistant : aucun accès aux finances ni aux soldes des comptes (tableau de bord, journal, banques, rapports, pièces, alertes) | pasteur-assistant.test.ts | | |
| P6 | Département Affermissement présent dans chaque paroisse ; ajout et renommage dans Configuration | departments.test.ts | | |
| P7 | Parcours complet dans l'interface (Effectifs, Baptême, Mariage, Configuration › Départements) | manuel | | |

## Immobilisations (spec « MENU IMMOBILISATIONS »)
| # | Critère | Test automatisé | Résultat (OK / KO) | Date / Visa |
|---|---|---|---|---|
| I1 | Code `ACRONYME AAAAMM NNNNN` unique, séquence par mois et acronyme, sans doublon en parallèle | immobilisations.test.ts (codes), asset-code.test.ts | | |
| I2 | Compte puis sous-compte dépendants ; localisation obligatoire ; coût = PA + FAA non saisissable | asset-accounts.test.ts, asset-schemas.test.ts, immobilisations.test.ts | | |
| I3 | Devises USD/CDF/EUR avec taux figé par bien | immobilisations.test.ts, asset-schemas.test.ts | | |
| I4 | Amortissement linéaire, dégressif, non amortissable ; taux, cumul, VNC | depreciation.test.ts, immobilisations.test.ts | | |
| I5 | Validation Trésorier puis Pasteur ; le demandeur n'approuve pas son propre niveau | workflow.test.ts, immobilisations.test.ts | | |
| I6 | Un bien validé ne se modifie ni ne se supprime directement (API et base) | immobilisations.test.ts | | |
| I7 | Demande de modification/annulation à double approbation, anciennes et nouvelles valeurs, bien conservé | immobilisations.test.ts | | |
| I8 | État, justification, états sensibles soumis à approbation, historique permanent | immobilisations.test.ts, workflow.test.ts | | |
| I9 | Piste d'audit avec approbations et dates | immobilisations.test.ts | | |
| I10 | Étiquette/code : code complet, QR, code-barres, réimpression tracée, lot | asset-labels.test.ts, immobilisations.test.ts, manuel (impression) | | |
| I11 | Registre : colonnes, recherche, filtres, pagination, export | immobilisations.test.ts, manuel (exports) | | |
| I12 | Inventaire : théorique figé, écarts, clôture gelée | asset-inventory.test.ts, immobilisations.test.ts | | |
| I13 | Rapports (7 états), PDF/Excel/impression, cohérence avec le registre | asset-reports.test.ts, immobilisations.test.ts, manuel (exports) | | |
| I14 | Isolation entre paroisses (RLS) | immobilisations.test.ts | | |

