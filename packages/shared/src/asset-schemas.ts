import { z } from "zod";
import {
  ASSET_CURRENCIES, DEPRECIATION_METHODS, ASSET_ETATS, ETATS_REQUIRING_OBSERVATION,
} from "./enums";
import { ASSET_ACCOUNT_CODES, subaccountBelongsTo, findSubaccount } from "./asset-accounts";
import { ASSET_ACRONYM_RE, ASSET_CODE_RE } from "./asset-code";
import { boundedDate } from "./schemas";

/**
 * Shared API contract of the Immobilisations module (the web forms keep user-typed amount strings
 * and convert to the minor-unit strings below before posting).
 * The coût d'acquisition is never an input: the database computes it as PA + FAA.
 */

const uuid = z.string().uuid();
/** Old assets (a temple, land) must be enterable, so the window is far wider than for transactions. */
const assetDate = boundedDate(80, 366);
/** An acquisition has happened (one day of slack for time zones); only a mise en service may be planned ahead. */
const acquisitionDate = boundedDate(80, 1);
/**
 * Largest PA or FAA, in minor units. PA + FAA is a generated bigint column and amounts are displayed through Number(), so both
 * stay far below 2^53 and below the column's range; anything larger is a typing mistake, not an asset.
 */
export const MAX_ASSET_MINOR = 1_000_000_000_000_000n;
const text = (max: number) => z.string().trim().min(1, "Champ obligatoire").max(max);
/** Optional text: empty / missing becomes null. */
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const optUuid = uuid.nullish().transform((v) => v ?? null);
const optDate = assetDate.nullish().transform((v) => v ?? null);
const money = z.coerce.bigint().refine((v) => v <= MAX_ASSET_MINOR, "Montant trop élevé");
/** "1 USD = X <currency>", at most 4 decimals like rateToScaled / transactions.rate_used. */
const fxRate = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Taux invalide").refine((v) => Number(v) > 0, "Taux invalide");

const assetFields = {
  acronym: z.string().regex(ASSET_ACRONYM_RE, "Acronyme invalide"),
  accountCode: z.enum(ASSET_ACCOUNT_CODES),
  subaccountCode: z.string().refine((v) => !!findSubaccount(v), "Sous-compte inconnu"),
  description: text(200),
  invoiceNumber: optText(100),
  supplierId: optUuid,
  acquisitionDate,
  inServiceDate: optDate,
  locationId: uuid, // la localisation est obligatoire
  currency: z.enum(ASSET_CURRENCIES),
  fxRatePerUsd: fxRate.nullish().transform((v) => v ?? null),
  fxRateDate: optDate,
  paMinor: money.refine((v) => v > 0n, "Le prix d'achat doit être positif"),
  faaMinor: money.refine((v) => v >= 0n, "Les frais accessoires ne peuvent pas être négatifs").default(0n),
  method: z.enum(DEPRECIATION_METHODS),
  usefulLifeYears: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  observations: optText(2000),
  transactionId: optUuid, // optional link to the dépense that bought the asset
};

type DraftShape = {
  accountCode: string; subaccountCode: string; method: string; usefulLifeYears: number | null;
  currency: string; fxRatePerUsd: string | null; acquisitionDate: string; inServiceDate: string | null;
};

function checkDraft(v: DraftShape & { paMinor: bigint | string; faaMinor: bigint | string }, ctx: z.RefinementCtx) {
  if (BigInt(v.paMinor) + BigInt(v.faaMinor) > MAX_ASSET_MINOR)
    ctx.addIssue({ code: "custom", path: ["paMinor"], message: "Montant trop élevé" });
  if (!subaccountBelongsTo(v.accountCode, v.subaccountCode))
    ctx.addIssue({ code: "custom", path: ["subaccountCode"], message: "Le sous-compte ne correspond pas au compte" });
  if (v.method === "non_amortissable") {
    if (v.usefulLifeYears !== null) ctx.addIssue({ code: "custom", path: ["usefulLifeYears"], message: "Pas de durée pour un bien non amortissable" });
  } else if (v.usefulLifeYears === null) {
    ctx.addIssue({ code: "custom", path: ["usefulLifeYears"], message: "Durée d'amortissement requise" });
  }
  if (v.currency === "USD" && v.fxRatePerUsd !== null)
    ctx.addIssue({ code: "custom", path: ["fxRatePerUsd"], message: "Pas de taux pour une immobilisation en USD" });
  if (v.inServiceDate !== null && v.inServiceDate < v.acquisitionDate)
    ctx.addIssue({ code: "custom", path: ["inServiceDate"], message: "La mise en service ne peut pas précéder l'acquisition" });
}

const draftBase = z.object(assetFields).strict();

/** Creation / draft edit. `.strict()` also rejects any attempt to send a coût d'acquisition. */
export const assetDraftSchema = draftBase.superRefine(checkDraft);

