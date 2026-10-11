import { expect, test } from "bun:test";
import {
  amountsAt, buildSchedule, coefficientFor, depreciableValue, rateFor, straightLineSchedule, type DepreciationInput,
} from "./depreciation";

test("straightLineSchedule: 500 over 5 years = 100/year, VNC reaches 0", () => {
  const rows = straightLineSchedule(50000n, 5, 2026); // 500.00 in minor units
  expect(rows).toHaveLength(5);
  expect(rows.map((r) => r.annuityMinor)).toEqual([10000n, 10000n, 10000n, 10000n, 10000n]);
  expect(rows.map((r) => r.fiscalYear)).toEqual([2026, 2027, 2028, 2029, 2030]);
  expect(rows[4]!.accumulatedMinor).toBe(50000n);
  expect(rows[4]!.netBookValueMinor).toBe(0n);
});

test("straightLineSchedule: last year absorbs the integer-division remainder", () => {
  const rows = straightLineSchedule(10000n, 3, 2026); // 100.00 / 3 = 33.33...
  expect(rows.map((r) => r.annuityMinor)).toEqual([3333n, 3333n, 3334n]);
  expect(rows[2]!.accumulatedMinor).toBe(10000n);
  expect(rows[2]!.netBookValueMinor).toBe(0n);
});

test("straightLineSchedule: no duration (e.g. terrain) returns an empty schedule", () => {
  expect(straightLineSchedule(10000n, null, 2026)).toEqual([]);
  expect(straightLineSchedule(10000n, 0, 2026)).toEqual([]);
});

// ---- Immobilisations engine: monthly prorata, linéaire / dégressif / non amortissable ----------------

const lin = (o: Partial<DepreciationInput> = {}): DepreciationInput => ({
  method: "lineaire", costMinor: 100000n, years: 5, inServiceDate: "2026-01-15", coefficient: null, ...o,
});
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

test("linéaire from January: 5 equal yearly rows, VNC reaches 0, rate 100/durée", () => {
  const rows = buildSchedule(lin());
  expect(rows.map((r) => r.annuityMinor)).toEqual([20000n, 20000n, 20000n, 20000n, 20000n]);
  expect(rows.map((r) => r.fiscalYear)).toEqual([2026, 2027, 2028, 2029, 2030]);
  expect(rows.map((r) => r.months)).toEqual([12, 12, 12, 12, 12]);
  expect(rows[4]!.vncMinor).toBe(0n);
  expect(rateFor("lineaire", 5)).toBe(20);
  expect(rateFor("lineaire", 3)).toBe(33.33);
});

