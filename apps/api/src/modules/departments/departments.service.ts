import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { normalizeDepartmentName } from "@church/shared";
import { audit } from "../../services/audit";
import type { DepartmentCreateInput, DepartmentUpdateInput } from "./departments.dto";
import * as repo from "./departments.repo";

export type Actor = { userId: string; parishId: string };

export const listDepartments = (tx: Tx) => repo.listDepartments(tx);

/** No unique constraint in the table: refuse a name equal, case and accents aside, to another department of the parish. */
async function assertUniqueName(tx: Tx, parishId: string, name: string, exceptId?: string) {
  const key = normalizeDepartmentName(name);
  const clash = (await repo.listParishDepartments(tx, parishId)).find((d) => d.id !== exceptId && normalizeDepartmentName(d.name) === key);
  if (clash) throw new HTTPException(409, { message: `Ce département existe déjà (« ${clash.name} »)` });
}

export async function createDepartment(tx: Tx, actor: Actor, b: DepartmentCreateInput) {
  await assertUniqueName(tx, actor.parishId, b.name);
  const d = await repo.insertDepartment(tx, actor.parishId, b.name);
  await audit(tx, { parishId: d!.parishId, actorId: actor.userId, action: "department.create", entity: "department", entityId: d!.id, after: d });
  return d!;
}

export async function renameDepartment(tx: Tx, actor: Actor, id: string, b: DepartmentUpdateInput) {
  const before = await repo.findDepartment(tx, id, actor.parishId);
  if (!before) throw new HTTPException(404, { message: "Département introuvable" });
  await assertUniqueName(tx, actor.parishId, b.name, before.id);
  const d = await repo.updateDepartment(tx, before.id, b.name);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "department.update", entity: "department", entityId: before.id, before, after: d });
  return d!;
}
