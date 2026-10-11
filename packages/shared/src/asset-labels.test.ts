import { describe, expect, test } from "bun:test";
import { DEFAULT_ASSET_LABEL_FORMAT } from "./asset-defaults";
import { A4, labelLayout, labelUrl } from "./asset-labels";

describe("labelUrl (what the QR code opens)", () => {
  test("uses the configured base URL, else the page's origin, without doubling slashes", () => {
    expect(labelUrl("abc", null, "https://compta.exemple.org")).toBe("https://compta.exemple.org/immobilisations/abc");
    expect(labelUrl("abc", "https://app.cepd.org/", "https://other")).toBe("https://app.cepd.org/immobilisations/abc");
    expect(labelUrl("abc", "  ", "https://compta.exemple.org/")).toBe("https://compta.exemple.org/immobilisations/abc");
  });
});

describe("labelLayout", () => {
  test("roll: the page is the label, one label per page", () => {
    const l = labelLayout(3, DEFAULT_ASSET_LABEL_FORMAT);
    expect([l.pageW, l.pageH, l.pages, l.perPage]).toEqual([70, 35, 3, 1]);
    expect(l.cells).toEqual([0, 1, 2].map((page) => ({ page, x: 0, y: 0, w: 70, h: 35 })));
  });

  test("sheet: fills the A4 grid row by row, then starts a new page", () => {
    const f = { mode: "sheet" as const, widthMm: 60, heightMm: 30, cols: 3, rows: 8, marginMm: 10 };
    const l = labelLayout(25, f);
    expect([l.pageW, l.pageH, l.perPage, l.pages]).toEqual([A4.w, A4.h, 24, 2]);
    expect(l.cells[0]).toEqual({ page: 0, x: 10, y: 10, w: 60, h: 30 });
    expect(l.cells[1]).toMatchObject({ page: 0, x: 70, y: 10 });
    expect(l.cells[3]).toMatchObject({ page: 0, x: 10, y: 40 }); // second row
    expect(l.cells[23]).toMatchObject({ page: 0, x: 130, y: 220 });
    expect(l.cells[24]).toMatchObject({ page: 1, x: 10, y: 10 }); // 25th label opens page 2
  });

  test("sheet: a grid that does not fit is shrunk, never cut off", () => {
    const l = labelLayout(1, { mode: "sheet", widthMm: 100, heightMm: 100, cols: 3, rows: 5, marginMm: 15 });
    const c = l.cells[0]!;
    expect(c.w).toBeCloseTo((210 - 30) / 3);
    expect(c.h).toBeCloseTo((297 - 30) / 5);
    const last = labelLayout(15, { mode: "sheet", widthMm: 100, heightMm: 100, cols: 3, rows: 5, marginMm: 15 }).cells[14]!;
    expect(last.x + last.w).toBeLessThanOrEqual(A4.w - 15 + 1e-9);
    expect(last.y + last.h).toBeLessThanOrEqual(A4.h - 15 + 1e-9);
  });

  test("no label, no page", () => {
    expect(labelLayout(0, DEFAULT_ASSET_LABEL_FORMAT).pages).toBe(0);
    expect(labelLayout(0, { ...DEFAULT_ASSET_LABEL_FORMAT, mode: "sheet" }).pages).toBe(0);
  });
});
