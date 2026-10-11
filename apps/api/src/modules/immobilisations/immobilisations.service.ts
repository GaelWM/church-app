import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import {
  assetSubmitSchema, buildSchedule, codePeriod, isSensitiveEtatChange, localIsoDate, validateEtatChange, WorkflowError,
  type AssetDraftInput, type AssetEtat, type Role,
} from "@church/shared";
import type { z } from "zod";
import type { etatChangeSchema } from "@church/shared";
import { audit } from "../../services/audit";
import * as requests from "../asset-requests/asset-requests.repo";
import * as files from "./asset-files";
import { requestView, startRequest } from "../asset-requests/asset-requests.service";
import { getSettings } from "../settings/settings.service";
import { assertReferences, coefficientText, issuesMessage, rowToInput } from "./asset-input";
import { costOf, depreciationInput, toView } from "./asset-view";
import type { ListQuery } from "./immobilisations.dto";
import * as repo from "./immobilisations.repo";

export type Actor = { userId: string; parishId: string; roles: Role[] };
export type EtatChangeInput = z.infer<typeof etatChangeSchema>;

const notFound = () => new HTTPException(404, { message: "Immobilisation introuvable" });
const fromAsOf = (asOf?: string) => asOf ?? localIsoDate();

async function lockOwn(tx: Tx, actor: Actor, id: string) {
  const a = await repo.lockAsset(tx, id);
  if (!a || a.parishId !== actor.parishId) throw notFound();
  return a;
}

/** A draft is the only state a registrar may edit directly; everything else goes through a request. */
function assertDraft(statut: string) {
  if (statut === "brouillon") return;
  throw new HTTPException(422, {
    message: statut === "en_attente_validation"
      ? "Immobilisation en attente de validation: elle ne peut plus être modifiée"
      : "Immobilisation validée: utiliser une demande de modification",
  });
}

// ---- reading ----------------------------------------------------------------------------------------------

export async function listAssets(tx: Tx, q: ListQuery) {
  const asOf = fromAsOf(q.asOf);
  const rows = await repo.listAssets(tx, q);
  const total = await repo.countAssets(tx, q);
  const open = await requests.openRequestsFor(tx, rows.map((r) => r.a.id));
  return { rows: rows.map((r) => toView(r, asOf, open.get(r.a.id) ?? null)), total, page: q.page, pageSize: q.pageSize, asOf };
}

export async function getAsset(tx: Tx, id: string, asOf?: string) {
  const r = await repo.findAssetView(tx, id);
  if (!r) throw notFound();
  const open = await requests.findOpenRequest(tx, id);
  const view = toView(r, fromAsOf(asOf), open ? { id: open.id, kind: open.kind, status: open.status, reference: open.reference } : null);
  return { ...view, schedule: buildSchedule(depreciationInput(r.a)) };
}

// ---- drafts -------------------------------------------------------------------------------------------------

const toColumns = (b: AssetDraftInput, coefficients: Parameters<typeof coefficientText>[2]) => ({
  acronym: b.acronym, accountCode: b.accountCode, subaccountCode: b.subaccountCode, description: b.description,
  invoiceNumber: b.invoiceNumber, supplierId: b.supplierId, acquisitionDate: b.acquisitionDate, inServiceDate: b.inServiceDate,
  locationId: b.locationId, currency: b.currency, fxRatePerUsd: b.fxRatePerUsd,
  fxRateDate: b.fxRateDate ?? (b.fxRatePerUsd ? localIsoDate() : null),
  paMinor: b.paMinor, faaMinor: b.faaMinor, depreciationMethod: b.method, usefulLifeYears: b.usefulLifeYears,
  degressiveCoefficient: coefficientText(b.method, b.usefulLifeYears, coefficients),
  observations: b.observations, transactionId: b.transactionId,
});

export async function createDraft(tx: Tx, actor: Actor, b: AssetDraftInput) {
  await assertReferences(tx, actor.parishId, { locationId: b.locationId, supplierId: b.supplierId, transactionId: b.transactionId, acronym: b.acronym });
  const settings = await getSettings(tx, actor.parishId);
  // The code is allocated by the database, once per asset: no duplicate is possible, even concurrently.
  const code = await repo.nextCode(tx, actor.parishId, b.acronym, codePeriod());
  const a = await repo.insertAsset(tx, {
    parishId: actor.parishId, code, registeredAt: localIsoDate(), createdBy: actor.userId,
    ...toColumns(b, settings.asset_degressive_coefficients),
  });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset.create", entity: "fixed_asset", entityId: a.id, after: a });
  return getAsset(tx, a.id);
}

