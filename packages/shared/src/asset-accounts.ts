import type { DepreciationMethod } from "./enums";

/**
 * Plan of the fixed-asset accounts used by the Immobilisations menu: principal accounts and their
 * sous-comptes. Fixed by the spec, so it lives here as constants (no table, no round-trip for the
 * dependent dropdown). Principal accounts and sous-comptes are never mixed in one list.
 */

export const ASSET_ACCOUNT_CODES = ["21", "22", "23", "24", "27", "28"] as const;
export type AssetAccountCode = (typeof ASSET_ACCOUNT_CODES)[number];

export const ASSET_ACCOUNT_LABELS: Record<AssetAccountCode, string> = {
  "21": "Immobilisations incorporelles",
  "22": "Terrains",
  "23": "Bâtiments, installations techniques et agencements",
  "24": "Matériel, mobilier et matériel de transport",
  "27": "Immobilisations financières",
  "28": "Amortissements des immobilisations",
};

/** Categories of the "État par catégorie" report. */
export const ASSET_CATEGORIES = [
  "Terrains", "Bâtiments", "Matériel", "Mobilier", "Informatique", "Transport", "Incorporelles", "Financières",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Default depreciation mode suggested when the sous-compte is picked (the user may still change it). */
export type DefaultMode = Extract<DepreciationMethod, "lineaire" | "non_amortissable">;

export interface AssetSubaccount {
  code: string;
  account: AssetAccountCode;
  label: string;
  category: AssetCategory;
  defaultMode: DefaultMode;
}

const sub = (account: AssetAccountCode, code: string, label: string, category: AssetCategory, defaultMode: DefaultMode = "lineaire"): AssetSubaccount =>
  ({ code, account, label, category, defaultMode });

export const ASSET_SUBACCOUNTS: readonly AssetSubaccount[] = [
  sub("21", "21.1", "Frais de développement / projets", "Incorporelles"),
  sub("21", "21.2", "Logiciels, progiciels et sites internet", "Incorporelles"),
  sub("21", "21.3", "Brevets, licences, marques et droits d'auteur", "Incorporelles"),
  sub("22", "22.1", "Terrains agricoles / concessions", "Terrains", "non_amortissable"),
  sub("22", "22.2", "Terrains bâtis", "Terrains", "non_amortissable"),
  sub("22", "22.3", "Terrains aménagés", "Terrains"),
  sub("22", "22.8", "Terrains de carrières", "Terrains"),
  sub("23", "23.1", "Bâtiments industriels, agricoles ou des projets", "Bâtiments"),
  sub("23", "23.2", "Bâtiments administratifs et à usage de culte", "Bâtiments"),
  sub("23", "23.3", "Bâtiments médico-sociaux et éducatifs", "Bâtiments"),
  sub("23", "23.4", "Aménagement et agencement des bâtiments", "Bâtiments"),
  sub("24", "24.1", "Matériel industriel, technique et sonorisation", "Matériel"),
  sub("24", "24.2", "Matériel de transport", "Transport"),
  sub("24", "24.4", "Mobilier et objets de culte", "Mobilier"),
  sub("24", "24.5", "Matériel informatique", "Informatique"),
  sub("27", "27.4", "Prêts et avances", "Financières", "non_amortissable"),
  sub("27", "27.5", "Dépôts et cautionnements versés", "Financières", "non_amortissable"),
  // Contra-accounts: grouped with the category they depreciate (best effort, 28.4 covers matériel/mobilier/transport).
  sub("28", "28.1", "Amortissement des immobilisations incorporelles", "Incorporelles", "non_amortissable"),
  sub("28", "28.2", "Amortissement des bâtiments", "Bâtiments", "non_amortissable"),
  sub("28", "28.4", "Amortissement du matériel, mobilier et matériel de transport", "Matériel", "non_amortissable"),
];

const BY_CODE = new Map(ASSET_SUBACCOUNTS.map((s) => [s.code, s]));

export const isAssetAccountCode = (v: string): v is AssetAccountCode => (ASSET_ACCOUNT_CODES as readonly string[]).includes(v);
export const findSubaccount = (code: string): AssetSubaccount | undefined => BY_CODE.get(code);
export const subaccountsOf = (account: string): readonly AssetSubaccount[] => ASSET_SUBACCOUNTS.filter((s) => s.account === account);
/** True when `subaccount` exists and belongs to `account`. */
export const subaccountBelongsTo = (account: string, subaccount: string): boolean => BY_CODE.get(subaccount)?.account === account;
export const categoryOf = (subaccount: string): AssetCategory | undefined => BY_CODE.get(subaccount)?.category;
export const defaultModeOf = (subaccount: string): DefaultMode => BY_CODE.get(subaccount)?.defaultMode ?? "lineaire";

export const accountLabel = (code: string): string => (ASSET_ACCOUNT_LABELS as Record<string, string>)[code] ?? code;
export const subaccountLabel = (code: string): string => BY_CODE.get(code)?.label ?? code;
/** "24.5 — Matériel informatique" / "24 — Matériel, mobilier et matériel de transport" */
export const accountDisplay = (code: string): string => `${code} — ${accountLabel(code)}`;
export const subaccountDisplay = (code: string): string => `${code} — ${subaccountLabel(code)}`;

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Free-text search over accounts and sous-comptes (code prefix, or accent-insensitive label match
 * from 3 characters), used by the register search "Compte / Sous-compte".
 */
export function matchAccountCodes(q: string): { accountCodes: AssetAccountCode[]; subaccountCodes: string[] } {
  const n = norm(q);
  if (!n) return { accountCodes: [], subaccountCodes: [] };
  const byLabel = n.length >= 3;
  const hit = (code: string, label: string) => code.startsWith(n) || (byLabel && norm(label).includes(n));
  return {
    accountCodes: ASSET_ACCOUNT_CODES.filter((c) => hit(c, ASSET_ACCOUNT_LABELS[c])),
    subaccountCodes: ASSET_SUBACCOUNTS.filter((s) => hit(s.code, s.label)).map((s) => s.code),
  };
}
