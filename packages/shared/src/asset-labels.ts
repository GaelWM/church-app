import type { AssetLabelFormat } from "./asset-defaults";

/** Where a label goes on the printed pages. Pure, so the web app (which has no test runner) only has to draw. */

export const A4 = { w: 210, h: 297 } as const;

/** The page an étiquette opens: the fiche of the asset (access follows the reader's rights). */
export function labelUrl(assetId: string, baseUrl: string | null, origin: string): string {
  return `${(baseUrl?.trim() || origin).replace(/\/+$/, "")}/immobilisations/${assetId}`;
}

export interface LabelCell { page: number; x: number; y: number; w: number; h: number }
export interface LabelLayout { pageW: number; pageH: number; pages: number; perPage: number; cells: LabelCell[] }

type LayoutFormat = Pick<AssetLabelFormat, "mode" | "widthMm" | "heightMm" | "cols" | "rows" | "marginMm">;

/**
 * "roll": one label per page, the page being the label (label printers).
 * "sheet": labels of widthMm × heightMm on A4 pages, `cols` × `rows` per page from the margin; a grid that would not fit
 * on the page is shrunk to fit rather than cut off.
 */
export function labelLayout(count: number, f: LayoutFormat): LabelLayout {
  if (f.mode === "roll") {
    return {
      pageW: f.widthMm, pageH: f.heightMm, pages: count, perPage: 1,
      cells: Array.from({ length: count }, (_, i) => ({ page: i, x: 0, y: 0, w: f.widthMm, h: f.heightMm })),
    };
  }
  const w = Math.min(f.widthMm, (A4.w - 2 * f.marginMm) / f.cols);
  const h = Math.min(f.heightMm, (A4.h - 2 * f.marginMm) / f.rows);
  const perPage = f.cols * f.rows;
  return {
    pageW: A4.w, pageH: A4.h, pages: Math.ceil(count / perPage), perPage,
    cells: Array.from({ length: count }, (_, i) => {
      const pos = i % perPage;
      return { page: Math.floor(i / perPage), x: f.marginMm + (pos % f.cols) * w, y: f.marginMm + Math.floor(pos / f.cols) * h, w, h };
    }),
  };
}
