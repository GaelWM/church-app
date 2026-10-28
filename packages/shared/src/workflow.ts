import { can, type Permission } from "./permissions";
import type { Role, TxStatus } from "./enums";

export type TxAction = "submit" | "validate1" | "validate2" | "reject";

export interface TransitionInput {
  status: TxStatus;
  action: TxAction;
  actorId: string;
  enteredBy: string;
  actorRoles: readonly Role[];
  comment?: string;
  /** Who signed level 1, when the caller stores it: that person cannot also sign level 2. */
  validator1Id?: string | null;
}

export class WorkflowError extends Error {}

/** The permissions a validation circuit checks: who submits their own entry, who signs level 1, who signs level 2. */
export interface Circuit { submit: Permission; validate1: Permission; validate2: Permission; submitError: string }

/** Recettes, dépenses, transferts: Caissier → Trésorier → Pasteur titulaire. */
export const TX_CIRCUIT: Circuit = {
  submit: "transaction.create", validate1: "transaction.validate1", validate2: "transaction.validate2",
  submitError: "Seul le caissier auteur peut soumettre",
};
/** Effectifs des cultes: counted by the Caissier, then Pasteur assistant → Pasteur titulaire. */
export const ATTENDANCE_CIRCUIT: Circuit = {
  submit: "transaction.create", validate1: "registry.validate1", validate2: "registry.validate2",
  submitError: "Seul le caissier auteur peut soumettre",
};
/** Baptêmes and mariages: entered by any registry user, then Pasteur assistant → Pasteur titulaire. */
export const REGISTRY_CIRCUIT: Circuit = {
  submit: "registry.write", validate1: "registry.validate1", validate2: "registry.validate2",
  submitError: "Seul l'auteur de l'enregistrement peut le soumettre",
};

/** Returns the next status or throws WorkflowError. Pure: no I/O. */
export function transition(i: TransitionInput, c: Circuit = TX_CIRCUIT): TxStatus {
  switch (i.action) {
    case "submit":
      if (i.status !== "brouillon" && i.status !== "rejetee")
        throw new WorkflowError("Seules les écritures en brouillon ou rejetées peuvent être soumises");
      if (!can(i.actorRoles, c.submit) || i.actorId !== i.enteredBy)
        throw new WorkflowError(c.submitError);
      return "soumise";
    case "validate1":
      requireNotAuthor(i);
      if (i.status !== "soumise") throw new WorkflowError("Première validation impossible dans cet état");
      if (!can(i.actorRoles, c.validate1)) throw new WorkflowError("Permission refusée");
      return "validee1";
    case "validate2":
      requireNotAuthor(i);
      if (i.status !== "validee1") throw new WorkflowError("Seconde validation impossible dans cet état");
      if (!can(i.actorRoles, c.validate2)) throw new WorkflowError("Permission refusée");
      if (i.validator1Id && i.actorId === i.validator1Id)
        throw new WorkflowError("Les deux validations doivent être faites par deux personnes différentes");
      return "validee";
    case "reject": {
      requireNotAuthor(i);
      if (!i.comment?.trim()) throw new WorkflowError("Un motif de rejet est obligatoire");
      const ok =
        (i.status === "soumise" && can(i.actorRoles, c.validate1)) ||
        (i.status === "validee1" && can(i.actorRoles, c.validate2));
      if (!ok) throw new WorkflowError("Rejet impossible dans cet état ou permission refusée");
      return "rejetee";
    }
  }
}

function requireNotAuthor(i: TransitionInput) {
  if (i.actorId === i.enteredBy)
    throw new WorkflowError("Personne ne valide une écriture qu'il a saisie");
}

export const isEditable = (status: TxStatus) => status === "brouillon" || status === "rejetee";
export const countsInBalances = (status: TxStatus) => status === "validee";

// ---- §27 modification / annulation requests --------------------------------------------------

import type { ChangeRequestStatus } from "./enums";

export type ChangeRequestAction = "approve1" | "approve2" | "reject";

export interface ChangeRequestTransitionInput {
  status: ChangeRequestStatus;
  action: ChangeRequestAction;
  actorId: string;
  requesterId: string;
  actorRoles: readonly Role[];
  comment?: string;
}

