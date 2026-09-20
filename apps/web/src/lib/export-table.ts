import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * One export helper for every list and report (§18): Excel, PDF and direct print.
 * Runs in the browser so the Worker's CPU budget is not spent on report rendering.
 * Cells must already be formatted strings/numbers (use core/format helpers; never divide bigint money by 100).
 */
export interface ExportColumn { header: string; key: string; align?: "left" | "right" }
export interface ExportSpec {
  title: string;                       // shown at the top of the PDF / print, and used for the file name
  subtitle?: string;                   // e.g. "Période 01/03/2026 – 31/03/2026 · Devise CDF"
  columns: ExportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  totals?: Record<string, string | number>; // optional last row (keys = column keys)
}
export type ExportFormat = "xlsx" | "pdf" | "print";

const fileBase = (title: string) => title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : v);

export function exportTable(format: ExportFormat, spec: ExportSpec) {
  const body = spec.rows.map((r) => spec.columns.map((c) => cell(r[c.key])));
  if (spec.totals) body.push(spec.columns.map((c) => cell(spec.totals![c.key])));
  const head = spec.columns.map((c) => c.header);

  if (format === "xlsx") {
    const aoa: (string | number)[][] = [[spec.title], ...(spec.subtitle ? [[spec.subtitle]] : []), [], head, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, spec.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 30) || "Rapport");
    XLSX.writeFile(wb, `${fileBase(spec.title)}.xlsx`);
    return;
  }

  const doc = new jsPDF({ orientation: spec.columns.length > 6 ? "landscape" : "portrait" });
  doc.setFontSize(14); doc.text(spec.title, 14, 14);
  let y = 20;
  if (spec.subtitle) { doc.setFontSize(9); doc.text(spec.subtitle, 14, 20); y = 25; }
  autoTable(doc, {
    head: [head], body: body.map((r) => r.map(String)), startY: y, styles: { fontSize: 8 },
    columnStyles: Object.fromEntries(spec.columns.map((c, i) => [i, { halign: c.align ?? "left" }])),
    didParseCell: (d) => { if (spec.totals && d.section === "body" && d.row.index === body.length - 1) d.cell.styles.fontStyle = "bold"; },
  });
  if (format === "pdf") { doc.save(`${fileBase(spec.title)}.pdf`); return; }
  doc.autoPrint();
  window.open(doc.output("bloburl") as unknown as string, "_blank");
}
