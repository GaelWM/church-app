import { expect, test } from "bun:test";
import { DEFAULT_DEPARTMENTS, normalizeDepartmentName } from "./departments";

test("default départements include Affermissement and are distinct without case or accents", () => {
  expect(DEFAULT_DEPARTMENTS).toHaveLength(14);
  expect(DEFAULT_DEPARTMENTS).toContain("Affermissement");
  expect(new Set(DEFAULT_DEPARTMENTS.map(normalizeDepartmentName)).size).toBe(DEFAULT_DEPARTMENTS.length);
});

test("normalizeDepartmentName ignores case, accents and extra spaces", () => {
  expect(normalizeDepartmentName("  Écodim ")).toBe(normalizeDepartmentName("ecodim"));
  expect(normalizeDepartmentName("Nettoyage  et   décoration")).toBe("nettoyage et decoration");
  expect(normalizeDepartmentName("Chorale")).not.toBe(normalizeDepartmentName("Chorales"));
});
