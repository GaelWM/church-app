import { expect, test } from "bun:test";
import {
  assetRequestTransition, ATTENDANCE_CIRCUIT, changeRequestTransition, initialApprovalState, isSensitiveEtatChange, nextApprovalAction,
  registrySubmitState, registryTransition, transition, validateEtatChange, WorkflowError,
} from "./workflow";
import { FINANCE_ROLES, findRoleConflict, can } from "./permissions";

const base = { enteredBy: "c1" };

test("happy path", () => {
  expect(transition({ ...base, status: "brouillon", action: "submit", actorId: "c1", actorRoles: ["caissier"] })).toBe("soumise");
  expect(transition({ ...base, status: "soumise", action: "validate1", actorId: "t1", actorRoles: ["tresorier"] })).toBe("validee1");
  expect(transition({ ...base, status: "validee1", action: "validate2", actorId: "p1", actorRoles: ["pasteur"] })).toBe("validee");
});

test("no self validation even with two profiles", () => {
  expect(() => transition({ ...base, status: "soumise", action: "validate1", actorId: "c1", actorRoles: ["caissier", "tresorier"] })).toThrow(WorkflowError);
});

test("reject needs reason; wrong role blocked", () => {
  expect(() => transition({ ...base, status: "soumise", action: "reject", actorId: "t1", actorRoles: ["tresorier"] })).toThrow();
  expect(transition({ ...base, status: "validee1", action: "reject", actorId: "p1", actorRoles: ["pasteur"], comment: "erreur" })).toBe("rejetee");
  expect(() => transition({ ...base, status: "validee1", action: "validate1", actorId: "t1", actorRoles: ["tresorier"] })).toThrow();
});

test("rejected can be resubmitted; validated is terminal", () => {
  expect(transition({ ...base, status: "rejetee", action: "submit", actorId: "c1", actorRoles: ["caissier"] })).toBe("soumise");
  expect(() => transition({ ...base, status: "validee", action: "submit", actorId: "c1", actorRoles: ["caissier"] })).toThrow();
});

test("permissions and role conflicts", () => {
  expect(can(["administrateur"], "transaction.create")).toBe(false);
  expect(can(["pasteur"], "audit.view")).toBe(true);
  expect(findRoleConflict(["tresorier", "caissier"])).not.toBeNull();
  expect(findRoleConflict(["tresorier"])).toBeNull();
});

test("§27 change request: two-step approval", () => {
  const b = { requesterId: "c1" };
  expect(changeRequestTransition({ ...b, status: "en_attente_tresorier", action: "approve1", actorId: "t1", actorRoles: ["tresorier"] })).toBe("approuvee_n1");
  expect(changeRequestTransition({ ...b, status: "approuvee_n1", action: "approve2", actorId: "p1", actorRoles: ["pasteur"] })).toBe("approuvee_n2");
  // cannot skip the Trésorier step
  expect(() => changeRequestTransition({ ...b, status: "en_attente_tresorier", action: "approve2", actorId: "p1", actorRoles: ["pasteur"] })).toThrow(WorkflowError);
});

test("§27 change request: requester cannot approve, roles enforced, reject needs comment", () => {
  const b = { requesterId: "c1" };
  expect(() => changeRequestTransition({ ...b, status: "en_attente_tresorier", action: "approve1", actorId: "c1", actorRoles: ["caissier", "tresorier"] })).toThrow(WorkflowError);
  expect(() => changeRequestTransition({ ...b, status: "approuvee_n1", action: "approve2", actorId: "t1", actorRoles: ["tresorier"] })).toThrow(WorkflowError);
  expect(() => changeRequestTransition({ ...b, status: "en_attente_tresorier", action: "reject", actorId: "t1", actorRoles: ["tresorier"] })).toThrow(WorkflowError);
  expect(changeRequestTransition({ ...b, status: "approuvee_n1", action: "reject", actorId: "p1", actorRoles: ["pasteur"], comment: "non" })).toBe("rejetee");
  expect(() => changeRequestTransition({ ...b, status: "executee", action: "reject", actorId: "p1", actorRoles: ["pasteur"], comment: "non" })).toThrow(WorkflowError);
});

// ---- Immobilisations: état changes and asset requests ---------------------------------------------

test("sensitive état changes: entering or leaving Déclassé / Perdu", () => {
  expect(isSensitiveEtatChange(null, "bon")).toBe(false);
  expect(isSensitiveEtatChange("bon", "mauvais")).toBe(false);
  expect(isSensitiveEtatChange("mauvais", "bon")).toBe(false);
  expect(isSensitiveEtatChange("bon", "declasse")).toBe(true);
  expect(isSensitiveEtatChange("mauvais", "perdu")).toBe(true);
  expect(isSensitiveEtatChange("perdu", "bon")).toBe(true);
  expect(isSensitiveEtatChange("declasse", "mauvais")).toBe(true);
});

