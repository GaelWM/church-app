import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Exports run in the browser so the Worker's CPU budget is not spent on report rendering. */
export function exportExcel(name: string, head: string[], rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, `${name}.xlsx`);
}

export function exportPdf(title: string, head: string[], rows: (string | number)[][]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14); doc.text(title, 14, 14);
  autoTable(doc, { head: [head], body: rows.map((r) => r.map(String)), startY: 20, styles: { fontSize: 8 } });
  doc.save(`${title.replace(/\W+/g, "-")}.pdf`);
}
