import { describe, expect, test } from "bun:test";
import {
  assetDraftSchema, assetModificationSchema, assetRequestSchema, assetSubmitSchema, etatChangeSchema,
  prefixSchema, prefixUpdateSchema, assetLocationUpdateSchema, assetSupplierUpdateSchema,
} from "./asset-schemas";

const uuid = "123e4567-e89b-12d3-a456-426614174000";
const base = {
  acronym: "MI", accountCode: "24", subaccountCode: "24.5", description: "Ordinateur portable",
  acquisitionDate: "2026-10-10", inServiceDate: "2026-10-10", locationId: uuid, currency: "USD",
  paMinor: "100000", faaMinor: "5000", method: "lineaire", usefulLifeYears: 5,
};
const issuePaths = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("assetDraftSchema", () => {
  test("accepts a complete draft and normalises optional fields", () => {
    const r = assetDraftSchema.parse(base);
    expect(r.paMinor).toBe(100000n);
    expect(r.faaMinor).toBe(5000n);
    expect([r.invoiceNumber, r.supplierId, r.fxRatePerUsd, r.observations, r.transactionId]).toEqual([null, null, null, null, null]);
  });
  test("the coût d'acquisition can never be typed", () => {
    expect(assetDraftSchema.safeParse({ ...base, costMinor: "105000" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, acquisitionCost: "105000" }).success).toBe(false);
  });
  test("localisation is mandatory", () => {
    const { locationId: _l, ...rest } = base;
    expect(assetDraftSchema.safeParse(rest).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, locationId: "Administration" }).success).toBe(false);
  });
  test("devise: USD, CDF and EUR only", () => {
    for (const currency of ["USD", "CDF", "EUR"]) expect(assetDraftSchema.safeParse({ ...base, currency }).success).toBe(true);
    expect(assetDraftSchema.safeParse({ ...base, currency: "GBP" }).success).toBe(false);
  });
  test("exchange rate: allowed for EUR/CDF, refused for USD, must be positive with ≤ 4 decimals", () => {
    expect(assetDraftSchema.safeParse({ ...base, currency: "EUR", fxRatePerUsd: "0.9234" }).success).toBe(true);
    expect(assetDraftSchema.safeParse({ ...base, currency: "USD", fxRatePerUsd: "1" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, currency: "EUR", fxRatePerUsd: "0" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, currency: "EUR", fxRatePerUsd: "0.12345" }).success).toBe(false);
  });
  test("sous-compte must belong to the account", () => {
    const r = assetDraftSchema.safeParse({ ...base, accountCode: "23" });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("subaccountCode");
    expect(assetDraftSchema.safeParse({ ...base, subaccountCode: "24.9" }).success).toBe(false);
  });
  test("amounts: PA positive, FAA optional (0) and never negative", () => {
    expect(assetDraftSchema.parse({ ...base, faaMinor: undefined }).faaMinor).toBe(0n);
    expect(assetDraftSchema.safeParse({ ...base, paMinor: "0" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, faaMinor: "-1" }).success).toBe(false);
  });
  test("depreciation parameters follow the mode", () => {
    expect(assetDraftSchema.safeParse({ ...base, usefulLifeYears: null }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, method: "non_amortissable", usefulLifeYears: 5 }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, method: "non_amortissable", usefulLifeYears: null, inServiceDate: null }).success).toBe(true);
    expect(assetDraftSchema.safeParse({ ...base, method: "degressif" }).success).toBe(true);
  });
  test("old assets can be entered", () => {
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: "1995-06-01", inServiceDate: "1995-06-01" }).success).toBe(true);
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: "2099-01-01" }).success).toBe(false);
  });
});

describe("assetSubmitSchema", () => {
  test("a depreciable asset needs its date de mise en service, a non-amortissable one does not", () => {
    expect(assetSubmitSchema.safeParse({ ...base, inServiceDate: null }).success).toBe(false);
    expect(assetSubmitSchema.safeParse({ ...base, method: "non_amortissable", usefulLifeYears: null, inServiceDate: null }).success).toBe(true);
    expect(assetSubmitSchema.safeParse(base).success).toBe(true);
  });
});

describe("assetModificationSchema", () => {
  test("whitelist of fields, at least one change", () => {
    expect(assetModificationSchema.safeParse({}).success).toBe(false);
    expect(assetModificationSchema.safeParse({ locationId: uuid }).success).toBe(true);
    expect(assetModificationSchema.safeParse({ etat: "bon" }).success).toBe(false);
    expect(assetModificationSchema.safeParse({ statut: "annule" }).success).toBe(false);
    expect(assetModificationSchema.safeParse({ acronym: "XX" }).success).toBe(false);
  });
  test("code changes are possible but must keep the format", () => {
    expect(assetModificationSchema.safeParse({ code: "MI 202610 00001" }).success).toBe(true);
    expect(assetModificationSchema.safeParse({ code: "IMMO-001" }).success).toBe(false);
  });
});

