import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import {
  acceptsRequests, ASSET_MODIFIABLE_FIELDS, assetRequestTransition, assetSubmitSchema, initialApprovalState,
  localIsoDate, parseAssetCode, WorkflowError,
  type AssetModifiableField, type AssetRequestKind, type ChangeRequestAction, type ChangeRequestStatus, type Role,
} from "@church/shared";
import type { z } from "zod";
import type { assetModificationSchema, assetRequestSchema } from "@church/shared";
import { audit } from "../../services/audit";
import { assertReferences, coefficientText, issuesMessage, rowToInput, serialize } from "../immobilisations/asset-input";
import * as assets from "../immobilisations/immobilisations.repo";
import { getSettings } from "../settings/settings.service";
import type { RequestListQuery } from "./asset-requests.dto";
import * as repo from "./asset-requests.repo";

/** Who is acting: id, the current parish (null in the consolidated view) and their roles in it. */
export type Actor = { userId: string; parishId: string | null; roles: Role[] };
type WriteActor = Actor & { parishId: string };
export type AssetRequestInput = z.infer<typeof assetRequestSchema>;
type Changes = z.infer<typeof assetModificationSchema>;

/** Request field → fixed_assets column. */
const COLUMN: Record<AssetModifiableField, keyof assets.AssetInsert> = {
  description: "description", invoiceNumber: "invoiceNumber", supplierId: "supplierId", acquisitionDate: "acquisitionDate",
  inServiceDate: "inServiceDate", locationId: "locationId", currency: "currency", fxRatePerUsd: "fxRatePerUsd",
  fxRateDate: "fxRateDate", paMinor: "paMinor", faaMinor: "faaMinor", method: "depreciationMethod",
  usefulLifeYears: "usefulLifeYears", observations: "observations", accountCode: "accountCode",
  subaccountCode: "subaccountCode", code: "code",
};

const flat = (x: repo.RequestView) => ({
  ...x.r, assetCode: x.assetCode, assetDescription: x.assetDescription, assetStatut: x.assetStatut, assetCurrency: x.assetCurrency,
  requesterName: x.requesterName, tresorierName: x.tresorierName, pasteurName: x.pasteurName,
});

/** The locked asset of the current parish, or 404. */
async function lockOwnAsset(tx: Tx, actor: Actor, assetId: string) {
  const a = await assets.lockAsset(tx, assetId);
  if (!a || (actor.parishId && a.parishId !== actor.parishId)) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  return a;
}

/**
 * Opens an approval request on an asset. The requester's own approval level, if they hold it, is skipped
 * (and recorded on the request): they can never approve their own request, and the other approver still signs.
 */