/** Returns the next status of a change request or throws WorkflowError. Pure: no I/O. */
export function changeRequestTransition(i: ChangeRequestTransitionInput): ChangeRequestStatus {
  if (i.actorId === i.requesterId) throw new WorkflowError("Le demandeur ne peut pas approuver sa propre demande");
  switch (i.action) {
    case "approve1":
      if (i.status !== "en_attente_tresorier") throw new WorkflowError("Première approbation impossible dans cet état");
      if (!can(i.actorRoles, "transaction.validate1")) throw new WorkflowError("Seul le Trésorier peut approuver en premier");
      return "approuvee_n1";
    case "approve2":
      if (i.status !== "approuvee_n1") throw new WorkflowError("Approbation finale impossible dans cet état");
      if (!can(i.actorRoles, "transaction.validate2")) throw new WorkflowError("Seul le Pasteur peut donner l'approbation finale");
      return "approuvee_n2";
    case "reject": {
      if (!i.comment?.trim()) throw new WorkflowError("Un motif de rejet est obligatoire");
      const ok =
        (i.status === "en_attente_tresorier" && can(i.actorRoles, "transaction.validate1")) ||
        (i.status === "approuvee_n1" && can(i.actorRoles, "transaction.validate2"));
      if (!ok) throw new WorkflowError("Rejet impossible dans cet état ou permission refusée");
      return "rejetee";
    }
  }
}

/** Fields a modification request may change on a validated entry. Amounts/accounts are never editable: cancel and re-enter. */
export const MODIFIABLE_TX_FIELDS = ["description", "beneficiary", "documentNumber", "subCategory", "categoryId", "departmentId", "investmentId"] as const;
export type ModifiableTxField = (typeof MODIFIABLE_TX_FIELDS)[number];

// ---- Immobilisations: état changes and approval requests on assets ---------------------------------

import { ETATS_REQUIRING_OBSERVATION, SENSITIVE_ETATS, type AssetEtat } from "./enums";

/** True when leaving or entering Déclassé / Perdu: such a change must go through the Trésorier → Pasteur circuit. */
export function isSensitiveEtatChange(oldEtat: AssetEtat | null, newEtat: AssetEtat): boolean {
  return SENSITIVE_ETATS.includes(newEtat) || (oldEtat !== null && SENSITIVE_ETATS.includes(oldEtat));
}

/** Rules of §13: a motif is always required; Mauvais / Déclassé / Perdu also need a written justification. */
export function validateEtatChange(i: { oldEtat: AssetEtat | null; newEtat: AssetEtat; reason: string; observation?: string | null }): void {
  if (i.oldEtat === i.newEtat) throw new WorkflowError("L'immobilisation est déjà dans cet état");
  if (!i.reason?.trim()) throw new WorkflowError("Le motif du changement d'état est obligatoire");
  if (ETATS_REQUIRING_OBSERVATION.includes(i.newEtat) && !i.observation?.trim())
    throw new WorkflowError("Une justification est obligatoire pour cet état");
}

/** Who may act next on an asset request: "approve1" (Trésorier), "approve2" (Pasteur) or nobody. Never the requester. */
export function nextApprovalAction(i: {
  status: ChangeRequestStatus; roles: readonly Role[]; userId: string; requesterId: string;
}): "approve1" | "approve2" | null {
  if (i.userId === i.requesterId) return null;
  if (i.status === "en_attente_tresorier" && can(i.roles, "transaction.validate1")) return "approve1";
  if (i.status === "approuvee_n1" && can(i.roles, "transaction.validate2")) return "approve2";
  return null;
}

/**
 * Starting point of an asset request. A requester who is themself the Trésorier (or the Pasteur) cannot
 * approve their own request, so their own level is skipped and only the other approver signs. A requester
 * holding both roles would skip everything, so is refused. The skip is recorded on the request, never silent.
 */
export interface AssetApprovalState { status: ChangeRequestStatus; n1Skipped: boolean; n2Skipped: boolean }

