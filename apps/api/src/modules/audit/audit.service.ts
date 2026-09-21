import type { Db } from "@church/db";
import * as repo from "./audit.repo";

export type Viewer = { roles: string[]; parishIds: string[] };

export async function listAuditLog(db: Db, viewer: Viewer) {
  const rows = await repo.listEntries(db, viewer.parishIds, viewer.roles.includes("administrateur"));
  // For actions on a user, also resolve who it was about.
  const targetIds = [...new Set(rows.filter((r) => r.log.entity === "user" && r.log.entityId).map((r) => r.log.entityId!))];
  const targets = targetIds.length ? await repo.listUserNames(db, targetIds) : [];
  const nameOf = new Map(targets.map((t) => [t.id, t.fullName]));
  return rows.map((r) => ({ ...r.log, actorName: r.actorName, actorEmail: r.actorEmail, targetName: r.log.entity === "user" ? nameOf.get(r.log.entityId ?? "") ?? null : null }));
}
