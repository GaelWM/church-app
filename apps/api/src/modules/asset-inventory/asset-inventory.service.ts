import { HTTPException } from "hono/http-exception";
import type { Tx } from "@church/db";
import { canCloseInventory, localIsoDate, summarizeInventory, type AssetEtat, type InventoryLineData } from "@church/shared";
import { audit } from "../../services/audit";
import { assertReferences } from "../immobilisations/asset-input";
import type { CheckLine, CreateInventory, FoundLine } from "./asset-inventory.dto";
import * as repo from "./asset-inventory.repo";

export type Actor = { userId: string; parishId: string };

const toData = (l: repo.LineRow): InventoryLineData => ({
  assetId: l.assetId, expectedLocationId: l.expectedLocationId, expectedEtat: l.expectedEtat as AssetEtat | null,
  present: l.present, foundLocationId: l.foundLocationId, foundEtat: l.foundEtat as AssetEtat | null,
});

export async function listInventories(tx: Tx) {
  const rows = await repo.listInventories(tx);
  return rows.map(({ i, locationName, total, checked, absents, extras }) => ({ ...i, locationName, total, checked, absents, extras }));
}

export async function getInventory(tx: Tx, id: string) {
  const inv = await repo.findInventory(tx, id);
  if (!inv) throw new HTTPException(404, { message: "Inventaire introuvable" });
  const lines = await repo.listLines(tx, id);
  return {
    ...inv.i, locationName: inv.locationName,
    summary: summarizeInventory(lines.map((x) => toData(x.l))),
    lines: lines.map((x) => ({ ...x.l, expectedLocationName: x.expectedLocationName, foundLocationName: x.foundLocationName, checkedByName: x.checkedByName })),
  };
}

/** Starts an inventory: freezes the validated assets (of one location, or all) as the théorique to compare the physique with. */
export async function createInventory(tx: Tx, actor: Actor, b: CreateInventory) {
  await assertReferences(tx, actor.parishId, { locationId: b.locationId ?? undefined });
  const today = localIsoDate();
  const reference = await repo.nextReference(tx, actor.parishId, Number(today.slice(0, 4)));
  const inv = await repo.insertInventory(tx, {
    parishId: actor.parishId, reference, locationId: b.locationId, startedOn: today, observations: b.observations, createdBy: actor.userId,
  });
  const lines = await repo.snapshotAssets(tx, inv.id, actor.parishId, b.locationId);
  if (lines === 0) throw new HTTPException(422, { message: "Aucune immobilisation validée à inventorier" });
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.inventory.create", entity: "asset_inventory", entityId: inv.id,
    after: { reference, locationId: b.locationId, lines },
  });
  return getInventory(tx, inv.id);
}

async function openInventory(tx: Tx, actor: Actor, id: string) {
  const inv = await repo.lockInventory(tx, id);
  if (!inv || inv.parishId !== actor.parishId) throw new HTTPException(404, { message: "Inventaire introuvable" });
  if (inv.status !== "en_cours") throw new HTTPException(422, { message: "Inventaire clôturé: modification interdite" });
  return inv;
}

/** Records what was found for one registered asset. "Présent" alone means found where and as the register says. */
export async function checkLine(tx: Tx, actor: Actor, inventoryId: string, lineId: string, b: CheckLine) {
  await openInventory(tx, actor, inventoryId);
  const line = await repo.findLine(tx, inventoryId, lineId);
  if (!line) throw new HTTPException(404, { message: "Ligne introuvable" });
  if (line.assetId === null) throw new HTTPException(422, { message: "Cette ligne est un bien non enregistré: modifiez-la en la supprimant puis en la saisissant à nouveau" });
  await assertReferences(tx, actor.parishId, { locationId: b.foundLocationId ?? undefined });
  const present = b.present;
  const updated = await repo.updateLine(tx, lineId, {
    present,
    foundLocationId: present ? b.foundLocationId ?? line.expectedLocationId : null,
    foundEtat: present ? b.foundEtat ?? line.expectedEtat : null,
    responsible: b.responsible, observation: b.observation, checkedAt: new Date(), checkedBy: actor.userId,
  });
  // A line can be re-checked (present → absent…): keep what it said before.
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.inventory.check", entity: "asset_inventory", entityId: inventoryId,
    before: { lineId, code: line.expectedCode, present: line.present, foundLocationId: line.foundLocationId, foundEtat: line.foundEtat },
    after: { lineId, code: line.expectedCode, present: updated.present, foundLocationId: updated.foundLocationId, foundEtat: updated.foundEtat, responsible: updated.responsible, observation: updated.observation },
  });
  return updated;
}

/** A find that is not in the register: kept on the inventory as an écart, never turned into an asset automatically. */
export async function addFound(tx: Tx, actor: Actor, inventoryId: string, b: FoundLine) {
  await openInventory(tx, actor, inventoryId);
  await assertReferences(tx, actor.parishId, { locationId: b.foundLocationId });
  const line = await repo.insertLine(tx, {
    inventoryId, assetId: null, extraDescription: b.description, present: true, foundLocationId: b.foundLocationId, foundEtat: b.foundEtat,
    responsible: b.responsible, observation: b.observation, checkedAt: new Date(), checkedBy: actor.userId,
  });
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.inventory.found", entity: "asset_inventory", entityId: inventoryId,
    after: { lineId: line.id, description: b.description, foundLocationId: b.foundLocationId },
  });
  return line;
}

export async function deleteFound(tx: Tx, actor: Actor, inventoryId: string, lineId: string) {
  await openInventory(tx, actor, inventoryId);
  const line = await repo.findLine(tx, inventoryId, lineId);
  if (!line) throw new HTTPException(404, { message: "Ligne introuvable" });
  if (line.assetId !== null) throw new HTTPException(422, { message: "Une ligne de la situation théorique ne peut pas être supprimée" });
  await repo.deleteLine(tx, lineId);
  await audit(tx, {
    parishId: actor.parishId, actorId: actor.userId, action: "asset.inventory.found_removed", entity: "asset_inventory", entityId: inventoryId,
    before: { lineId, description: line.extraDescription },
  });
}

/** Closes the inventory once every registered asset has been checked; it is then frozen. */
export async function closeInventory(tx: Tx, actor: Actor, id: string) {
  await openInventory(tx, actor, id);
  const lines = (await repo.listLines(tx, id)).map((x) => toData(x.l));
  if (!canCloseInventory(lines)) {
    const left = summarizeInventory(lines).remaining;
    throw new HTTPException(422, { message: `${left} immobilisation(s) non vérifiée(s): vérifiez-les avant de clôturer` });
  }
  await repo.closeInventory(tx, id, actor.userId);
  const summary = summarizeInventory(lines);
  await audit(tx, { parishId: actor.parishId, actorId: actor.userId, action: "asset.inventory.close", entity: "asset_inventory", entityId: id, after: { summary } });
  return getInventory(tx, id);
}