export function initialApprovalState(requesterRoles: readonly Role[]): AssetApprovalState {
  const isTresorier = can(requesterRoles, "transaction.validate1");
  const isPasteur = can(requesterRoles, "transaction.validate2");
  if (isTresorier && isPasteur)
    throw new WorkflowError("Un demandeur cumulant les rôles Trésorier et Pasteur ne peut pas soumettre seul une demande");
  if (isTresorier) return { status: "approuvee_n1", n1Skipped: true, n2Skipped: false };
  return { status: "en_attente_tresorier", n1Skipped: false, n2Skipped: isPasteur };
}

/**
 * changeRequestTransition, plus two rules for assets:
 *  - the creator-skip: when the Pasteur level is skipped, approve1 is final;
 *  - the two levels are two different people: whoever approved level 1 cannot also give the final approval
 *    (roles Trésorier and Pasteur may be held by the same user, which must not turn two signatures into one).
 */
export function assetRequestTransition(i: ChangeRequestTransitionInput & { n2Skipped: boolean; tresorierId?: string | null }): ChangeRequestStatus {
  if (i.action === "approve2" && i.tresorierId && i.actorId === i.tresorierId)
    throw new WorkflowError("Le Trésorier et le Pasteur doivent être deux personnes différentes");
  const next = changeRequestTransition(i);
  return i.action === "approve1" && i.n2Skipped && next === "approuvee_n1" ? "approuvee_n2" : next;
}

// ---- Baptêmes et mariages: Pasteur assistant → Pasteur titulaire ------------------------------------

export type RegistryAction = TxAction | "reopen";

/** Status of a register entry plus the levels skipped at submission (recorded, never silent). */
export interface RegistryState { status: TxStatus; n1Skipped: boolean; n2Skipped: boolean }

/**
 * Where a submitted baptême/mariage starts, with the same creator-skip as asset requests: an author who is the
 * Pasteur assistant skips level 1 (the titulaire signs alone); an author who is the Pasteur titulaire skips level 2
 * (the assistant's signature is final). An author holding both levels would skip everything, so is refused.
 */
export function registrySubmitState(authorRoles: readonly Role[]): RegistryState {
  const isAssistant = can(authorRoles, REGISTRY_CIRCUIT.validate1);
  const isTitulaire = can(authorRoles, REGISTRY_CIRCUIT.validate2);
  if (isAssistant && isTitulaire)
    throw new WorkflowError("Un auteur cumulant les rôles Pasteur assistant et Pasteur titulaire ne peut pas soumettre seul");
  if (isAssistant) return { status: "validee1", n1Skipped: true, n2Skipped: false };
  return { status: "soumise", n1Skipped: false, n2Skipped: isTitulaire };
}

export interface RegistryTransitionInput extends Omit<TransitionInput, "action"> {
  action: RegistryAction;
  n1Skipped: boolean;
  n2Skipped: boolean;
}

/**
 * transition() on REGISTRY_CIRCUIT, plus: the creator-skip (recomputed on every submission), level 1 is final when
 * level 2 was skipped, and "reopen" (Renvoyer en correction): the Pasteur titulaire sends a validated entry back to
 * its author with a motif; once corrected it goes through both levels again.
 */
export function registryTransition(i: RegistryTransitionInput): RegistryState {
  const keep = { n1Skipped: i.n1Skipped, n2Skipped: i.n2Skipped };
  if (i.action === "reopen") {
    if (i.status !== "validee") throw new WorkflowError("Seul un enregistrement validé peut être renvoyé en correction");
    if (!can(i.actorRoles, REGISTRY_CIRCUIT.validate2)) throw new WorkflowError("Seul le Pasteur titulaire peut renvoyer en correction");
    if (!i.comment?.trim()) throw new WorkflowError("Un motif est obligatoire");
    return { status: "rejetee", ...keep };
  }
  const next = transition({ ...i, action: i.action }, REGISTRY_CIRCUIT);
  if (i.action === "submit") return registrySubmitState(i.actorRoles);
  if (i.action === "validate1" && i.n2Skipped) return { status: "validee", ...keep };
  return { status: next, ...keep };
}
