import { expect, test } from "bun:test";
import { parseAmount, toUsdMinor } from "./money";

test("parseAmount handles French formatting", () => {
  expect(parseAmount("1 250,50")).toBe(125050n);
  expect(parseAmount("10")).toBe(1000n);
  expect(() => parseAmount("1.234")).toThrow();
});

test("toUsdMinor converts CDF at rate exactly", () => {
  // 28 000,00 CDF at 2800 CDF/USD = 10,00 USD
  expect(toUsdMinor(2_800_000n, "CDF", "2800")).toBe(1000n);
  expect(toUsdMinor(500n, "USD", "2800")).toBe(500n);
  // rounding: 1,00 CDF at 2800 => 0.000357 USD -> 0 cents
  expect(toUsdMinor(100n, "CDF", "2800")).toBe(0n);
});
