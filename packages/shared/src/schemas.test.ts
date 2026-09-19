import { describe, expect, test } from "bun:test";
import { dueDate, effectiveDate, pastDate } from "./schemas";

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("bounded dates", () => {
  test("pastDate accepts today and recent history, rejects the future and the distant past", () => {
    expect(pastDate.safeParse(iso(0)).success).toBe(true);
    expect(pastDate.safeParse(iso(-365)).success).toBe(true);
    expect(pastDate.safeParse(iso(30)).success).toBe(false);
    expect(pastDate.safeParse("1901-01-01").success).toBe(false);
    expect(pastDate.safeParse("2099-12-31").success).toBe(false);
  });
  test("rejects impossible calendar days and bad formats", () => {
    expect(pastDate.safeParse("2026-02-31").success).toBe(false);
    expect(pastDate.safeParse("26-02-01").success).toBe(false);
  });
  test("dueDate allows overdue and planned dates only within a sane window", () => {
    expect(dueDate.safeParse(iso(-100)).success).toBe(true);
    expect(dueDate.safeParse(iso(365)).success).toBe(true);
    expect(dueDate.safeParse("2099-01-01").success).toBe(false);
  });
  test("effectiveDate can be scheduled about a month ahead but not a year", () => {
    expect(effectiveDate.safeParse(iso(20)).success).toBe(true);
    expect(effectiveDate.safeParse(iso(365)).success).toBe(false);
  });
});