test("état change rules: motif always, justification for Mauvais / Déclassé / Perdu", () => {
  expect(() => validateEtatChange({ oldEtat: "bon", newEtat: "bon", reason: "x" })).toThrow(WorkflowError);
  expect(() => validateEtatChange({ oldEtat: "mauvais", newEtat: "bon", reason: " " })).toThrow(WorkflowError);
  expect(() => validateEtatChange({ oldEtat: "mauvais", newEtat: "bon", reason: "Réparation" })).not.toThrow();
  for (const newEtat of ["mauvais", "declasse", "perdu"] as const) {
    expect(() => validateEtatChange({ oldEtat: "bon", newEtat, reason: "Panne" })).toThrow(WorkflowError);
    expect(() => validateEtatChange({ oldEtat: "bon", newEtat, reason: "Panne", observation: "Écran cassé" })).not.toThrow();
  }
  expect(() => validateEtatChange({ oldEtat: null, newEtat: "bon", reason: "Acquisition" })).not.toThrow();
});

test("nextApprovalAction: Trésorier first, then Pasteur, never the requester", () => {
  const b = { requesterId: "c1" };
  expect(nextApprovalAction({ ...b, status: "en_attente_tresorier", roles: ["tresorier"], userId: "t1" })).toBe("approve1");
  expect(nextApprovalAction({ ...b, status: "en_attente_tresorier", roles: ["pasteur"], userId: "p1" })).toBeNull();
  expect(nextApprovalAction({ ...b, status: "approuvee_n1", roles: ["pasteur"], userId: "p1" })).toBe("approve2");
  expect(nextApprovalAction({ ...b, status: "approuvee_n1", roles: ["tresorier"], userId: "t1" })).toBeNull();
  expect(nextApprovalAction({ ...b, status: "en_attente_tresorier", roles: ["tresorier"], userId: "c1" })).toBeNull();
  expect(nextApprovalAction({ ...b, status: "en_attente_tresorier", roles: ["auditeur"], userId: "a1" })).toBeNull();
  expect(nextApprovalAction({ ...b, status: "executee", roles: ["pasteur", "tresorier"], userId: "p1" })).toBeNull();
});

test("initialApprovalState: a creator holding an approval role skips only their own level", () => {
  expect(initialApprovalState(["administrateur"])).toEqual({ status: "en_attente_tresorier", n1Skipped: false, n2Skipped: false });
  expect(initialApprovalState(["caissier"])).toEqual({ status: "en_attente_tresorier", n1Skipped: false, n2Skipped: false });
  expect(initialApprovalState(["tresorier"])).toEqual({ status: "approuvee_n1", n1Skipped: true, n2Skipped: false });
  expect(initialApprovalState(["pasteur"])).toEqual({ status: "en_attente_tresorier", n1Skipped: false, n2Skipped: true });
  // would skip every level: refused
  expect(() => initialApprovalState(["tresorier", "pasteur"])).toThrow(WorkflowError);
});

test("assetRequestTransition: normal flow, Trésorier-created and Pasteur-created requests", () => {
  const normal = { requesterId: "adm1", n2Skipped: false };
  expect(assetRequestTransition({ ...normal, status: "en_attente_tresorier", action: "approve1", actorId: "t1", actorRoles: ["tresorier"] })).toBe("approuvee_n1");
  expect(assetRequestTransition({ ...normal, status: "approuvee_n1", action: "approve2", actorId: "p1", actorRoles: ["pasteur"] })).toBe("approuvee_n2");
  // created by the Trésorier: starts at approuvee_n1, only the Pasteur signs
  const byTresorier = { requesterId: "t1", n2Skipped: false };
  expect(assetRequestTransition({ ...byTresorier, status: "approuvee_n1", action: "approve2", actorId: "p1", actorRoles: ["pasteur"] })).toBe("approuvee_n2");
  expect(() => assetRequestTransition({ ...byTresorier, status: "approuvee_n1", action: "approve2", actorId: "t1", actorRoles: ["tresorier", "pasteur"] })).toThrow(WorkflowError);
  expect(() => assetRequestTransition({ ...byTresorier, status: "approuvee_n1", action: "approve1", actorId: "t2", actorRoles: ["tresorier"] })).toThrow(WorkflowError);
  // created by the Pasteur: the Trésorier's approval is final
  const byPasteur = { requesterId: "p1", n2Skipped: true };
  expect(assetRequestTransition({ ...byPasteur, status: "en_attente_tresorier", action: "approve1", actorId: "t1", actorRoles: ["tresorier"] })).toBe("approuvee_n2");
  expect(() => assetRequestTransition({ ...byPasteur, status: "en_attente_tresorier", action: "approve2", actorId: "p1", actorRoles: ["pasteur"] })).toThrow(WorkflowError);
});

