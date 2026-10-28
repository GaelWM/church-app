# Guide utilisateur – Comptabilité CEPD MBUDI

## Profils
| Profil | Ce que vous faites |
|---|---|
| Administrateur | Configuration (paroisses, comptes, catégories, utilisateurs, taux, paramètres). Lecture seule sur l'argent. |
| Caissier | Saisit recettes, dépenses, opérations bancaires, effectifs, registres. Demande les modifications/annulations. Ne valide jamais. |
| Trésorier | 1re validation des écritures, rapprochement bancaire, 1re approbation des demandes de modification/annulation. |
| Pasteur titulaire | Validateur final : 2e validation des écritures, des effectifs, des baptêmes et des mariages ; approbation finale des demandes ; clôture mensuelle. |
| Pasteur assistant | 1re validation des effectifs des cultes, des baptêmes et des mariages ; saisie des registres. Aucun accès aux finances ni aux soldes des comptes. |
| Évangélisation | Effectifs (membres, nouveaux venus, ouvriers), dédicaces, baptêmes, mariages. Aucun accès aux finances. |
| Auditeur | Consultation générale, rapports, journal d'audit. Aucune saisie ni validation. |

Un même utilisateur ne peut pas cumuler des rôles incompatibles dans une paroisse (le système refuse).

## Circuit d'une écriture
Brouillon → Soumise → Validée 1 (Trésorier) → Validée (Pasteur). Un rejet exige un motif et retourne l'écriture au Caissier.
Seules les écritures **Validées** comptent dans les soldes, le tableau de bord et les rapports.