/** Submission for validation: a depreciable asset must also have its date de mise en service. */
export const assetSubmitSchema = draftBase.superRefine((v, ctx) => {
  checkDraft(v, ctx);
  if (v.method !== "non_amortissable" && v.inServiceDate === null)
    ctx.addIssue({ code: "custom", path: ["inServiceDate"], message: "Date de mise en service requise" });
});
export type AssetDraftInput = z.infer<typeof assetDraftSchema>;

/** Fields a modification request on a validated asset may change. The état and statut have their own flows. */
export const ASSET_MODIFIABLE_FIELDS = [
  "description", "invoiceNumber", "supplierId", "acquisitionDate", "inServiceDate", "locationId", "currency",
  "fxRatePerUsd", "fxRateDate", "paMinor", "faaMinor", "method", "usefulLifeYears", "observations",
  "accountCode", "subaccountCode", "code",
] as const;
export type AssetModifiableField = (typeof ASSET_MODIFIABLE_FIELDS)[number];

/** Partial changes; the service validates the merged row against assetSubmitSchema. `code` is exceptional and audited. */
export const assetModificationSchema = z.object({
  description: assetFields.description,
  invoiceNumber: z.string().trim().max(100).nullable(),
  supplierId: uuid.nullable(),
  acquisitionDate,
  inServiceDate: assetDate.nullable(),
  locationId: uuid,
  currency: assetFields.currency,
  fxRatePerUsd: fxRate.nullable(),
  fxRateDate: assetDate.nullable(),
  paMinor: assetFields.paMinor,
  faaMinor: money.refine((v) => v >= 0n, "Les frais accessoires ne peuvent pas être négatifs"),
  method: assetFields.method,
  usefulLifeYears: z.number().int().min(1).max(100).nullable(),
  observations: z.string().trim().max(2000).nullable(),
  accountCode: assetFields.accountCode,
  subaccountCode: assetFields.subaccountCode,
  code: z.string().regex(ASSET_CODE_RE, "Code invalide"),
}).partial().strict().refine((v) => Object.keys(v).length > 0, "Aucune modification proposée");

export const etatChangeSchema = z.object({
  newEtat: z.enum(ASSET_ETATS),
  reason: z.string().trim().min(3, "Motif obligatoire (3 caractères minimum)").max(500),
  observation: optText(2000),
}).strict().superRefine((v, ctx) => {
  if ((ETATS_REQUIRING_OBSERVATION as readonly string[]).includes(v.newEtat) && !v.observation)
    ctx.addIssue({ code: "custom", path: ["observation"], message: "Justification obligatoire pour ce nouvel état" });
});

/** Modification / annulation requests on a validated asset (creation and état requests have their own endpoints). */
export const assetRequestSchema = z.object({
  kind: z.enum(["modification", "annulation"]),
  reason: z.string().trim().min(5, "Motif obligatoire (5 caractères minimum)").max(1000),
  changes: assetModificationSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === "modification" && !v.changes)
    ctx.addIssue({ code: "custom", path: ["changes"], message: "Aucune modification proposée" });
  if (v.kind === "annulation" && v.changes)
    ctx.addIssue({ code: "custom", path: ["changes"], message: "Une annulation ne porte pas de modifications" });
});

export const assetRequestRejectSchema = z.object({ comment: z.string().trim().min(1, "Motif de rejet obligatoire") });
export const assetRequestDecisionSchema = z.object({ comment: z.string().trim().optional() });

// ---- Referentials managed in Configuration ------------------------------------------------------

export const prefixSchema = z.object({
  acronym: z.string().regex(ASSET_ACRONYM_RE, "Acronyme : 2 à 4 lettres majuscules"),
  label: text(80),
  subaccountCodes: z.array(z.string().refine((v) => !!findSubaccount(v), "Sous-compte inconnu")).default([]),
  active: z.boolean().default(true),
}).strict();
/** The acronym is embedded in issued codes, so it can never change. */
const notEmpty = (v: object) => Object.keys(v).length > 0;
export const prefixUpdateSchema = prefixSchema.omit({ acronym: true }).partial().strict().refine(notEmpty, "Aucune modification");

export const assetLocationSchema = z.object({
  name: text(100), sortOrder: z.number().int().min(0).max(10_000).default(0), active: z.boolean().default(true),
}).strict();
export const assetLocationUpdateSchema = assetLocationSchema.partial().strict().refine(notEmpty, "Aucune modification");

export const assetSupplierSchema = z.object({
  name: text(150), phone: optText(50), address: optText(300), note: optText(500), active: z.boolean().default(true),
}).strict();
export const assetSupplierUpdateSchema = assetSupplierSchema.partial().strict().refine(notEmpty, "Aucune modification");