test("linéaire mid-year start: prorata in the first and last fiscal years", () => {
  const rows = buildSchedule(lin({ costMinor: 60000n, inServiceDate: "2026-07-01" }));
  expect(rows.map((r) => r.months)).toEqual([6, 12, 12, 12, 12, 6]);
  expect(rows.map((r) => r.annuityMinor)).toEqual([6000n, 12000n, 12000n, 12000n, 12000n, 6000n]);
  expect(rows.map((r) => r.fiscalYear)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
});

test("linéaire: awkward costs still sum exactly to the cost (remainder in the last period)", () => {
  const rows = buildSchedule(lin({ costMinor: 100001n, years: 3 }));
  expect(rows.map((r) => r.annuityMinor)).toEqual([33333n, 33334n, 33334n]);
  expect(sum(rows.map((r) => r.annuityMinor))).toBe(100001n);
  expect(rows[2]!.vncMinor).toBe(0n);
});

test("amountsAt: figures as of a month, current month counts as full", () => {
  const input = lin({ costMinor: 60000n, inServiceDate: "2026-07-01" }); // 1000 / month
  const sep26 = amountsAt(input, "2026-09-30");
  expect([sep26.accumulatedMinor, sep26.exerciseMinor, sep26.vncMinor, sep26.state]).toEqual([3000n, 3000n, 57000n, "en_amortissement"]);
  const mar27 = amountsAt(input, "2027-03-15");
  expect([mar27.accumulatedMinor, mar27.exerciseMinor, mar27.vncMinor]).toEqual([9000n, 3000n, 51000n]);
  expect(mar27.depreciableMinor).toBe(60000n);
  expect(mar27.rate).toBe(20);
});

test("amountsAt: before the mise en service nothing is depreciated; after the end the asset is entièrement amorti", () => {
  const input = lin({ costMinor: 60000n, inServiceDate: "2026-07-01" });
  const before = amountsAt(input, "2026-06-30");
  expect([before.accumulatedMinor, before.exerciseMinor, before.vncMinor, before.state]).toEqual([0n, 0n, 60000n, "non_demarre"]);
  const end = amountsAt(input, "2031-06-30"); // last month of the 60
  expect([end.accumulatedMinor, end.vncMinor, end.state]).toEqual([60000n, 0n, "entierement_amorti"]);
  const after = amountsAt(input, "2031-12-31");
  expect([after.accumulatedMinor, after.exerciseMinor, after.vncMinor]).toEqual([60000n, 6000n, 0n]);
});

test("amountsAt: missing parameters mean not started, VNC = coût", () => {
  for (const input of [lin({ years: null }), lin({ inServiceDate: null })]) {
    const a = amountsAt(input, "2027-01-31");
    expect([a.accumulatedMinor, a.exerciseMinor, a.vncMinor, a.state]).toEqual([0n, 0n, 100000n, "non_demarre"]);
    expect(buildSchedule(input)).toEqual([]);
  }
});

test("dégressif 5 years, coefficient 2 (rate 40%): switches to linear in year 4, VNC ends at 0", () => {
  const input = lin({ method: "degressif", coefficient: 2 });
  const rows = buildSchedule(input);
  expect(rows.map((r) => r.annuityMinor)).toEqual([40000n, 24000n, 14400n, 10800n, 10800n]);
  expect(rows[4]!.vncMinor).toBe(0n);
  expect(rateFor("degressif", 5, 2)).toBe(40);
  expect(rateFor("degressif", 3, 1.5)).toBe(50);
});

test("dégressif defaults its coefficient from the duration", () => {
  expect(rateFor("degressif", 5)).toBe(40); // 5 years => 2
  expect(rateFor("degressif", 3)).toBe(50); // 3 years => 1.5
  expect(rateFor("degressif", 10)).toBe(25); // 7+ years => 2.5
  expect(buildSchedule(lin({ method: "degressif" })).map((r) => r.annuityMinor)).toEqual([40000n, 24000n, 14400n, 10800n, 10800n]);
});

test("dégressif with a mid-year start prorates the first year and still sums to the cost", () => {
  const rows = buildSchedule(lin({ method: "degressif", coefficient: 2, costMinor: 120000n, inServiceDate: "2026-07-10" }));
  expect(rows[0]!.months).toBe(6);
  expect(rows[0]!.annuityMinor).toBe(24000n);
  expect(sum(rows.map((r) => r.annuityMinor))).toBe(120000n);
  expect(rows.at(-1)!.vncMinor).toBe(0n);
  expect(rows.every((r) => r.annuityMinor > 0n)).toBe(true);
});

test("dégressif: amountsAt spreads the yearly annuity over the active months", () => {
  const input = lin({ method: "degressif", coefficient: 2 });
  expect(amountsAt(input, "2026-06-30").accumulatedMinor).toBe(20000n); // 40000 * 6/12
  expect(amountsAt(input, "2026-12-31").accumulatedMinor).toBe(40000n);
  expect(amountsAt(input, "2027-12-31")).toMatchObject({ exerciseMinor: 24000n, accumulatedMinor: 64000n, vncMinor: 36000n });
});

test("coefficientFor: band boundaries, no acceleration under 3 years, custom tables", () => {
  expect([2, 3, 4, 5, 6, 7, 20].map((y) => coefficientFor(y))).toEqual([1, 1.5, 1.5, 2, 2, 2.5, 2.5]);
  expect(coefficientFor(5, [{ min: 1, max: null, coef: 3 }])).toBe(3);
});

test("non amortissable: no depreciation, VNC = coût, no rate, valeur amortissable 0", () => {
  const input = lin({ method: "non_amortissable", years: null });
  expect(buildSchedule(input)).toEqual([]);
  expect(amountsAt(input, "2030-01-31")).toEqual({
    rate: null, depreciableMinor: 0n, exerciseMinor: 0n, accumulatedMinor: 0n, vncMinor: 100000n, state: "non_amortissable",
  });
  expect(depreciableValue(input)).toBe(0n);
  expect(rateFor("non_amortissable", 5)).toBeNull();
});

test("one-year duration depreciates the whole cost in a single row", () => {
  const rows = buildSchedule(lin({ years: 1 }));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.annuityMinor).toBe(100000n);
});

test("very large amounts stay exact (bigint, no float drift)", () => {
  const cost = 999_999_999_999_999n;
  for (const method of ["lineaire", "degressif"] as const) {
    const rows = buildSchedule(lin({ method, costMinor: cost, years: 7, inServiceDate: "2026-03-01" }));
    expect(sum(rows.map((r) => r.annuityMinor))).toBe(cost);
    expect(rows.at(-1)!.accumulatedMinor).toBe(cost);
    expect(rows.every((r) => r.annuityMinor >= 0n)).toBe(true);
  }
});

test("a duration that is not a whole number of years is simply not set: no exception, VNC = coût", () => {
  for (const method of ["lineaire", "degressif"] as const) {
    const input = lin({ method, years: 5.5 });
    expect(buildSchedule(input)).toEqual([]);
    const a = amountsAt(input, "2027-01-31");
    expect([a.accumulatedMinor, a.vncMinor, a.state, a.rate]).toEqual([0n, 100000n, "non_demarre", null]);
  }
});