export async function updateDraft(tx: Tx, actor: Actor, id: string, b: AssetDraftInput) {
  const before = await lockOwn(tx, actor, id);
  assertDraft(before.statut);
  await assertReferences(tx, actor.parishId, { locationId: b.locationId, supplierId: b.supplierId, transactionId: b.transactionId, acronym: b.acronym });
  const settings = await getSettings(tx, actor.parishId);
  // Changing the acronym of a draft issues a new code (in the month the asset was registered); the old number is simply not reused.
  const code = b.acronym === before.acronym ? before.code
    : await repo.nextCode(tx, actor.parishId, b.acronym, before.registeredAt.slice(0, 4) + before.registeredAt.slice(5, 7));
  const after = await repo.updateAsset(tx, id, { code, ...toColumns(b, settings.asset_degressive_coefficients) });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset.update_draft", entity: "fixed_asset", entityId: id, before, after });
  return getAsset(tx, id);
}

/** Only a draft that was never submitted can be deleted: once it has a request it stays (abandon it instead). */
export async function deleteDraft(tx: Tx, actor: Actor, id: string) {
  const before = await lockOwn(tx, actor, id);
  assertDraft(before.statut);
  if ((await repo.countRequests(tx, id)) > 0)
    throw new HTTPException(422, { message: "Cette immobilisation a déjà été soumise: utilisez « Abandonner » pour la conserver dans l'historique" });
  const keys = await files.removeAllFiles(tx, id);
  await repo.deleteAsset(tx, id);
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset.delete_draft", entity: "fixed_asset", entityId: id, before });
  return keys; // stored objects to delete once this transaction has committed
}

/** Abandons a draft. It stays in the register (statut Annulé) with its history; no approval is needed for something never validated. */
export async function discard(tx: Tx, actor: Actor, id: string, reason: string) {
  const before = await lockOwn(tx, actor, id);
  assertDraft(before.statut);
  const after = await repo.updateAsset(tx, id, { statut: "annule" });
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.discard", entity: "fixed_asset", entityId: id,
    before: { statut: before.statut }, after: { statut: after.statut, reason },
  });
  return getAsset(tx, id);
}

/** Brouillon → En attente de validation: opens the creation request (Trésorier then Pasteur). */
export async function submit(tx: Tx, actor: Actor, id: string, comment?: string) {
  const asset = await lockOwn(tx, actor, id);
  assertDraft(asset.statut);
  const check = assetSubmitSchema.safeParse(rowToInput(asset));
  if (!check.success) throw new HTTPException(422, { message: issuesMessage(check.error) });
  await assertReferences(tx, actor.parishId, { locationId: asset.locationId, supplierId: asset.supplierId, acronym: asset.acronym });
  const request = await startRequest(tx, actor, asset, "creation", comment || "Validation de la création de l'immobilisation", null, null);
  await repo.updateAsset(tx, id, { statut: "en_attente_validation" });
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.submit", entity: "fixed_asset", entityId: id,
    before: { statut: "brouillon" }, after: { statut: "en_attente_validation", request: request.reference },
  });
  return { asset: await getAsset(tx, id), request: await requestView(tx, request.id) };
}

// ---- état ---------------------------------------------------------------------------------------------------

/**
 * Changes the physical état. Bon ↔ Mauvais takes effect at once (with its motif); anything that enters or leaves
 * Déclassé / Perdu is a sensitive change and becomes a request that needs the Trésorier and the Pasteur.
 */
export async function changeEtat(tx: Tx, actor: Actor, id: string, b: EtatChangeInput) {
  const asset = await lockOwn(tx, actor, id);
  if (asset.statut !== "actif") throw new HTTPException(422, { message: "L'état d'une immobilisation ne peut changer que si elle est active" });
  if (await requests.findOpenRequest(tx, id)) throw new HTTPException(422, { message: "Une demande est déjà en cours pour cette immobilisation" });
  try {
    validateEtatChange({ oldEtat: asset.etat as AssetEtat, newEtat: b.newEtat, reason: b.reason, observation: b.observation });
  } catch (e) {
    if (e instanceof WorkflowError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
  if (isSensitiveEtatChange(asset.etat as AssetEtat, b.newEtat)) {
    const request = await startRequest(tx, actor, asset, "changement_etat", b.reason,
      { newEtat: b.newEtat, observation: b.observation }, { etat: asset.etat });
    return { pending: true as const, request: await requestView(tx, request.id) };
  }
  const h = await repo.insertHistory(tx, {
    parishId: actor.parishId, assetId: id, oldEtat: asset.etat, newEtat: b.newEtat, reason: b.reason, observation: b.observation,
    locationId: asset.locationId, actorId: actor.userId, validationStatus: "non_requis",
  });
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.etat_change", entity: "fixed_asset", entityId: id,
    before: { etat: asset.etat }, after: { etat: b.newEtat, reason: b.reason, observation: b.observation, historyId: h.id },
  });
  return { pending: false as const, etat: b.newEtat, asset: await getAsset(tx, id) };
}

