import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assetRequestEvents, assetRequests, fixedAssets, users, type Tx } from "@church/db";
import { inList } from "../../services/sql";

export type RequestRow = typeof assetRequests.$inferSelect;
export type RequestInsert = typeof assetRequests.$inferInsert;
export const OPEN_STATUSES = ["en_attente_tresorier", "approuvee_n1"] as const;

const requester = alias(users, "requester");
const tresorier = alias(users, "tresorier");
const pasteur = alias(users, "pasteur");

/** Request joined with the asset it concerns and the names of requester and approvers. */
export const selectRequests = (tx: Tx) =>
  tx.select({
    r: assetRequests, assetCode: fixedAssets.code, assetDescription: fixedAssets.description, assetStatut: fixedAssets.statut, assetCurrency: fixedAssets.currency,
    requesterName: requester.fullName, tresorierName: tresorier.fullName, pasteurName: pasteur.fullName,
  }).from(assetRequests)
    .innerJoin(fixedAssets, eq(fixedAssets.id, assetRequests.assetId))
    .innerJoin(requester, eq(requester.id, assetRequests.requesterId))
    .leftJoin(tresorier, eq(tresorier.id, assetRequests.tresorierId))
    .leftJoin(pasteur, eq(pasteur.id, assetRequests.pasteurId));

export type RequestView = Awaited<ReturnType<typeof selectRequests>>[number];

export const listRequests = (tx: Tx, f: { status?: string; kind?: string; assetId?: string; requesterId?: string }) => {
  const w = [
    f.status ? sql`${assetRequests.status} in (${inList(f.status.split(","))})` : undefined,
    f.kind ? sql`${assetRequests.kind} in (${inList(f.kind.split(","))})` : undefined,
    f.assetId ? eq(assetRequests.assetId, f.assetId) : undefined,
    f.requesterId ? eq(assetRequests.requesterId, f.requesterId) : undefined,
  ].filter(Boolean) as any[];
  return selectRequests(tx).where(and(...w)).orderBy(desc(assetRequests.createdAt)).limit(500);
};

export const findRequestView = async (tx: Tx, id: string) => (await selectRequests(tx).where(eq(assetRequests.id, id)))[0];

export const listEvents = (tx: Tx, requestId: string) =>
  tx.select({ e: assetRequestEvents, actor: users.fullName }).from(assetRequestEvents)
    .innerJoin(users, eq(users.id, assetRequestEvents.actorId))
    .where(eq(assetRequestEvents.requestId, requestId)).orderBy(assetRequestEvents.at);

export const lockRequest = async (tx: Tx, id: string) =>
  (await tx.select().from(assetRequests).where(eq(assetRequests.id, id)).for("update"))[0];

export async function findOpenRequest(tx: Tx, assetId: string) {
  return (await tx.select().from(assetRequests)
    .where(and(eq(assetRequests.assetId, assetId), inArray(assetRequests.status, [...OPEN_STATUSES]))))[0];
}

/** Open request (if any) of each asset, for the register's "demande en cours" badge. */
export async function openRequestsFor(tx: Tx, assetIds: string[]) {
  if (!assetIds.length) return new Map<string, { id: string; kind: string; status: string; reference: string }>();
  const rows = await tx.select({ assetId: assetRequests.assetId, id: assetRequests.id, kind: assetRequests.kind, status: assetRequests.status, reference: assetRequests.reference })
    .from(assetRequests).where(and(inArray(assetRequests.assetId, assetIds), inArray(assetRequests.status, [...OPEN_STATUSES])));
  return new Map(rows.map((r) => [r.assetId, { id: r.id, kind: r.kind, status: r.status, reference: r.reference }]));
}

export async function nextReference(tx: Tx, parishId: string, year: number) {
  const r = await tx.execute(sql`select next_request_reference(${parishId}::uuid, ${year}::int) as ref`);
  return (r as any)[0].ref as string;
}

export async function insertRequest(tx: Tx, values: RequestInsert) {
  const [req] = await tx.insert(assetRequests).values(values).returning();
  return req!;
}

/** `at` uses clock_timestamp(): the events of one transaction (approve, execute…) must stay in the order they happened. */
export const insertEvent = (tx: Tx, values: typeof assetRequestEvents.$inferInsert) => tx.insert(assetRequestEvents).values({ ...values, at: sql`clock_timestamp()` });

export const updateRequest = (tx: Tx, id: string, patch: Partial<RequestInsert>) =>
  tx.update(assetRequests).set(patch).where(eq(assetRequests.id, id));
