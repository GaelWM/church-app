import { z } from "zod";
import { DEFAULT_DEGRESSIVE_COEFFICIENTS } from "./depreciation";

/** Per-parish referentials seeded for every parish (migration 9999d seeds existing ones; seedAssetDefaults new ones). */

export interface AssetPrefixDefault {
  acronym: string;
  label: string;
  /** Sous-comptes the acronym is suggested for in the form. */
  subaccountCodes: string[];
  /** Not defined by the client's spec: proposed so every account can be registered; to confirm with them. */
  provisional: boolean;
}

export const DEFAULT_ASSET_PREFIXES: readonly AssetPrefixDefault[] = [
  { acronym: "MB", label: "Mobilier de bureau", subaccountCodes: ["24.4"], provisional: false },
  { acronym: "MT", label: "Matériel de transport", subaccountCodes: ["24.2"], provisional: false },
  { acronym: "MI", label: "Matériel informatique", subaccountCodes: ["24.5"], provisional: false },
  { acronym: "MO", label: "Mobilier et objets de culte", subaccountCodes: ["24.4"], provisional: false },
  { acronym: "MS", label: "Matériel technique et sonorisation", subaccountCodes: ["24.1"], provisional: true },
  { acronym: "TE", label: "Terrains", subaccountCodes: ["22.1", "22.2", "22.3", "22.8"], provisional: true },
  { acronym: "BA", label: "Bâtiments et agencements", subaccountCodes: ["23.1", "23.2", "23.3", "23.4"], provisional: true },
  { acronym: "IN", label: "Immobilisations incorporelles", subaccountCodes: ["21.1", "21.2", "21.3"], provisional: true },
  { acronym: "IF", label: "Immobilisations financières", subaccountCodes: ["27.4", "27.5"], provisional: true },
  { acronym: "AM", label: "Amortissements", subaccountCodes: ["28.1", "28.2", "28.4"], provisional: true },
];

export const DEFAULT_ASSET_LOCATIONS: readonly string[] = [
  "Temple principal", "Bureau pastoral", "Administration", "Presbytère", "École",
  "Salle de réunion", "Département", "Entrepôt", "Autre site",
];

// ---- parish settings used by the module ---------------------------------------------------------

export const degressiveCoefficientsSchema = z.array(z.object({
  min: z.number().int().min(1).max(100),
  max: z.number().int().min(1).max(100).nullable(),
  coef: z.number().positive().max(10).refine((c) => Math.round(c * 100) / 100 === c, "2 décimales maximum"),
}).refine((b) => b.max === null || b.max >= b.min, "La durée maximale doit être supérieure ou égale à la durée minimale")).min(1).max(10);

/** Étiquette d'identification: a roll printer (one label per page) or an A4 sheet of labels (batch). */
export const assetLabelFormatSchema = z.object({
  mode: z.enum(["roll", "sheet"]),
  widthMm: z.number().min(20).max(210),
  heightMm: z.number().min(10).max(297),
  /** Sheet mode only. */
  cols: z.number().int().min(1).max(10),
  rows: z.number().int().min(1).max(30),
  marginMm: z.number().min(0).max(30),
  showQr: z.boolean(),
  showBarcode: z.boolean(),
  /** Origin of the QR link (https://app.example.org). Null = the origin of the page that prints. */
  baseUrl: z.string().url().nullable(),
}).strict();
export type AssetLabelFormat = z.infer<typeof assetLabelFormatSchema>;

export const DEFAULT_ASSET_LABEL_FORMAT: AssetLabelFormat = {
  mode: "roll", widthMm: 70, heightMm: 35, cols: 3, rows: 8, marginMm: 5, showQr: true, showBarcode: true, baseUrl: null,
};

export const DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS = DEFAULT_DEGRESSIVE_COEFFICIENTS.map((b) => ({ ...b }));
