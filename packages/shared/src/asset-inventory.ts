import type { AssetEtat } from "./enums";

/**
 * Inventaire: comparison of the théorique (what the register says, frozen when the inventory starts) with the physique
 * (what was found). Pure, so the screen, the export and the tests share one definition of an "écart".
 */

export interface InventoryLineData {
  /** null = a find that is not in the register. */
  assetId: string | null;
  expectedLocationId: string | null;
  expectedEtat: AssetEtat | null;
  /** null = not checked yet. */
  present: boolean | null;
  foundLocationId: string | null;
  foundEtat: AssetEtat | null;
}

export type InventoryGap = "a_verifier" | "absent" | "autre_localisation" | "etat_different" | "non_enregistre";

export const INVENTORY_GAP_LABELS: Record<InventoryGap, string> = {
  a_verifier: "À vérifier", absent: "Absent", autre_localisation: "Autre localisation", etat_different: "État différent", non_enregistre: "Non enregistré",
};

/** The écarts of one line (empty = conforme). A line can have several: found elsewhere AND in another état. */
export function lineGaps(l: InventoryLineData): InventoryGap[] {
  if (l.assetId === null) return ["non_enregistre"];
  if (l.present === null) return ["a_verifier"];
  if (!l.present) return ["absent"];
  const gaps: InventoryGap[] = [];
  if (l.foundLocationId && l.expectedLocationId && l.foundLocationId !== l.expectedLocationId) gaps.push("autre_localisation");
  if (l.foundEtat && l.expectedEtat && l.foundEtat !== l.expectedEtat) gaps.push("etat_different");
  return gaps;
}

export interface InventorySummary {
  total: number; checked: number; remaining: number; present: number; conformes: number;
  absents: number; autreLocalisation: number; etatDifferent: number; nonEnregistres: number;
}

export function summarizeInventory(lines: InventoryLineData[]): InventorySummary {
  const s: InventorySummary = { total: lines.length, checked: 0, remaining: 0, present: 0, conformes: 0, absents: 0, autreLocalisation: 0, etatDifferent: 0, nonEnregistres: 0 };
  for (const l of lines) {
    const gaps = lineGaps(l);
    if (l.assetId !== null && l.present === null) { s.remaining += 1; continue; }
    s.checked += 1;
    if (l.present) s.present += 1;
    if (gaps.length === 0) s.conformes += 1;
    if (gaps.includes("absent")) s.absents += 1;
    if (gaps.includes("autre_localisation")) s.autreLocalisation += 1;
    if (gaps.includes("etat_different")) s.etatDifferent += 1;
    if (gaps.includes("non_enregistre")) s.nonEnregistres += 1;
  }
  return s;
}

/** A line the user may leave unchecked until the end is not allowed: an inventory closes only when every registered asset was checked. */
export const canCloseInventory = (lines: InventoryLineData[]) => lines.every((l) => l.assetId === null || l.present !== null);
