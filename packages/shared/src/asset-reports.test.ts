import { describe, expect, test } from "bun:test";
import {
  flattenReport, reportAcquisitions, reportAmortissements, reportGeneral, reportParCategorie, reportParEtat,
  reportParLocalisation, reportVnc, toReportRow, type AssetReportRow, type AssetReportSource,
} from "./asset-reports";

let n = 0;
const src = (o: Partial<AssetReportSource> = {}): AssetReportSource => {
  n += 1;
  return {
    id: `a${n}`, code: `MI 202610 ${String(n).padStart(5, "0")}`, description: `Bien ${n}`,
    accountCode: "24", subaccountCode: "24.5", locationName: "Administration", supplierName: null,
    currency: "USD", acquisitionDate: "2026-10-10", inServiceDate: "2026-10-01", etat: "bon", statut: "actif",
    method: "lineaire", years: 5, coefficient: null, paMinor: 100000n, faaMinor: 0n, costMinor: 100000n, fxRatePerUsd: null, ...o,
  };
};
const AS_OF = "2027-12-31";
const row = (o: Partial<AssetReportSource> = {}, asOf = AS_OF): AssetReportRow => toReportRow(src(o), asOf);

describe("toReportRow", () => {
  test("adds the depreciation figures as of the report date", () => {
    // in service Oct 2026, 5 years: 3 months in 2026 + 12 months in 2027 = 15 of 60 months
    const r = row();
    expect([r.accumulatedMinor, r.exerciseMinor, r.vncMinor, r.rate, r.state]).toEqual([25000n, 20000n, 75000n, 20, "en_amortissement"]);
  });
});

describe("totals stay per currency", () => {
  test("USD and CDF are never summed together; a USD equivalent uses each asset's own rate", () => {
    const rows = [
      row({ currency: "USD" }),
      row({ currency: "CDF", costMinor: 2_000_000n, paMinor: 2_000_000n, fxRatePerUsd: "2000" }), // 20 000,00 CDF = 10,00 USD
      row({ currency: "CDF", costMinor: 500_000n, paMinor: 500_000n }), // no rate recorded
    ];
    const r = reportGeneral(rows);
    expect(r.count).toBe(3);
    expect(r.totals.map((t) => [t.currency, t.count, t.costMinor])).toEqual([["CDF", 2, 2_500_000n], ["USD", 1, 100000n]]);
    const cdf = r.totals[0]!;
    expect(cdf.usd).toMatchObject({ costMinor: 1000n, missingRate: 1 });
    expect(r.totals[1]!.usd).toBeNull();
    expect(r.usd).toMatchObject({ costMinor: 101000n, missingRate: 1 });
  });
});

describe("reportGeneral", () => {
  test("one line per asset with coût, amortissement cumulé, VNC and état", () => {
    const r = reportGeneral([row({ etat: "mauvais" }), row()]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]!.rows[0]!.etat).toBe("mauvais");
    expect(r.totals[0]).toMatchObject({ costMinor: 200000n, accumulatedMinor: 50000n, vncMinor: 150000n });
  });
});

describe("reportAcquisitions", () => {
  const rows = [row({ acquisitionDate: "2026-10-10" }), row({ acquisitionDate: "2026-11-05" }), row({ acquisitionDate: "2027-01-20" })];
  test("par mois", () => {
    expect(reportAcquisitions(rows, "mois").lines.map((l) => [l.key, l.label, l.count])).toEqual([
      ["2026-10", "octobre 2026", 1], ["2026-11", "novembre 2026", 1], ["2027-01", "janvier 2027", 1],
    ]);
  });
  test("par trimestre", () => {
    expect(reportAcquisitions(rows, "trimestre").lines.map((l) => [l.label, l.count])).toEqual([["T4 2026", 2], ["T1 2027", 1]]);
  });
  test("par année", () => {
    const r = reportAcquisitions(rows, "annee");
    expect(r.lines.map((l) => [l.key, l.count])).toEqual([["2026", 2], ["2027", 1]]);
    expect(r.lines[0]!.totals[0]!.costMinor).toBe(200000n);
  });
});

describe("reportAmortissements", () => {
  const rows = [
    row({ inServiceDate: "2026-01-10", subaccountCode: "24.5" }),
    row({ inServiceDate: "2026-01-10", subaccountCode: "24.2", costMinor: 50000n, paMinor: 50000n }),
    row({ method: "non_amortissable", years: null, subaccountCode: "22.2", accountCode: "22" }),
  ];
  test("par année: annuity, cumul and VNC at the end of each fiscal year; non amortissables are left out", () => {
    const r = reportAmortissements(rows, "annee");
    expect(r.lines.map((l) => l.key)).toEqual(["2026", "2027", "2028", "2029", "2030"]);
    expect(r.lines[0]!.totals[0]).toMatchObject({ exerciseMinor: 30000n, accumulatedMinor: 30000n, vncMinor: 120000n });
    const last = r.lines[4]!.totals[0]!;
    expect([last.exerciseMinor, last.accumulatedMinor, last.vncMinor]).toEqual([30000n, 150000n, 0n]);
  });
  test("par compte / sous-compte / immobilisation", () => {
    expect(reportAmortissements(rows, "compte").lines.map((l) => l.key)).toEqual(["24"]);
    expect(reportAmortissements(rows, "sous-compte").lines.map((l) => l.key)).toEqual(["24.2", "24.5"]);
    expect(reportAmortissements(rows, "immobilisation").lines).toHaveLength(2);
  });
});

