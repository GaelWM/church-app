# Guide utilisateur – Comptabilité CEPD MBUDI

## Profils
| Profil | Ce que vous faites |
|---|---|
| Administrateur | Configuration (paroisses, comptes, catégories, utilisateurs, taux, paramètres). Lecture seule sur l'argent. |
| Caissier | Saisit recettes, dépenses, opérations bancaires, effectifs, registres. Demande les modifications/annulations. Ne valide jamais. |
| Trésorier | 1re validation, rapprochement bancaire, 1re approbation des demandes de modification/annulation. |
| Pasteur | 2e validation, approbation finale des demandes, clôture mensuelle. |
| Auditeur | Consultation générale, rapports, journal d'audit. Aucune saisie ni validation. |

Un même utilisateur ne peut pas cumuler des rôles incompatibles dans une paroisse (le système refuse).

## Circuit d'une écriture
Brouillon → Soumise → Validée 1 (Trésorier) → Validée (Pasteur). Un rejet exige un motif et retourne l'écriture au Caissier.
Seules les écritures **Validées** comptent dans les soldes, le tableau de bord et les rapports.

## Corriger ou annuler une écriture validée (§27)
1. Journal → ouvrir la ligne → « Demander une modification / annulation », avec motif obligatoire.
2. Le Trésorier approuve (ou rejette avec motif) dans **À valider › Demandes**.
3. Le Pasteur donne l'approbation finale : le système exécute. L'écriture annulée reste visible, statut **Annulée**.
Le demandeur ne peut pas approuver sa propre demande. Une demande rejetée reste dans l'historique.

## Menus
- **Tableau de bord** : recettes/dépenses cumulées, disponibilités, répartitions par catégorie, engagements, alertes de solde négatif, filtres période et devise.
- **Recettes / Dépenses** : catégories du cahier des charges, sous-catégorie/objet, N° de pièce, justificatifs, engagement associé (dépenses), alerte de solde insuffisant.
- **Banques** : versements, retraits, virements, change, frais (tenue de compte, retrait bancaire, retrait mobile money), rapprochement, clôture mensuelle.
- **Journal** : colonnes complètes, filtres, recherche, solde d'ouverture/clôture, export Excel/PDF, impression.
- **Engagements** : construction, partenariat, parcelle, autres ; engagé, libéré, non libéré, historique des libérations.
- **Effectifs** : par date et par culte, sexe × nature ; membres ; ouvriers.
- **Dédicace enfants / Baptême / Mariage** : registres avec téléversement et téléchargement du document.
- **Rapports** : 13 états exportables en Excel et PDF, imprimables.
- **Configuration** : utilisateurs et rôles, paroisses, comptes, catégories, taux de change, paramètres, journal d'audit.
