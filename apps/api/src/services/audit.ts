import { auditLog, type Tx } from "@church/db";

export async function audit(
  tx: Tx,
  e: { parishId?: string | null; actorId: string; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
) {
  await tx.insert(auditLog).values({
    parishId: e.parishId ?? null, actorId: e.actorId, action: e.action, entity: e.entity,
    entityId: e.entityId, before: (e.before ?? null) as any, after: (e.after ?? null) as any,
  });
}
