import { describe, expect, test } from "bun:test";
import {
  ASSET_ACCOUNT_CODES, ASSET_CATEGORIES, ASSET_SUBACCOUNTS, categoryOf, defaultModeOf, matchAccountCodes,
  subaccountBelongsTo, subaccountsOf, accountDisplay, subaccountDisplay,
} from "./asset-accounts";

describe("plan of accounts", () => {
  test("6 principal accounts and 20 sous-comptes, each under its own account", () => {
    expect(ASSET_ACCOUNT_CODES).toEqual(["21", "22", "23", "24", "27", "28"]);
    expect(ASSET_SUBACCOUNTS).toHaveLength(20);
    for (const s of ASSET_SUBACCOUNTS) expect(s.code.startsWith(`${s.account}.`)).toBe(true);
    expect(new Set(ASSET_SUBACCOUNTS.map((s) => s.code)).size).toBe(20);
  });
  test("the dependent dropdown only offers the sous-comptes of the chosen account", () => {
    expect(subaccountsOf("24").map((s) => s.code)).toEqual(["24.1", "24.2", "24.4", "24.5"]);
    expect(subaccountsOf("22").map((s) => s.code)).toEqual(["22.1", "22.2", "22.3", "22.8"]);
    expect(subaccountsOf("27").map((s) => s.code)).toEqual(["27.4", "27.5"]);
    expect(subaccountsOf("28").map((s) => s.code)).toEqual(["28.1", "28.2", "28.4"]);
    expect(subaccountsOf("99")).toEqual([]);
  });
  test("sous-compte/account consistency check", () => {
    expect(subaccountBelongsTo("24", "24.5")).toBe(true);
    expect(subaccountBelongsTo("23", "24.5")).toBe(false);
    expect(subaccountBelongsTo("24", "24.3")).toBe(false);
  });
  test("labels", () => {
    expect(accountDisplay("24")).toBe("24 — Matériel, mobilier et matériel de transport");
    expect(subaccountDisplay("24.5")).toBe("24.5 — Matériel informatique");
  });
});

describe("categories and default modes", () => {
  test("report categories", () => {
    expect(categoryOf("24.5")).toBe("Informatique");
    expect(categoryOf("24.2")).toBe("Transport");
    expect(categoryOf("24.4")).toBe("Mobilier");
    expect(categoryOf("24.1")).toBe("Matériel");
    expect(categoryOf("22.1")).toBe("Terrains");
    expect(categoryOf("23.2")).toBe("Bâtiments");
    expect(categoryOf("21.2")).toBe("Incorporelles");
    expect(categoryOf("27.4")).toBe("Financières");
    expect(categoryOf("00.0")).toBeUndefined();
  });
  test("every report category has at least one sous-compte", () => {
    for (const c of ASSET_CATEGORIES) expect(ASSET_SUBACCOUNTS.some((s) => s.category === c)).toBe(true);
  });
  test("default depreciation mode", () => {
    for (const c of ["22.1", "22.2", "27.4", "27.5", "28.1", "28.2", "28.4"]) expect(defaultModeOf(c)).toBe("non_amortissable");
    for (const c of ["21.2", "22.3", "22.8", "23.2", "24.1", "24.5"]) expect(defaultModeOf(c)).toBe("lineaire");
    expect(defaultModeOf("unknown")).toBe("lineaire");
  });
});

describe("matchAccountCodes (register search)", () => {
  test("matches by code prefix", () => {
    expect(matchAccountCodes("27")).toEqual({ accountCodes: ["27"], subaccountCodes: ["27.4", "27.5"] });
    expect(matchAccountCodes("27.4")).toEqual({ accountCodes: [], subaccountCodes: ["27.4"] });
  });
  test("matches labels ignoring accents and case, from 3 characters", () => {
    const r = matchAccountCodes("INFORMATIQUE");
    expect(r.subaccountCodes).toEqual(["24.5"]);
    expect(matchAccountCodes("materiel").subaccountCodes).toContain("24.5");
    expect(matchAccountCodes("materiel").accountCodes).toContain("24");
    expect(matchAccountCodes("ma")).toEqual({ accountCodes: [], subaccountCodes: [] });
    expect(matchAccountCodes("  ")).toEqual({ accountCodes: [], subaccountCodes: [] });
  });
});

import { DEFAULT_ASSET_LOCATIONS, DEFAULT_ASSET_PREFIXES, assetLabelFormatSchema, DEFAULT_ASSET_LABEL_FORMAT, degressiveCoefficientsSchema, DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS } from "./asset-defaults";
import { findSubaccount } from "./asset-accounts";
import { ASSET_ACRONYM_RE } from "./asset-code";

describe("seeded referentials", () => {
  test("the four acronyms of the spec exist and are not provisional", () => {
    const spec = DEFAULT_ASSET_PREFIXES.filter((p) => !p.provisional).map((p) => p.acronym);
    expect(spec).toEqual(["MB", "MT", "MI", "MO"]);
  });
  test("every acronym is well-formed, unique, and only references real sous-comptes", () => {
    const acronyms = DEFAULT_ASSET_PREFIXES.map((p) => p.acronym);
    expect(new Set(acronyms).size).toBe(acronyms.length);
    for (const p of DEFAULT_ASSET_PREFIXES) {
      expect(ASSET_ACRONYM_RE.test(p.acronym)).toBe(true);
      for (const c of p.subaccountCodes) expect(findSubaccount(c)).toBeDefined();
    }
  });
  test("every sous-compte can be registered: at least one acronym is suggested for it", () => {
    for (const s of ASSET_SUBACCOUNTS) expect(DEFAULT_ASSET_PREFIXES.some((p) => p.subaccountCodes.includes(s.code))).toBe(true);
  });
  test("the nine locations of the spec", () => {
    expect(DEFAULT_ASSET_LOCATIONS).toHaveLength(9);
    expect(DEFAULT_ASSET_LOCATIONS).toContain("Temple principal");
  });
  test("default settings are valid for their own schemas", () => {
    expect(assetLabelFormatSchema.safeParse(DEFAULT_ASSET_LABEL_FORMAT).success).toBe(true);
    expect(degressiveCoefficientsSchema.safeParse(DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS).success).toBe(true);
    expect(degressiveCoefficientsSchema.safeParse([{ min: 5, max: 3, coef: 2 }]).success).toBe(false);
    expect(degressiveCoefficientsSchema.safeParse([{ min: 3, max: null, coef: 1.555 }]).success).toBe(false);
  });
});