test("assetRequestTransition: rejection needs a motif and the right approver", () => {
  const b = { requesterId: "adm1", n2Skipped: false };
  expect(() => assetRequestTransition({ ...b, status: "en_attente_tresorier", action: "reject", actorId: "t1", actorRoles: ["tresorier"] })).toThrow(WorkflowError);
  expect(assetRequestTransition({ ...b, status: "en_attente_tresorier", action: "reject", actorId: "t1", actorRoles: ["tresorier"], comment: "Doublon" })).toBe("rejetee");
  expect(assetRequestTransition({ ...b, status: "approuvee_n1", action: "reject", actorId: "p1", actorRoles: ["pasteur"], comment: "Montant erroné" })).toBe("rejetee");
});

test("the two levels are two different people, even when one user holds both roles", () => {
  const base = { requesterId: "adm1", n2Skipped: false, status: "approuvee_n1" as const, action: "approve2" as const };
  // "both" signed level 1, so cannot give the final approval too
  expect(() => assetRequestTransition({ ...base, actorId: "both", actorRoles: ["tresorier", "pasteur"], tresorierId: "both" })).toThrow(WorkflowError);
  // another Pasteur can; and without a recorded Trésorier (level skipped) there is nobody to conflict with
  expect(assetRequestTransition({ ...base, actorId: "p1", actorRoles: ["pasteur"], tresorierId: "both" })).toBe("approuvee_n2");
  expect(assetRequestTransition({ ...base, actorId: "both", actorRoles: ["tresorier", "pasteur"], tresorierId: null })).toBe("approuvee_n2");
});

// ---- Effectifs des cultes, baptêmes, mariages: Pasteur assistant → Pasteur titulaire --------------------

test("attendance circuit: the Caissier counts, the Pasteur assistant then the Pasteur titulaire validate", () => {
  const a = { enteredBy: "c1" };
  expect(transition({ ...a, status: "brouillon", action: "submit", actorId: "c1", actorRoles: ["caissier"] }, ATTENDANCE_CIRCUIT)).toBe("soumise");
  expect(() => transition({ ...a, status: "soumise", action: "validate1", actorId: "t1", actorRoles: ["tresorier"] }, ATTENDANCE_CIRCUIT)).toThrow(WorkflowError);
  expect(transition({ ...a, status: "soumise", action: "validate1", actorId: "a1", actorRoles: ["pasteur_assistant"] }, ATTENDANCE_CIRCUIT)).toBe("validee1");
  expect(() => transition({ ...a, status: "validee1", action: "validate2", actorId: "a1", actorRoles: ["pasteur_assistant"] }, ATTENDANCE_CIRCUIT)).toThrow(WorkflowError);
  expect(transition({ ...a, status: "validee1", action: "validate2", actorId: "p1", actorRoles: ["pasteur"] }, ATTENDANCE_CIRCUIT)).toBe("validee");
  expect(() => transition({ ...a, status: "soumise", action: "reject", actorId: "t1", actorRoles: ["tresorier"], comment: "non" }, ATTENDANCE_CIRCUIT)).toThrow(WorkflowError);
  expect(() => transition({ ...a, status: "soumise", action: "reject", actorId: "a1", actorRoles: ["pasteur_assistant"] }, ATTENDANCE_CIRCUIT)).toThrow(WorkflowError);
  // the finance circuit is unchanged: the assistant has no say there
  expect(() => transition({ ...a, status: "soumise", action: "validate1", actorId: "a1", actorRoles: ["pasteur_assistant"] })).toThrow(WorkflowError);
});

test("the two levels are signed by two different people when level 1 is recorded", () => {
  const both = ["pasteur_assistant", "pasteur"] as const;
  expect(() => transition({ enteredBy: "c1", status: "validee1", action: "validate2", actorId: "x", actorRoles: both, validator1Id: "x" }, ATTENDANCE_CIRCUIT)).toThrow(WorkflowError);
  expect(transition({ enteredBy: "c1", status: "validee1", action: "validate2", actorId: "x", actorRoles: both, validator1Id: "y" }, ATTENDANCE_CIRCUIT)).toBe("validee");
});