describe("etatChangeSchema", () => {
  test("motif always; justification for Mauvais, Déclassé and Perdu", () => {
    expect(etatChangeSchema.safeParse({ newEtat: "bon", reason: "Réparation" }).success).toBe(true);
    expect(etatChangeSchema.safeParse({ newEtat: "bon", reason: "" }).success).toBe(false);
    for (const newEtat of ["mauvais", "declasse", "perdu"]) {
      expect(etatChangeSchema.safeParse({ newEtat, reason: "Panne" }).success).toBe(false);
      expect(etatChangeSchema.safeParse({ newEtat, reason: "Panne", observation: "  " }).success).toBe(false);
      expect(etatChangeSchema.safeParse({ newEtat, reason: "Panne", observation: "Écran cassé" }).success).toBe(true);
    }
    expect(etatChangeSchema.safeParse({ newEtat: "inconnu", reason: "Panne" }).success).toBe(false);
  });
});

describe("assetRequestSchema", () => {
  test("modification needs changes, annulation must not carry any, both need a motif", () => {
    expect(assetRequestSchema.safeParse({ kind: "modification", reason: "Changement de site", changes: { locationId: uuid } }).success).toBe(true);
    expect(assetRequestSchema.safeParse({ kind: "modification", reason: "Changement de site" }).success).toBe(false);
    expect(assetRequestSchema.safeParse({ kind: "annulation", reason: "Saisie en double" }).success).toBe(true);
    expect(assetRequestSchema.safeParse({ kind: "annulation", reason: "Saisie en double", changes: { locationId: uuid } }).success).toBe(false);
    expect(assetRequestSchema.safeParse({ kind: "annulation", reason: "abc" }).success).toBe(false);
    expect(assetRequestSchema.safeParse({ kind: "creation", reason: "Saisie en double" }).success).toBe(false);
  });
});

describe("referential schemas", () => {
  test("acronyms are 2-4 uppercase letters and immutable once created", () => {
    expect(prefixSchema.safeParse({ acronym: "TE", label: "Terrains" }).success).toBe(true);
    for (const acronym of ["T", "te", "TOOLONG", "T1"]) expect(prefixSchema.safeParse({ acronym, label: "x" }).success).toBe(false);
    expect(prefixSchema.safeParse({ acronym: "TE", label: "Terrains", subaccountCodes: ["22.1", "99.9"] }).success).toBe(false);
    expect(prefixUpdateSchema.safeParse({ label: "Nouveau libellé" }).success).toBe(true);
    expect(prefixUpdateSchema.safeParse({ acronym: "ZZ" }).success).toBe(false);
  });
});

describe("review regressions: limits, dates, empty updates", () => {
  test("amounts beyond what the database and the display can carry are refused, alone or added up", () => {
    expect(assetDraftSchema.safeParse({ ...base, paMinor: "99999999999999999999" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, paMinor: 1e21 }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, paMinor: "1000000000000000", faaMinor: "0" }).success).toBe(true); // the limit itself
    expect(assetDraftSchema.safeParse({ ...base, paMinor: "1000000000000001", faaMinor: "0" }).success).toBe(false);
    const sum = assetDraftSchema.safeParse({ ...base, paMinor: "1000000000000000", faaMinor: "1" });
    expect(sum.success).toBe(false); // PA + FAA is stored in one column
    expect(assetModificationSchema.safeParse({ paMinor: "1000000000000001" }).success).toBe(false);
    expect(assetModificationSchema.safeParse({ faaMinor: "99999999999999999999" }).success).toBe(false);
  });

  test("the mise en service cannot precede the acquisition, and an acquisition cannot be in the future", () => {
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: "2026-10-10", inServiceDate: "2010-01-01" }).success).toBe(false);
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: "2026-10-10", inServiceDate: "2026-10-10" }).success).toBe(true);
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: future, inServiceDate: future }).success).toBe(false);
    // planning a mise en service a little ahead of a past acquisition stays possible
    expect(assetDraftSchema.safeParse({ ...base, acquisitionDate: "2026-10-10", inServiceDate: future }).success).toBe(true);
  });

  test("an empty update of a referential is refused rather than reaching the database", () => {
    expect(prefixUpdateSchema.safeParse({}).success).toBe(false);
    expect(assetLocationUpdateSchema.safeParse({}).success).toBe(false);
    expect(assetSupplierUpdateSchema.safeParse({}).success).toBe(false);
    expect(assetLocationUpdateSchema.safeParse({ active: false }).success).toBe(true);
  });
});
