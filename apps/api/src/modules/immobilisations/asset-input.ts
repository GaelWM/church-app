import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { Tx } from "@church/db";
import { coefficientFor, type CoefficientBand } from "@church/shared";
import * as repo from "./immobilisations.repo";

export const issuesMessage = (e: z.ZodError) => [...new Set(e.issues.map((i) => i.message))].join(" ; ");

/** bigint → string, so values survive JSON (jsonb request payloads, audit rows). */
export const serialize = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** The stored row in the shape of assetDraftSchema / assetSubmitSchema, to validate "row + proposed changes". */
export function rowToInput(a: repo.AssetRow) {
  return {
    acronym: a.acronym, accountCode: a.accountCode, subaccountCode: a.subaccountCode, description: a.description,
    invoiceNumber: a.invoiceNumber, supplierId: a.supplierId, acquisitionDate: a.acquisitionDate, inServiceDate: a.inServiceDate,
    locationId: a.locationId, currency: a.currency, fxRatePerUsd: a.fxRatePerUsd, fxRateDate: a.fxRateDate,
    paMinor: a.paMinor.toString(), faaMinor: a.faaMinor.toString(), method: a.depreciationMethod,
    usefulLifeYears: a.usefulLifeYears, observations: a.observations, transactionId: a.transactionId,
  };
}

/** Everything an asset points to must exist in the parish (and, for the lists managed in Configuration, be active). */
export async function assertReferences(
  tx: Tx, parishId: string,
  r: { locationId?: string; supplierId?: string | null; transactionId?: string | null; acronym?: string },
) {
  if (r.locationId) {
    const l = await repo.findLocation(tx, r.locationId, parishId);
    if (!l || !l.active) throw new HTTPException(422, { message: "Localisation invalide" });
  }
  if (r.supplierId) {
    const s = await repo.findSupplier(tx, r.supplierId, parishId);
    if (!s || !s.active) throw new HTTPException(422, { message: "Fournisseur invalide" });
  }
  if (r.transactionId) {
    const t = await repo.findDepenseTransactionInParish(tx, r.transactionId, parishId);
    if (!t) throw new HTTPException(422, { message: "L'écriture liée doit être une dépense de cette paroisse" });
  }
  if (r.acronym) {
    const p = await repo.findPrefix(tx, parishId, r.acronym);
    if (!p || !p.active) throw new HTTPException(422, { message: "Acronyme de code inconnu ou désactivé" });
  }
}

/** Dégressif coefficient frozen on the asset when it is created or its depreciation parameters change. */
export function coefficientText(method: string, years: number | null, table: readonly CoefficientBand[]): string | null {
  return method === "degressif" && years ? String(coefficientFor(years, table)) : null;
}
