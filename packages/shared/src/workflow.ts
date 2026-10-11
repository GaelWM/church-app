import { can } from "./permissions";
import type { Role, TxStatus } from "./enums";

export type TxAction = "submit" | "validate1" | "validate2" | "reject";

export interface TransitionInput {
  status: TxStatus;
  action: TxAction;
  actorId: string;
  enteredBy: string;
  actorRoles: readonly Role[];
  comment?: string;
}

export class WorkflowError extends Error {}

/** Returns the next status or throws WorkflowError. Pure: no I/O. */
export function transition(i: TransitionInput): TxStatus {
  switch (i.action) {
    case "submit":
      if (i.status !== "brouillon" && i.status !== "rejetee")
        throw new WorkflowError("Seules les écritures en brouillon ou rejetées peuvent être soumises");
      if (!can(i.actorRoles, "transaction.create") || i.actorId !== i.enteredBy)
        throw new WorkflowError("Seul le caissier auteur peut soumettre");
      return "soumise";
    case "validate1":
      requireNotAuthor(i);
      if (i.status !== "soumise") throw new WorkflowError("Première validation impossible dans cet état");
      if (!can(i.actorRoles, "transaction.validate1")) throw new WorkflowError("Permission refusée");
      return "validee1";
    case "validate2":
      requireNotAuthor(i);
      if (i.status !== "validee1") throw new WorkflowError("Seconde validation impossible dans cet état");
      if (!can(i.actorRoles, "transaction.validate2")) throw new WorkflowError("Permission refusée");
      return "validee";
    case "reject": {
      requireNotAuthor(i);
      if (!i.comment?.trim()) throw new WorkflowError("Un motif de rejet est obligatoire");
      const ok =
        (i.status === "soumise" && can(i.actorRoles, "transaction.validate1")) ||
        (i.status === "validee1" && can(i.actorRoles, "transaction.validate2"));
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
