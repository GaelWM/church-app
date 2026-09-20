import { expect, test } from "bun:test";
import { changeRequestTransition, transition, WorkflowError } from "./workflow";
import { findRoleConflict, can } from "./permissions";

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