export type EtatHistoryEntry = {
  id: string; at: Date; oldEtat: string | null; newEtat: string; reason: string; observation: string | null;
  locationName: string; actorName: string; requestReference: string | null;
  /** non_requis | approuve (recorded) · en_attente | refuse (from the request, not yet / never recorded) */
  validation: "non_requis" | "approuve" | "en_attente" | "refuse";
  rejectedReason?: string | null;
};

/** The recorded history, plus the sensitive changes still waiting for approval or refused (they never became history). */
export async function etatHistory(tx: Tx, id: string): Promise<EtatHistoryEntry[]> {
  const asset = await repo.findAssetView(tx, id);
  if (!asset) throw notFound();
  const recorded = await repo.listHistory(tx, id);
  const reqRows = await requests.listRequests(tx, { assetId: id, kind: "changement_etat" });
  const refs = new Map(reqRows.map((x) => [x.r.id, x.r.reference]));
  const entries: EtatHistoryEntry[] = recorded.map(({ h, locationName, actorName }) => ({
    id: h.id, at: h.at, oldEtat: h.oldEtat, newEtat: h.newEtat, reason: h.reason, observation: h.observation, locationName,
    actorName, requestReference: h.requestId ? refs.get(h.requestId) ?? null : null,
    validation: h.validationStatus === "approuve" ? "approuve" : "non_requis",
  }));
  for (const x of reqRows) {
    if (x.r.status === "executee" || x.r.status === "approuvee_n2") continue; // already recorded above
    const p = (x.r.proposedChanges ?? {}) as { newEtat?: string; observation?: string | null };
    entries.push({
      id: x.r.id, at: x.r.createdAt, oldEtat: ((x.r.oldValues ?? {}) as { etat?: string }).etat ?? null, newEtat: p.newEtat ?? "",
      reason: x.r.reason, observation: p.observation ?? null, locationName: asset.locationName, actorName: x.requesterName,
      requestReference: x.r.reference, validation: x.r.status === "rejetee" ? "refuse" : "en_attente", rejectedReason: x.r.rejectedReason,
    });
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Everything done to one asset and its requests, oldest first. */
export async function auditTrail(tx: Tx, id: string) {
  if (!(await repo.findAsset(tx, id))) throw notFound();
  const rows = await repo.auditTrail(tx, id);
  return rows.map(({ e, actorName }) => ({ id: e.id, at: e.at, action: e.action, entity: e.entity, actorName, before: e.before, after: e.after }));
}


// ---- reports -------------------------------------------------------------------------------------------------------------

/** More than this and the report asks for narrower filters: the figures are computed per asset. */
export const REPORT_ROW_LIMIT = 20_000;

/**
 * The validated assets (the patrimoine) with their raw parameters. The reports themselves are grouped and totalled by the shared
 * asset-reports module, which the screen, the PDF and the Excel export all use, so their figures cannot differ.
 */
export async function reportData(tx: Tx, q: ListQuery) {
  const rows = await repo.listAllAssets(tx, { ...q, statut: "actif" }, REPORT_ROW_LIMIT + 1);
  if (rows.length > REPORT_ROW_LIMIT) throw new HTTPException(422, { message: `Plus de ${REPORT_ROW_LIMIT} immobilisations : affinez les filtres` });
  return {
    asOf: fromAsOf(q.asOf),
    rows: rows.map(({ a, locationName, supplierName }) => ({
      id: a.id, code: a.code, description: a.description, accountCode: a.accountCode, subaccountCode: a.subaccountCode,
      locationName, supplierName, currency: a.currency, acquisitionDate: a.acquisitionDate, inServiceDate: a.inServiceDate,
      etat: a.etat, statut: a.statut, method: a.depreciationMethod, years: a.usefulLifeYears, coefficient: a.degressiveCoefficient,
      paMinor: a.paMinor, faaMinor: a.faaMinor, costMinor: costOf(a), fxRatePerUsd: a.fxRatePerUsd,
    })),
  };
}