test("registers: an Évangélisation author goes through both levels", () => {
  const r = { enteredBy: "e1", n1Skipped: false, n2Skipped: false };
  expect(registryTransition({ ...r, status: "brouillon", action: "submit", actorId: "e1", actorRoles: ["evangelisation"] })).toEqual({ status: "soumise", n1Skipped: false, n2Skipped: false });
  expect(() => registryTransition({ ...r, status: "brouillon", action: "submit", actorId: "c1", actorRoles: ["caissier"] })).toThrow(WorkflowError);
  expect(registryTransition({ ...r, status: "soumise", action: "validate1", actorId: "a1", actorRoles: ["pasteur_assistant"] }).status).toBe("validee1");
  expect(() => registryTransition({ ...r, status: "validee1", action: "validate2", actorId: "a1", actorRoles: ["pasteur_assistant"] })).toThrow(WorkflowError);
  expect(registryTransition({ ...r, status: "validee1", action: "validate2", actorId: "p1", actorRoles: ["pasteur"], validator1Id: "a1" }).status).toBe("validee");
  expect(() => registryTransition({ ...r, status: "validee", action: "submit", actorId: "e1", actorRoles: ["evangelisation"] })).toThrow(WorkflowError);
});

test("registers: creator-skip — the author's own level is skipped and recorded, never both", () => {
  expect(registrySubmitState(["pasteur_assistant"])).toEqual({ status: "validee1", n1Skipped: true, n2Skipped: false });
  expect(registrySubmitState(["pasteur"])).toEqual({ status: "soumise", n1Skipped: false, n2Skipped: true });
  expect(registrySubmitState(["caissier"])).toEqual({ status: "soumise", n1Skipped: false, n2Skipped: false });
  expect(() => registrySubmitState(["pasteur_assistant", "pasteur"])).toThrow(WorkflowError);
  // a titulaire's entry: the assistant's signature is final
  const p = { enteredBy: "p1", n1Skipped: false, n2Skipped: true };
  expect(registryTransition({ ...p, status: "soumise", action: "validate1", actorId: "a1", actorRoles: ["pasteur_assistant"] }).status).toBe("validee");
  // resubmission after a rejection recomputes the flags from the author's roles
  expect(registryTransition({ enteredBy: "a1", n1Skipped: false, n2Skipped: false, status: "rejetee", action: "submit", actorId: "a1", actorRoles: ["pasteur_assistant"] }))
    .toEqual({ status: "validee1", n1Skipped: true, n2Skipped: false });
});

test("registers: rejection needs a motif; only the titulaire sends a validated entry back for correction", () => {
  const r = { enteredBy: "e1", n1Skipped: false, n2Skipped: false };
  expect(() => registryTransition({ ...r, status: "soumise", action: "reject", actorId: "a1", actorRoles: ["pasteur_assistant"] })).toThrow(WorkflowError);
  expect(registryTransition({ ...r, status: "soumise", action: "reject", actorId: "a1", actorRoles: ["pasteur_assistant"], comment: "date" }).status).toBe("rejetee");
  expect(() => registryTransition({ ...r, status: "validee", action: "reopen", actorId: "a1", actorRoles: ["pasteur_assistant"], comment: "x" })).toThrow(WorkflowError);
  expect(() => registryTransition({ ...r, status: "validee", action: "reopen", actorId: "p1", actorRoles: ["pasteur"] })).toThrow(WorkflowError);
  expect(() => registryTransition({ ...r, status: "soumise", action: "reopen", actorId: "p1", actorRoles: ["pasteur"], comment: "x" })).toThrow(WorkflowError);
  expect(registryTransition({ ...r, status: "validee", action: "reopen", actorId: "p1", actorRoles: ["pasteur"], comment: "nom" }).status).toBe("rejetee");
});

test("Pasteur assistant: registers and level-1 validation only, no financial permission; conflicting roles", () => {
  expect(can(["pasteur_assistant"], "registry.write")).toBe(true);
  expect(can(["pasteur_assistant"], "registry.validate1")).toBe(true);
  for (const p of ["registry.validate2", "transaction.create", "transaction.validate1", "transaction.validate2", "transaction.readAll",
    "transaction.readOwn", "report.export", "audit.view", "config.manage", "budget.manage", "asset.manage"] as const)
    expect(can(["pasteur_assistant"], p)).toBe(false);
  expect(can(["pasteur"], "registry.validate2")).toBe(true);
  expect(can(["tresorier"], "registry.validate1")).toBe(false);
  for (const r of ["pasteur", "caissier", "administrateur", "auditeur"] as const) expect(findRoleConflict(["pasteur_assistant", r])).not.toBeNull();
  expect(findRoleConflict(["pasteur_assistant", "evangelisation"])).toBeNull();
  expect(FINANCE_ROLES).not.toContain("pasteur_assistant");
  expect(FINANCE_ROLES).not.toContain("evangelisation");
  expect(FINANCE_ROLES).toContain("pasteur");
});
