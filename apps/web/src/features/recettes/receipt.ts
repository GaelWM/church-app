import { jsPDF } from "jspdf";
import type { Currency } from "@church/shared";
import { fmtDate, money } from "../../core/format";
import type { Tx } from "../../core/types";

/** Numbered printable reçu for a validated recette (generated in the browser). */
export function receiptPdf(t: Tx, parish: string, category: string, account: string) {
  const doc = new jsPDF();
  doc.setFontSize(18); doc.text(`Reçu N° ${t.reference}`, 20, 25);
  doc.setFontSize(12);
  const lines = [
    `Paroisse : ${parish}`, `Date : ${fmtDate(t.date)}`, `Catégorie : ${category}`, `Compte : ${account}`,
    `Montant : ${money(t.amountMinor, t.currency as Currency)}`, t.description ? `Objet : ${t.description}` : "",
  ].filter(Boolean);
  lines.forEach((l, i) => doc.text(l, 20, 45 + i * 9));
  doc.text("Reçu avec gratitude.", 20, 45 + lines.length * 9 + 12);
  doc.save(`recu-${t.reference}.pdf`);
}
