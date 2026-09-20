import { CULTE_TYPES, ENGAGEMENT_TYPE_LABELS, STATUS_LABELS, WORKER_CATEGORY_LABELS, type Currency } from "@church/shared";
import { fmtDate, label, money } from "../../core/format";

export type FilterKey = "period" | "currency" | "accountId" | "categoryId" | "status" | "enteredBy" | "validator" | "engType" | "serviceType" | "workerCategory" | "q";
export type Row = Record<string, any>;
type Kind = "text" | "date" | "money" | "int" | "bool" | "enum";
export interface ColDef { key: string; header: string; kind?: Kind; align?: "right"; curKey?: string; labels?: Record<string, string> }
export interface ReportDef {
  key: string; title: string; description: string;
  filters: FilterKey[]; columns: ColDef[];
  /** Default query params (e.g. validated only). */
  defaults?: Record<string, string>;
  /** Server totals → column keys (per-currency array, or a single object for counts). */
  totalMap?: Record<string, string>; totalLabelCol: string;
  /** Extra text for the "Total" row (e.g. opening / closing balances). */
  totalNote?: { col: string; text: (t: Row) => string };
  /** Which categories the category filter offers. */
  categoryKind?: "recette" | "depense";
}

/** Format one cell as text (same string in table, Excel and PDF). */
export function fmtCell(c: ColDef, r: Row): string {
  const v = r[c.key];
  if (v === null || v === undefined || v === "") return "";
  switch (c.kind) {
    case "money": return money(v, (r[c.curKey ?? "currency"] ?? "CDF") as Currency);
    case "date": return fmtDate(v);
    case "bool": return v ? "Oui" : "Non";
    case "enum": return c.labels?.[v] ?? label(v);
    default: return String(v);
  }
}

const period: FilterKey[] = ["period"];
const txStatusLabels = STATUS_LABELS as Record<string, string>;
const T = (key: string, header: string): ColDef => ({ key, header });
const M = (key: string, header: string): ColDef => ({ key, header, kind: "money", align: "right" });
const N = (key: string, header: string): ColDef => ({ key, header, kind: "int", align: "right" });
const D = (key: string, header: string): ColDef => ({ key, header, kind: "date" });
const cat = (kind: "recette" | "depense", title: string): ReportDef => ({
  key: kind === "recette" ? "recettes-par-categorie" : "depenses-par-categorie", title, categoryKind: kind,
  description: `${kind === "recette" ? "Recettes" : "Dépenses"} validées regroupées par catégorie.`,
  filters: ["period", "currency", "accountId", "categoryId", "status", "enteredBy"], defaults: { status: "validee" },
  columns: [T("category", "Catégorie"), T("group", "Groupe"), { ...T("currency", "Devise") }, N("count", "Nb"), M("total", "Total")],
  totalMap: { count: "count", total: "total" }, totalLabelCol: "category",
});
const counts = ["mAdulte", "mEnfant", "mBebe", "fAdulte", "fEnfant", "fBebe"];
const countHeaders = ["H. adultes", "H. enfants", "H. bébés", "F. adultes", "F. enfants", "F. bébés"];

