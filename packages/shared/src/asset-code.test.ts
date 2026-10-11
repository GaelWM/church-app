import { describe, expect, test } from "bun:test";
import { ASSET_CODE_RE, codePeriod, formatAssetCode, parseAssetCode } from "./asset-code";

describe("formatAssetCode", () => {
  test("follows [ACRONYME] [AAAAMM] [NNNNN] and restarts per month", () => {
    expect(formatAssetCode("MI", "202610", 1)).toBe("MI 202610 00001");
    expect(formatAssetCode("MI", "202610", 2)).toBe("MI 202610 00002");
    expect(formatAssetCode("MI", "202611", 1)).toBe("MI 202611 00001");
    expect(formatAssetCode("MI", "202701", 1)).toBe("MI 202701 00001");
  });
  test("grows past 5 digits instead of wrapping", () => {
    expect(formatAssetCode("MB", "202610", 100000)).toBe("MB 202610 100000");
  });
  test("rejects bad acronym, period or sequence", () => {
    expect(() => formatAssetCode("m1", "202610", 1)).toThrow();
    expect(() => formatAssetCode("MI", "202613", 1)).toThrow();
    expect(() => formatAssetCode("MI", "2026-10", 1)).toThrow();
    expect(() => formatAssetCode("MI", "202610", 0)).toThrow();
  });
});

describe("parseAssetCode", () => {
  test("round-trips a code", () => {
    expect(parseAssetCode("MB 202610 00012")).toEqual({ acronym: "MB", period: "202610", year: 2026, month: 10, sequence: 12 });
    expect(ASSET_CODE_RE.test("MI 202610 00001")).toBe(true);
  });
  test("rejects malformed codes", () => {
    for (const bad of ["MI 202613 00001", "mi 202610 00001", "MI202610 00001", "MI 202610 0001", "IMMO-001"]) {
      expect(parseAssetCode(bad)).toBeNull();
    }
  });
});

describe("codePeriod (Africa/Kinshasa, UTC+1)", () => {
  test("uses the local month, not the UTC month", () => {
    expect(codePeriod(new Date("2026-10-10T10:00:00Z"))).toBe("202610");
    expect(codePeriod(new Date("2026-09-30T23:30:00Z"))).toBe("202610"); // already October 1st, 00:30 locally
    expect(codePeriod(new Date("2026-10-31T23:30:00Z"))).toBe("202611");
    expect(codePeriod(new Date("2026-12-31T23:59:00Z"))).toBe("202701");
  });
  test("accepts another time zone", () => {
    expect(codePeriod(new Date("2026-09-30T23:30:00Z"), "UTC")).toBe("202609");
  });
});
