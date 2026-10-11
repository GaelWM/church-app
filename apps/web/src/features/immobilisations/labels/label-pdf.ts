import { jsPDF } from "jspdf";
import { labelLayout, labelUrl, type AssetLabelFormat, type LabelCell } from "@church/shared";

export interface LabelItem { id: string; code: string; description: string; locationName: string }
/** "etiquette": CEPD MBUDI, code, description, localisation, QR code and barcode. "code": the complete code, large, with its barcode. */
export type LabelVariant = "etiquette" | "code";

const PT_PER_MM = 72 / 25.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lineMm = (pt: number) => (pt / PT_PER_MM) * 1.3;

/** Shortens `text` with an ellipsis until it fits `maxW` mm at the current font. */
function fit(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * The code is the one thing a label must never lose, sequence number included: shrink the font, then drop the "Code :"
 * prefix, rather than ever cutting it with an ellipsis.
 */
function fitCode(doc: jsPDF, code: string, maxW: number, startPt: number): { text: string; pt: number } {
  for (const [text, minPt] of [[`Code : ${code}`, 6.5], [code, 4.5]] as const) {
    for (let pt = startPt; pt >= minPt; pt -= 0.25) {
      doc.setFontSize(pt);
      if (doc.getTextWidth(text) <= maxW) return { text, pt };
    }
  }
  doc.setFontSize(4.5);
  return { text: code, pt: 4.5 };
}

interface Pictures { qr?: string; barcode?: string }

function drawLabel(doc: jsPDF, c: LabelCell, item: LabelItem, pics: Pictures, f: AssetLabelFormat, variant: LabelVariant, outline: boolean) {
  const pad = Math.min(2, c.w * 0.04);
  if (outline) { doc.setDrawColor(190); doc.setLineWidth(0.1); doc.rect(c.x, c.y, c.w, c.h); }
  doc.setTextColor(0);

  if (variant === "code") {
    // The complete code, as large as the label allows.
    const innerW = c.w - 2 * pad;
    doc.setFont("courier", "bold");
    let pt = clamp(c.h * 0.5, 8, 24);
    doc.setFontSize(pt);
    while (pt > 4.5 && doc.getTextWidth(item.code) > innerW) { pt -= 0.5; doc.setFontSize(pt); }
    const barH = f.showBarcode && pics.barcode ? Math.min(c.h * 0.32, 12) : 0;
    doc.text(item.code, c.x + c.w / 2, c.y + pad + (c.h - 2 * pad - barH) / 2 + pt / PT_PER_MM / 3, { align: "center" });
    if (barH) doc.addImage(pics.barcode!, "PNG", c.x + pad, c.y + c.h - pad - barH, innerW, barH, undefined, "FAST");
    return;
  }

  const qrSize = f.showQr && pics.qr ? Math.min(c.h - 2 * pad, c.w * 0.38) : 0;
  const textW = c.w - 2 * pad - (qrSize ? qrSize + pad : 0);
  const barH = f.showBarcode && pics.barcode ? Math.min(c.h * 0.22, 8) : 0;
  const x = c.x + pad;
  const headPt = clamp(c.h * 0.26, 6, 10), codePt = clamp(c.h * 0.28, 6.5, 11), bodyPt = clamp(c.h * 0.2, 5.5, 8.5);
  let y = c.y + pad + headPt / PT_PER_MM * 0.8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(headPt);
  doc.text("CEPD MBUDI", x, y);
  y += lineMm(codePt);
  doc.setFont("courier", "bold");
  const code = fitCode(doc, item.code, textW, codePt);
  doc.text(code.text, x, y);

  doc.setFont("helvetica", "normal"); doc.setFontSize(bodyPt);
  y += lineMm(bodyPt);
  const room = Math.max(0, Math.floor((c.y + c.h - pad - barH - y) / lineMm(bodyPt)) - 1); // lines left for description + location
  const desc = doc.splitTextToSize(`Description : ${item.description}`, textW) as string[];
  const descLines = desc.slice(0, Math.max(1, Math.min(2, room)));
  if (desc.length > descLines.length) descLines[descLines.length - 1] = fit(doc, `${descLines[descLines.length - 1]}…`, textW);
  for (const l of descLines) { doc.text(l, x, y); y += lineMm(bodyPt); }
  doc.text(fit(doc, `Localisation : ${item.locationName}`, textW), x, y);

  if (qrSize) doc.addImage(pics.qr!, "PNG", c.x + c.w - pad - qrSize, c.y + pad, qrSize, qrSize, undefined, "FAST");
  if (barH) doc.addImage(pics.barcode!, "PNG", x, c.y + c.h - pad - barH, textW, barH, undefined, "FAST");
}

/**
 * Builds the PDF of labels. QR code and Code 128 barcode are drawn client-side (the libraries load on demand, so they are
 * not part of the main bundle). Printing goes through a PDF rather than window.print(): the app's print stylesheet is A4 landscape.
 */
export async function buildLabelsPdf(items: LabelItem[], format: AssetLabelFormat, origin: string, variant: LabelVariant): Promise<jsPDF> {
  const [{ default: QRCode }, { default: JsBarcode }] = await Promise.all([import("qrcode"), import("jsbarcode")]);
  const layout = labelLayout(items.length, format);
  const orientation = layout.pageW >= layout.pageH ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [layout.pageW, layout.pageH] });
  let page = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!, cell = layout.cells[i]!;
    while (page < cell.page) { doc.addPage([layout.pageW, layout.pageH], orientation); page += 1; }
    const pics: Pictures = {};
    if (variant === "etiquette" && format.showQr)
      pics.qr = await QRCode.toDataURL(labelUrl(item.id, format.baseUrl, origin), { margin: 0, errorCorrectionLevel: "M", width: 160 } /* ~300 dpi at 13 mm: sharp, and small enough for a batch of hundreds */);
    if (format.showBarcode) {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, item.code, { format: "CODE128", displayValue: false, margin: 0, height: 60, width: 2 });
      pics.barcode = canvas.toDataURL("image/png");
    }
    drawLabel(doc, cell, item, pics, format, variant, format.mode === "sheet");
  }
  return doc;
}
