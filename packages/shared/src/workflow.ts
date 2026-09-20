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
export const MODIFIABLE_TX_FIELDS = ["description", "beneficiary", "documentNumber", "subCategory", "categoryId", "departmentId"] as const;
export type ModifiableTxField = (typeof MODIFIABLE_TX_FIELDS)[number];