describe("other reports", () => {
  test("reportVnc groups the net book value per sous-compte", () => {
    const r = reportVnc([row(), row({ subaccountCode: "24.2" }), row()]);
    expect(r.lines.map((l) => [l.key, l.count])).toEqual([["24.2", 1], ["24.5", 2]]);
    expect(r.totals[0]!.vncMinor).toBe(225000n);
  });
  test("reportParCategorie lists every category in the spec's order", () => {
    const r = reportParCategorie([row(), row({ subaccountCode: "24.2" })]);
    expect(r.lines.map((l) => l.key)).toEqual(["Terrains", "Bâtiments", "Matériel", "Mobilier", "Informatique", "Transport", "Incorporelles", "Financières"]);
    expect(r.lines.find((l) => l.key === "Informatique")!.count).toBe(1);
    expect(r.lines.find((l) => l.key === "Terrains")!.count).toBe(0);
  });
  test("reportParLocalisation gives the assets present on each site", () => {
    const r = reportParLocalisation([row({ locationName: "Temple principal" }), row({ locationName: "Administration" }), row({ locationName: "Administration" })]);
    expect(r.lines.map((l) => [l.key, l.rows.length])).toEqual([["Administration", 2], ["Temple principal", 1]]);
  });
  test("reportParEtat always shows the four états with count and value", () => {
    const r = reportParEtat([row(), row({ etat: "perdu" }), row({ etat: "perdu" })]);
    expect(r.lines.map((l) => [l.label, l.count])).toEqual([["Bon", 1], ["Mauvais", 0], ["Déclassé", 0], ["Perdu", 2]]);
    expect(r.lines[3]!.totals[0]).toMatchObject({ costMinor: 200000n, vncMinor: 150000n });
  });
});

describe("flattenReport", () => {
  test("a line in two currencies prints two rows, the label only once; totals stay per currency", () => {
    const rows = [
      row({ description: "Bien USD", currency: "USD", locationName: "Administration" }),
      row({ description: "Bien CDF", currency: "CDF", costMinor: 2_000_000n, paMinor: 2_000_000n, fxRatePerUsd: "2000", locationName: "Administration" }),
      row({ description: "Bien Temple", currency: "USD", locationName: "Temple principal" }),
    ];
    const f = flattenReport(reportParLocalisation(rows));
    expect(f.lines.map((l) => [l.label, l.currency, l.count, l.first])).toEqual([
      ["Administration", "CDF", 1, true], ["Administration", "USD", 1, false], ["Temple principal", "USD", 1, true],
    ]);
    expect(f.lines[0]).toMatchObject({ costMinor: 2_000_000n, usdCostMinor: 1000n, missingRate: 0 });
    expect(f.lines[1]!.usdCostMinor).toBeNull(); // USD needs no conversion
    expect(f.totals.map((t) => [t.currency, t.count, t.costMinor])).toEqual([["CDF", 1, 2_000_000n], ["USD", 2, 200000n]]);
  });

  test("a line without assets still prints, with zeros and no currency", () => {
    const f = flattenReport(reportParEtat([row()]));
    const perdu = f.lines.find((l) => l.label === "Perdu")!;
    expect([perdu.currency, perdu.count, perdu.costMinor]).toEqual([null, 0, 0n]);
    expect(f.lines.map((l) => l.label)).toEqual(["Bon", "Mauvais", "Déclassé", "Perdu"]);
  });
});

describe("review regressions", () => {
  test("par année: the grand total counts each asset once and shows its situation, not the sum of the yearly lines", () => {
    const rows = [row({ inServiceDate: "2026-01-10" }), row({ inServiceDate: "2026-01-10" })];
    const r = reportAmortissements(rows, "annee");
    expect(r.lines.map((l) => l.key)).toEqual(["2026", "2027", "2028", "2029", "2030"]);
    expect(r.count).toBe(2);
    // as of 2027-12-31: 2 years of 20 000 each, per asset
    expect(r.totals).toHaveLength(1);
    expect(r.totals[0]).toMatchObject({ count: 2, costMinor: 200000n, accumulatedMinor: 80000n, vncMinor: 120000n, exerciseMinor: 40000n });
    expect(flattenReport(r).totals[0]!.count).toBe(2);
  });

  test("two assets of different parishes can share a code: they stay two lines", () => {
    const a = { ...row({ description: "Parish A" }), id: "id-a", code: "MI 202610 00001" };
    const b = { ...row({ description: "Parish B" }), id: "id-b", code: "MI 202610 00001" };
    for (const r of [reportGeneral([a, b]), reportAmortissements([a, b], "immobilisation")]) {
      expect(r.lines).toHaveLength(2);
      expect(r.lines.map((l) => l.count)).toEqual([1, 1]);
      expect(r.lines.map((l) => l.label)).toEqual(["MI 202610 00001 — Parish A", "MI 202610 00001 — Parish B"]);
    }
  });
});