export const REPORTS: ReportDef[] = [
  {
    key: "journal", title: "Journal", description: "Toutes les écritures de la période, avec soldes d'ouverture et de clôture.",
    filters: ["period", "accountId", "categoryId", "currency", "status", "enteredBy", "validator"], totalLabelCol: "reference",
    columns: [D("date", "Date"), T("reference", "Réf."), T("account", "Compte"), T("category", "Catégorie"), T("description", "Description"),
      M("entree", "Entrée"), M("sortie", "Sortie"), T("currency", "Devise"), { key: "status", header: "Statut", kind: "enum", labels: txStatusLabels },
      T("enteredBy", "Initiateur"), T("validator1", "Validateur 1"), T("validator2", "Validateur 2")],
    totalMap: { entree: "entrees", sortie: "sorties" },
    totalNote: { col: "description", text: (t) => `Ouverture ${money(t.opening, t.currency)} · Clôture ${money(t.closing, t.currency)} (validées)` },
  },
  cat("recette", "Recettes par catégorie"), cat("depense", "Dépenses par catégorie"),
  {
    key: "soldes-par-compte", title: "Soldes par compte", description: "Solde d'ouverture, entrées, sorties et clôture de chaque compte (écritures validées).",
    filters: ["period", "currency", "accountId"], totalLabelCol: "account",
    columns: [T("account", "Compte"), { key: "type", header: "Type", kind: "enum" }, T("currency", "Devise"), M("opening", "Ouverture"), M("entrees", "Entrées"), M("sorties", "Sorties"), M("closing", "Clôture")],
    totalMap: { opening: "opening", entrees: "entrees", sorties: "sorties", closing: "closing" },
  },
  {
    key: "consolide", title: "Consolidé", description: "Caisse + banque + mobile money par devise et par type de compte.",
    filters: ["period", "currency"], totalLabelCol: "type",
    columns: [{ key: "type", header: "Type de compte", kind: "enum" }, T("currency", "Devise"), N("accounts", "Comptes"), M("opening", "Ouverture"), M("entrees", "Entrées"), M("sorties", "Sorties"), M("closing", "Clôture")],
    totalMap: { opening: "opening", entrees: "entrees", sorties: "sorties", closing: "closing" },
  },
  {
    key: "transferts", title: "Transferts et changes", description: "Versements, retraits, transferts et changes (une ligne par opération).",
    filters: ["period", "currency", "accountId", "status", "enteredBy", "validator"], totalLabelCol: "source",
    columns: [D("date", "Date"), { key: "kind", header: "Type", kind: "enum", labels: { transfert: "Transfert", change: "Change" } }, T("source", "Source"), T("destination", "Destination"),
      { ...M("amount", "Montant envoyé") }, T("currency", "Devise"), { ...M("receivedAmount", "Montant reçu"), curKey: "receivedCurrency" }, T("rate", "Taux"), { key: "status", header: "Statut", kind: "enum", labels: txStatusLabels }],
    totalMap: { amount: "amount" },
  },
  {
    key: "engagements", title: "Engagements", description: "Promesses et engagements : engagé, libéré, non libéré et solde.",
    filters: ["currency", "categoryId", "engType"], totalLabelCol: "name",
    columns: [{ key: "nature", header: "Nature", kind: "enum", labels: { promesse: "Promesse", engagement: "Engagement" } }, T("name", "Nom / bénéficiaire"),
      { key: "type", header: "Type", kind: "enum", labels: ENGAGEMENT_TYPE_LABELS }, T("category", "Catégorie"), D("dueDate", "Échéance"),
      M("engage", "Engagé"), M("libere", "Libéré"), M("nonLibere", "Non libéré"), M("solde", "Solde")],
    totalMap: { engage: "engage", libere: "libere", nonLibere: "nonLibere", solde: "solde" },
  },
  {
    key: "effectifs", title: "Effectifs", description: "Fréquentation par date et par type de culte (sexe × nature).",
    filters: ["period", "serviceType"], totalLabelCol: "serviceType",
    columns: [D("date", "Date"), T("serviceType", "Culte"), ...counts.map((k, i) => N(k, countHeaders[i]!)), N("total", "Total culte"), N("dayTotal", "Total journée")],
    totalMap: Object.fromEntries([...counts, "total"].map((k) => [k, k])),
  },
  {
    key: "membres", title: "Membres", description: "Liste des membres.", filters: ["q"], totalLabelCol: "fullName",
    columns: [T("fullName", "Nom"), T("phone", "Téléphone"), T("whatsapp", "WhatsApp"), T("email", "E-mail"), T("address", "Adresse"), T("homeChurch", "Église d'origine"), T("invitedBy", "Invité par"), D("since", "Depuis")],
  },
  {
    key: "ouvriers", title: "Ouvriers", description: "Pasteurs, chefs de département et ouvriers, avec enseignement de base.", filters: ["workerCategory", "q"], totalLabelCol: "fullName",
    columns: [T("fullName", "Nom"), { key: "category", header: "Catégorie", kind: "enum", labels: WORKER_CATEGORY_LABELS }, T("department", "Département"), T("phone", "Téléphone"), T("email", "E-mail"),
      { key: "basicTeaching", header: "Enseignement de base", kind: "bool" }, { key: "active", header: "Actif", kind: "bool" }],
  },
  {
    key: "dedicaces", title: "Dédicaces d'enfants", description: "Registre des dédicaces.", filters: period, totalLabelCol: "childName",
    columns: [D("date", "Date"), T("childName", "Enfant"), T("motherName", "Mère"), T("fatherName", "Père"), T("pastorName", "Pasteur"), { key: "formCompleted", header: "Fiche remplie", kind: "bool" }],
  },
  {
    key: "baptemes", title: "Baptêmes", description: "Registre des baptêmes.", filters: period, totalLabelCol: "fullName",
    columns: [D("date", "Date"), T("fullName", "Nom"), T("place", "Lieu"), T("phone", "Téléphone"), T("address", "Adresse"), T("pastorName", "Pasteur")],
  },
  {
    key: "mariages", title: "Mariages", description: "Registre des mariages.", filters: period, totalLabelCol: "husbandName",
    columns: [D("date", "Date"), T("husbandName", "Époux"), T("wifeName", "Épouse"), T("coupleAddress", "Adresse"), T("phone", "Téléphone"), T("pastorName", "Pasteur"), T("blessingPlace", "Lieu de bénédiction")],
  },
];

export const SERVICE_TYPES = [...CULTE_TYPES];

/** Display / export rows plus formatted total rows (one per currency, or a single one). */
export function buildTable(def: ReportDef, rows: Row[], totals: unknown) {
  const data = rows.map((r) => Object.fromEntries(def.columns.map((c) => [c.key, fmtCell(c, r)])));
  const list: Row[] = Array.isArray(totals) ? totals : totals && typeof totals === "object" && Object.keys(totals).length ? [totals as Row] : [];
  const tot = def.totalMap ? list.map((t) => {
    const out: Row = { [def.totalLabelCol]: t.currency ? `Total ${t.currency}` : "Total" };
    for (const [col, key] of Object.entries(def.totalMap!)) {
      const c = def.columns.find((x) => x.key === col)!;
      out[col] = c.kind === "money" ? money(t[key], t.currency) : t[key];
    }
    if (def.totalNote) out[def.totalNote.col] = def.totalNote.text(t);
    if (t.currency && def.columns.some((c) => c.key === "currency")) out.currency = t.currency;
    return out;
  }) : [];
  return { data, tot };
}
