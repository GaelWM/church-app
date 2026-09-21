import type { Tx } from "@church/db";
import { audit } from "../../services/audit";
import type { DepartmentCreateInput } from "./departments.dto";
import * as repo from "./departments.repo";

export type Actor = { userId: string; parishId: string };

export const listDepartments = (tx: Tx) => repo.listDepartments(tx);

export async function createDepartment(tx: Tx, actor: Actor, b: DepartmentCreateInput) {
  const d = await repo.insertDepartment(tx, actor.parishId, b.name);
  await audit(tx, { parishId: d!.parishId, actorId: actor.userId, action: "department.create", entity: "department", entityId: d!.id, after: d });
  return d!;
}