## Circuit des effectifs, baptêmes et mariages
Mêmes états, avec le **Pasteur assistant** au premier niveau : Brouillon → Soumise → Validée 1 (Pasteur assistant) → Validée (Pasteur titulaire).
- **Effectifs des cultes** : le Caissier compte et soumet la journée ; le Pasteur assistant puis le Pasteur titulaire valident dans *Effectifs › Cultes*. Le Trésorier ne valide plus les effectifs.
- **Baptêmes et mariages** : l'entrée est d'abord un brouillon que **seul son auteur** modifie, supprime et soumet (*Enregistrer et soumettre* fait les deux). Les pasteurs valident depuis la page du registre (filtre *Statut › À valider*). Une entrée soumise est verrouillée ; on peut encore y joindre un document, pas en retirer.
- Un rejet exige un motif, affiché à l'auteur ; il corrige et soumet à nouveau, et l'entrée repasse par les deux validations.
- Les deux validations sont données par deux personnes différentes. Si l'auteur est lui-même Pasteur assistant, son niveau est sauté et seul le Pasteur titulaire valide ; si l'auteur est le Pasteur titulaire, la validation du Pasteur assistant est définitive. Le niveau sauté est indiqué sur l'entrée.
- Une entrée validée qui contient une erreur peut être **renvoyée en correction** par le Pasteur titulaire, avec un motif.
- Les entrées enregistrées avant la mise en place du circuit sont considérées comme validées. Les dédicaces n'ont pas de circuit.

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
- **Effectifs** : par date et par culte, sexe × nature ; membres ; ouvriers, rattachés à un département (dont **Affermissement**).
- **Dédicace enfants / Baptême / Mariage** : registres avec téléversement et téléchargement du document.
- **Immobilisations** : registre des biens durables (voir ci-dessous).
- **Rapports** : 13 états exportables en Excel et PDF, imprimables.
- **Configuration** : utilisateurs et rôles (inviter ; *Modifier* le nom, l'email et les profils ; désactiver ; supprimer uniquement un compte sans historique, sinon le désactiver), paroisses, comptes, catégories, départements (ajouter, renommer), taux de change, paramètres, journal d'audit. Les alertes de solde négatif ne peuvent être envoyées qu'aux profils qui ont accès aux finances.

## Immobilisations
Le menu **Immobilisations** tient le registre complet des biens durables : code unique, compte et sous-compte, fournisseur, localisation, coût d'acquisition, amortissement, état, historique et inventaire. Il ne génère aucune écriture comptable.

**Enregistrer un bien** (Administrateur, Trésorier ou Pasteur) : *Registre › + Immobilisation*.
1. Choisir le **type de compte** (21, 22, 23, 24, 27, 28) puis le **sous-compte** : seuls les sous-comptes du compte choisi sont proposés, avec le mode d'amortissement habituel.
2. Le **code** est généré à l'enregistrement : `ACRONYME AAAAMM NNNNN` (ex. `MI 202610 00001`). Le numéro repart à 00001 chaque mois, pour chaque acronyme. Il n'est jamais saisi à la main.
3. Saisir description, n° de facture, fournisseur, dates d'acquisition et de mise en service, **localisation (obligatoire)** et devise (USD, CDF, EUR ; taux de change optionnel).
4. Saisir le **PA** (prix d'achat) et les **FAA** (frais accessoires) : le **coût d'acquisition = PA + FAA** est calculé, jamais saisi.
5. Choisir le mode d'amortissement (linéaire, dégressif, non amortissable) et la durée. Taux, valeur amortissable, amortissement de l'exercice, cumul et **VNC** s'affichent en direct. L'amortissement est calculé au prorata mensuel à partir de la date de mise en service.
6. Le bien est d'abord un **brouillon**. *Soumettre pour validation* l'envoie au Trésorier puis au Pasteur ; il devient **Actif** avec l'état initial **Bon**. Celui qui enregistre ne valide pas son propre niveau : s'il est Trésorier (ou Pasteur), seul l'autre approuve.

**Un bien validé ne se modifie plus directement.** Sur sa fiche : *Demander une modification* ou *Demander une annulation* (motif obligatoire). Le Trésorier approuve, puis le Pasteur ; l'opération n'est définitive qu'après les deux. Rien n'est supprimé : un bien annulé reste dans le registre avec tout son historique. Le code ne change que par une demande exceptionnelle justifiée.

**État du bien** (distinct du statut administratif) : Bon, Mauvais, Déclassé, Perdu. *Changer l'état* demande toujours un motif ; Mauvais, Déclassé et Perdu exigent aussi une justification. **Déclassé** et **Perdu** (et le retour de ces états) suivent le même circuit Trésorier puis Pasteur ; l'état affiché ne change qu'à l'approbation. *Historique de l'état* conserve définitivement chaque changement (date, heure, ancien et nouvel état, motif, localisation, utilisateur, validation).

**Imprimer** : *Imprimer le code* ou *l'étiquette* (CEPD MBUDI, code, description, localisation, QR code et code-barres) depuis la fiche, ou en lot depuis le registre (cocher les biens). Une nouvelle impression est enregistrée comme **réimpression**. Le QR code ouvre la fiche, selon les droits de l'utilisateur. Format d'étiquette réglable dans *Configuration › Immobilisations*.

**Rechercher et filtrer** le registre : code, description, facture, fournisseur, compte, sous-compte, localisation, année, devise, mode d'amortissement, état. Le registre s'exporte en Excel, CSV, PDF et s'imprime.

**Inventaire** : *Inventaire › Nouvel inventaire* fige la liste des biens validés (d'une localisation ou de toutes). Pour chaque bien : présent ou absent, localisation et état constatés, responsable/service, observations. Les écarts (absent, autre localisation, état différent, bien non enregistré) sont signalés. Un bien introuvable se déclare « Perdu » depuis sa fiche. Un inventaire clôturé ne change plus.

**Rapports** : état général, acquisitions (mois, trimestre, année), amortissements (par bien, compte, sous-compte, année), VNC, par catégorie, par localisation, par état. Les devises ne sont jamais additionnées ; un équivalent USD apparaît pour les biens qui portent un taux de change. Seuls les biens validés sont comptés.

**Configuration › Immobilisations** (Administrateur) : acronymes du code, localisations, fournisseurs, coefficients de l'amortissement dégressif, format des étiquettes.