export async function startRequest(
  tx: Tx, actor: WriteActor, asset: assets.AssetRow, kind: AssetRequestKind, reason: string,
  proposed: Record<string, unknown> | null, old: Record<string, unknown> | null,
) {
  if (await repo.findOpenRequest(tx, asset.id)) throw new HTTPException(422, { message: "Une demande est déjà en cours pour cette immobilisation" });
  let state;
  try {
    state = initialApprovalState(actor.roles);
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  const reference = await repo.nextReference(tx, asset.parishId, Number(localIsoDate().slice(0, 4)));
  const req = await repo.insertRequest(tx, {
    parishId: asset.parishId, reference, assetId: asset.id, kind, reason, proposedChanges: proposed, oldValues: old,
    status: state.status, n1Skipped: state.n1Skipped, n2Skipped: state.n2Skipped, requesterId: actor.userId,
  });
  await repo.insertEvent(tx, { requestId: req.id, toStatus: state.status, actorId: actor.userId, comment: reason });
  await audit(tx, {
    parishId: asset.parishId, actorId: actor.userId, action: "asset.request.create", entity: "asset_request", entityId: req.id,
    after: {
      reference, assetId: asset.id, assetCode: asset.code, kind, reason, proposedChanges: proposed, oldValues: old, status: state.status,
      ...(state.n1Skipped ? { niveauTresorier: "non requis (le demandeur est Trésorier)" } : {}),
      ...(state.n2Skipped ? { niveauPasteur: "non requis (le demandeur est Pasteur)" } : {}),
    },
  });
  return req;
}

/** Modification: keep only the fields that really differ, and check the asset would still be valid with them. */
async function prepareModification(tx: Tx, asset: assets.AssetRow, changes: Changes) {
  const current: Record<string, unknown> = { ...rowToInput(asset), code: asset.code };
  const proposed: Record<string, unknown> = {};
  for (const f of ASSET_MODIFIABLE_FIELDS) {
    if (!(f in changes)) continue;
    let v = serialize((changes as Record<string, unknown>)[f]);
    if (v === "") v = null;
    if ((current[f] ?? null) !== (v ?? null)) proposed[f] = v;
  }
  if (!Object.keys(proposed).length) throw new HTTPException(422, { message: "Aucune modification proposée" });
  // The frozen exchange rate belongs to the currency it was recorded for: changing the currency drops it unless a new one is given.
  if ("currency" in proposed && !("fxRatePerUsd" in proposed) && current.fxRatePerUsd != null) proposed.fxRatePerUsd = null;

  await assertReferences(tx, asset.parishId, {
    locationId: proposed.locationId as string | undefined, supplierId: proposed.supplierId as string | null | undefined,
  });

  const { code, ...rest } = proposed;
  const check = assetSubmitSchema.safeParse({ ...rowToInput(asset), ...rest });
  if (!check.success) throw new HTTPException(422, { message: issuesMessage(check.error) });

  if (typeof code === "string") {
    // Exceptional: the code is never freely editable. It stays unique and keeps a registered acronym.
    if (await assets.codeTaken(tx, asset.parishId, code, asset.id)) throw new HTTPException(422, { message: "Ce code est déjà utilisé" });
    await assertReferences(tx, asset.parishId, { acronym: parseAssetCode(code)!.acronym });
  }
  const old = Object.fromEntries(Object.keys(proposed).map((k) => [k, current[k] ?? null]));
  return { proposed, old };
}

/** Modification or annulation of a validated asset. Creation and état requests have their own entry points. */
export async function createRequest(tx: Tx, actor: WriteActor, assetId: string, b: AssetRequestInput) {
  const asset = await lockOwnAsset(tx, actor, assetId);
  if (!acceptsRequests(asset.statut as never))
    throw new HTTPException(422, { message: "Seule une immobilisation active peut faire l'objet d'une demande" });
  let proposed: Record<string, unknown> | null = null;
  let old: Record<string, unknown> | null = null;
  if (b.kind === "modification") ({ proposed, old } = await prepareModification(tx, asset, b.changes!));
  const req = await startRequest(tx, actor, asset, b.kind, b.reason, proposed, old);
  return requestView(tx, req.id);
}

/** A request with the names of requester and approvers: what the API returns when one is opened. */
export async function requestView(tx: Tx, id: string) {
  const x = await repo.findRequestView(tx, id);
  if (!x) throw new HTTPException(404, { message: "Demande introuvable" });
  return flat(x);
}

export async function listRequests(tx: Tx, actor: Actor, q: RequestListQuery) {
  const rows = await repo.listRequests(tx, { status: q.status, kind: q.kind, assetId: q.assetId, requesterId: q.mine === "1" ? actor.userId : undefined });
  return rows.map(flat);
}

export async function getRequest(tx: Tx, id: string) {
  const x = await repo.findRequestView(tx, id);
  if (!x) throw new HTTPException(404, { message: "Demande introuvable" });
  const events = await repo.listEvents(tx, id);
  return { ...flat(x), events: events.map((e) => ({ ...e.e, actorName: e.actor })) };
}

/** Who signed what, written into the audit trail of the executed change. */
async function approvals(tx: Tx, req: repo.RequestRow) {
  const who = async (id: string | null) => (id ? { userId: id, name: await assets.userName(tx, id) } : null);
  return {
    request: req.reference, reason: req.reason,
    tresorier: req.n1Skipped ? { nonRequis: "le demandeur est Trésorier" } : { ...(await who(req.tresorierId)), at: req.tresorierAt },
    pasteur: req.n2Skipped ? { nonRequis: "le demandeur est Pasteur" } : { ...(await who(req.pasteurId)), at: req.pasteurAt },
  };
}

/** Runs inside the final approval's DB transaction: applies the approved request to the (frozen) asset. */
async function execute(tx: Tx, req: repo.RequestRow, actorId: string) {
  const asset = await assets.lockAsset(tx, req.assetId);
  if (!asset) throw new HTTPException(404, { message: "Immobilisation introuvable" });
  await assets.allowGuardedChange(tx);
  const proof = await approvals(tx, req);
  const base = { parishId: asset.parishId, actorId, entity: "fixed_asset", entityId: asset.id };

  if (req.kind === "creation") {
    if (asset.statut !== "en_attente_validation") throw new HTTPException(422, { message: "L'immobilisation n'est plus en attente de validation" });
    await assets.updateAsset(tx, asset.id, { statut: "actif" });
    // The history starts at the acquisition, with the initial état "Bon".
    await assets.insertHistory(tx, {
      parishId: asset.parishId, assetId: asset.id, oldEtat: null, newEtat: "bon", reason: "Acquisition",
      locationId: asset.locationId, actorId: req.requesterId, requestId: req.id, validationStatus: "approuve",
    });
    await audit(tx, { ...base, action: "asset.activate", before: { statut: asset.statut }, after: { statut: "actif", code: asset.code, ...proof } });
    return;
  }

  if (asset.statut !== "actif") throw new HTTPException(422, { message: "L'immobilisation n'est plus active" });

  if (req.kind === "annulation") {
    await assets.updateAsset(tx, asset.id, { statut: "annule" });
    await audit(tx, { ...base, action: "asset.cancel", before: { statut: asset.statut }, after: { statut: "annule", ...proof } });
    return;
  }

  if (req.kind === "changement_etat") {
    const p = (req.proposedChanges ?? {}) as { newEtat: string; observation: string | null };
    const history = await assets.insertHistory(tx, {
      parishId: asset.parishId, assetId: asset.id, oldEtat: asset.etat, newEtat: p.newEtat, reason: req.reason,
      observation: p.observation, locationId: asset.locationId, actorId: req.requesterId, requestId: req.id, validationStatus: "approuve",
    });
    await audit(tx, {
      ...base, action: "asset.etat_change", before: { etat: asset.etat },
      after: { etat: p.newEtat, observation: p.observation, historyId: history.id, ...proof },
    });
    return;
  }

  // modification
  const changes = (req.proposedChanges ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const f of ASSET_MODIFIABLE_FIELDS) {
    if (!(f in changes)) continue;
    patch[COLUMN[f]] = f === "paMinor" || f === "faaMinor" ? BigInt(changes[f] as string) : changes[f];
  }
  if (typeof changes.code === "string") {
    if (await assets.codeTaken(tx, asset.parishId, changes.code, asset.id)) throw new HTTPException(422, { message: "Ce code est déjà utilisé" });
    patch.acronym = parseAssetCode(changes.code)!.acronym;
  }
  if ("fxRatePerUsd" in changes && !("fxRateDate" in changes)) patch.fxRateDate = changes.fxRatePerUsd ? localIsoDate() : null;
  if ("method" in changes || "usefulLifeYears" in changes) {
    const table = (await getSettings(tx, asset.parishId)).asset_degressive_coefficients;
    const method = (patch.depreciationMethod ?? asset.depreciationMethod) as string;
    const years = ("usefulLifeYears" in patch ? patch.usefulLifeYears : asset.usefulLifeYears) as number | null;
    patch.degressiveCoefficient = coefficientText(method, years, table);
  }
  await assets.updateAsset(tx, asset.id, patch as Partial<assets.AssetInsert>);
  await audit(tx, { ...base, action: "asset.modify", before: req.oldValues, after: { ...changes, ...proof } });
  if (typeof changes.code === "string")
    await audit(tx, { ...base, action: "asset.code_change", before: { code: asset.code }, after: { code: changes.code, exceptionnel: true, ...proof } });
}

export async function decide(tx: Tx, actor: Actor, id: string, action: ChangeRequestAction, comment?: string) {
  const req = await repo.lockRequest(tx, id);
  if (!req) throw new HTTPException(404, { message: "Demande introuvable" });
  if (req.kind === "creation" && action !== "reject") {
    // Whoever entered the asset does not validate it, even when a colleague pressed "submit".
    const asset = await assets.findAsset(tx, req.assetId);
    if (asset?.createdBy === actor.userId) throw new HTTPException(422, { message: "Celui qui a saisi l'immobilisation ne peut pas la valider" });
  }
  let next: ChangeRequestStatus;
  try {
    next = assetRequestTransition({
      status: req.status as ChangeRequestStatus, action, actorId: actor.userId, requesterId: req.requesterId,
      actorRoles: actor.roles, comment, n2Skipped: req.n2Skipped, tresorierId: req.tresorierId,
    });
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  const now = new Date();
  const stamp = action === "approve1" ? { tresorierId: actor.userId, tresorierAt: now }
    : action === "approve2" ? { pasteurId: actor.userId, pasteurAt: now }
    : { rejectedReason: comment };
  await repo.updateRequest(tx, id, { status: next, ...stamp });
  await repo.insertEvent(tx, { requestId: id, fromStatus: req.status, toStatus: next, actorId: actor.userId, comment: comment || null });
  await audit(tx, {
    parishId: req.parishId, actorId: actor.userId, action: `asset.request.${action}`, entity: "asset_request", entityId: id,
    before: { status: req.status }, after: { status: next, comment, ...(action === "reject" ? { reference: req.reference, kind: req.kind } : {}) },
  });

  if (next === "rejetee" && req.kind === "creation") {
    // Back to a draft the registrar can correct and submit again; the rejection stays in the request's history.
    const asset = await assets.lockAsset(tx, req.assetId);
    if (asset?.statut === "en_attente_validation") {
      await assets.allowGuardedChange(tx);
      await assets.updateAsset(tx, asset.id, { statut: "brouillon" });
      await audit(tx, {
        parishId: asset.parishId, actorId: actor.userId, action: "asset.rejected", entity: "fixed_asset", entityId: asset.id,
        before: { statut: "en_attente_validation" }, after: { statut: "brouillon", reason: comment, request: req.reference },
      });
    }
  }

  if (next === "approuvee_n2") {
    await execute(tx, { ...req, ...stamp, status: next } as repo.RequestRow, actor.userId);
    await repo.updateRequest(tx, id, { status: "executee", executedAt: new Date() });
    await repo.insertEvent(tx, { requestId: id, fromStatus: "approuvee_n2", toStatus: "executee", actorId: actor.userId });
    await audit(tx, {
      parishId: req.parishId, actorId: actor.userId, action: "asset.request.execute", entity: "asset_request", entityId: id,
      before: { status: "approuvee_n2" }, after: { status: "executee", kind: req.kind, reference: req.reference },
    });
  }
  const full = await repo.findRequestView(tx, id);
  return flat(full!);
}
