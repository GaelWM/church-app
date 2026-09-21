import type { Db } from "@church/db";
import type { z } from "zod";
import type { parishSchema } from "@church/shared";
import { audit } from "../../services/audit";
import type { ParishUpdateInput } from "./parishes.dto";
import * as repo from "./parishes.repo";

export async function createParish(db: Db, actorId: string, b: z.infer<typeof parishSchema>) {
  const p = await repo.insertParish(db, b);
  // Creator administers what they create.
  await repo.insertAdminRole(db, actorId, p!.id);
  await db.transaction((tx) => audit(tx, { parishId: p!.id, actorId, action: "parish.create", entity: "parish", entityId: p!.id, after: p }));
  return p;
}

export async function updateParish(db: Db, actorId: string, id: string, b: ParishUpdateInput) {
  const p = await repo.updateParish(db, id, b);
  await db.transaction((tx) => audit(tx, { parishId: p!.id, actorId, action: "parish.update", entity: "parish", entityId: p!.id, after: p }));
  return p;
}
