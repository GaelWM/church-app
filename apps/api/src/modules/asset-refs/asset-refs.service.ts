import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import {
  DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS, DEFAULT_ASSET_LABEL_FORMAT, localIsoDate,
  type assetLocationSchema, type assetLocationUpdateSchema, type assetSupplierSchema, type assetSupplierUpdateSchema,
  type prefixSchema, type prefixUpdateSchema,
} from "@church/shared";
import type { z } from "zod";
import { audit } from "../../services/audit";
import { rateOn } from "../../services/ledger";
import { getSettings } from "../settings/settings.service";
import * as repo from "./asset-refs.repo";

export type Actor = { userId: string; parishId: string };

/**
 * One call that feeds the asset form, the register filters and the label printer: the referentials, the
 * dégressif coefficients, the label layout and the latest CDF-per-USD rate. Inactive entries (kept because
 * codes and history point to them) are only returned when asked for, by the Configuration screen.
 */
export async function bootstrap(tx: Tx, parishId: string | null, includeInactive: boolean) {
  const keep = <T extends { active: boolean }>(rows: T[]) => (includeInactive ? rows : rows.filter((r) => r.active));
  const [prefixes, locations, suppliers] = [await repo.listPrefixes(tx), await repo.listLocations(tx), await repo.listSuppliers(tx)];
  const settings = parishId ? await getSettings(tx, parishId) : null;
  const cdfPerUsd = await rateOn(tx, localIsoDate()).catch(() => null);
  return {
    prefixes: keep(prefixes), locations: keep(locations), suppliers: keep(suppliers),
    degressiveCoefficients: settings?.asset_degressive_coefficients ?? DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS,
    labelFormat: settings?.asset_label_format ?? DEFAULT_ASSET_LABEL_FORMAT,
    cdfPerUsd,
  };
}

const dup = (what: string) => new HTTPException(422, { message: `${what} existe déjà` });
const notFound = (what: string) => new HTTPException(404, { message: `${what} introuvable` });

export async function createPrefix(tx: Tx, actor: Actor, b: z.infer<typeof prefixSchema>) {
  if (await repo.prefixExists(tx, actor.parishId, b.acronym)) throw dup("Cet acronyme");
  const p = await repo.insertPrefix(tx, { parishId: actor.parishId, ...b });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset_prefix.create", entity: "asset_code_prefix", entityId: p.id, after: p });
  return p;
}

export async function updatePrefix(tx: Tx, actor: Actor, id: string, b: z.infer<typeof prefixUpdateSchema>) {
  const before = await repo.findPrefixById(tx, id);
  if (!before) throw notFound("Acronyme");
  const after = await repo.updatePrefix(tx, id, b);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "asset_prefix.update", entity: "asset_code_prefix", entityId: id, before, after });
  return after;
}

export async function createLocation(tx: Tx, actor: Actor, b: z.infer<typeof assetLocationSchema>) {
  if (await repo.locationNameExists(tx, actor.parishId, b.name)) throw dup("Cette localisation");
  const l = await repo.insertLocation(tx, { parishId: actor.parishId, ...b });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset_location.create", entity: "asset_location", entityId: l.id, after: l });
  return l;
}

export async function updateLocation(tx: Tx, actor: Actor, id: string, b: z.infer<typeof assetLocationUpdateSchema>) {
  const before = await repo.findLocationById(tx, id);
  if (!before) throw notFound("Localisation");
  if (b.name && (await repo.locationNameExists(tx, before.parishId, b.name, id))) throw dup("Cette localisation");
  const after = await repo.updateLocation(tx, id, b);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "asset_location.update", entity: "asset_location", entityId: id, before, after });
  return after;
}

export async function createSupplier(tx: Tx, actor: Actor, b: z.infer<typeof assetSupplierSchema>) {
  if (await repo.supplierNameExists(tx, actor.parishId, b.name)) throw dup("Ce fournisseur");
  const s = await repo.insertSupplier(tx, { parishId: actor.parishId, ...b });
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset_supplier.create", entity: "asset_supplier", entityId: s.id, after: s });
  return s;
}

export async function updateSupplier(tx: Tx, actor: Actor, id: string, b: z.infer<typeof assetSupplierUpdateSchema>) {
  const before = await repo.findSupplierById(tx, id);
  if (!before) throw notFound("Fournisseur");
  if (b.name && (await repo.supplierNameExists(tx, before.parishId, b.name, id))) throw dup("Ce fournisseur");
  const after = await repo.updateSupplier(tx, id, b);
  await audit(tx, { parishId: before.parishId, actorId: actor.userId, action: "asset_supplier.update", entity: "asset_supplier", entityId: id, before, after });
  return after;
}
