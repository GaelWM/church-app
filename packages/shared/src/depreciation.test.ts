import { expect, test } from "bun:test";
import { straightLineSchedule } from "./depreciation";

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
