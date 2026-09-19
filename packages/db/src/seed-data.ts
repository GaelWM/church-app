export const RECETTE_CATEGORIES = [
  "Offrande ordinaire", "Offrande spéciale", "Dîme", "Action de grâce",
  "Achat parcelle et construction", "Fourmi", "Dons, legs et subventions", "Prémices",
  "Convention", "Offrande activités département", "Contribution sociale", "Partenariat",
  "Contribution membres",
];

export const DEPENSE_CATEGORIES: Record<string, string[]> = {
  "Locaux et charges": ["Loyer", "Eau", "Electricité", "Internet", "Assurance", "Entretien et réparation"],
  Administration: ["Frais administratifs", "Taxes", "Impression", "Communication", "Transport"],
  Personnel: ["Salaires et primes"],
  Ministère: ["Activités Eglise", "Activité culte (Sainte Cène...)", "Conventions et séminaires", "Aide sociale", "Dîme des dîmes"],
  Equipement: ["Mobilier", "Matériel", "Petit matériel et outillage"],
  Divers: ["Autres dépenses exceptionnelles"],
};

export const BANK_CATEGORIES = [
  "Versement (caisse vers banque)", "Retrait (banque vers caisse)", "Virement entre comptes",
  "Opération de change", "Frais bancaires et commissions", "Intérêts créditeurs",
  "Virement reçu / paiement par banque",
];
