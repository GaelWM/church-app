import { describe, expect, test } from "bun:test";
import { canCloseInventory, lineGaps, summarizeInventory, type InventoryLineData } from "./asset-inventory";

const line = (o: Partial<InventoryLineData> = {}): InventoryLineData => ({
  assetId: "a", expectedLocationId: "loc-admin", expectedEtat: "bon", present: null, foundLocationId: null, foundEtat: null, ...o,
});

describe("lineGaps: théorique vs physique", () => {
  test("not checked yet", () => expect(lineGaps(line())).toEqual(["a_verifier"]));
  test("present where and as expected = conforme", () => {
    expect(lineGaps(line({ present: true, foundLocationId: "loc-admin", foundEtat: "bon" }))).toEqual([]);
    expect(lineGaps(line({ present: true }))).toEqual([]); // nothing contradicts the register
  });
  test("absent", () => expect(lineGaps(line({ present: false }))).toEqual(["absent"]));
  test("found elsewhere, in another état, or both", () => {
    expect(lineGaps(line({ present: true, foundLocationId: "loc-temple" }))).toEqual(["autre_localisation"]);
    expect(lineGaps(line({ present: true, foundEtat: "mauvais" }))).toEqual(["etat_different"]);
    expect(lineGaps(line({ present: true, foundLocationId: "loc-temple", foundEtat: "mauvais" }))).toEqual(["autre_localisation", "etat_different"]);
  });
  test("a find that is not in the register", () => {
    expect(lineGaps(line({ assetId: null, expectedLocationId: null, expectedEtat: null, present: true, foundLocationId: "loc-temple" }))).toEqual(["non_enregistre"]);
  });
});

describe("summarizeInventory", () => {
  const lines = [
    line({ present: true, foundLocationId: "loc-admin", foundEtat: "bon" }),
    line({ present: true, foundLocationId: "loc-temple", foundEtat: "mauvais" }),
    line({ present: false }),
    line(),
    line({ assetId: null, expectedLocationId: null, expectedEtat: null, present: true, foundLocationId: "loc-temple" }),
  ];
  test("counts each kind of écart", () => {
    expect(summarizeInventory(lines)).toEqual({
      total: 5, checked: 4, remaining: 1, present: 3, conformes: 1, absents: 1, autreLocalisation: 1, etatDifferent: 1, nonEnregistres: 1,
    });
  });
  test("an inventory closes only once every registered asset has been checked", () => {
    expect(canCloseInventory(lines)).toBe(false);
    expect(canCloseInventory(lines.filter((l) => l.present !== null || l.assetId === null))).toBe(true);
    expect(canCloseInventory([])).toBe(true);
  });
});
