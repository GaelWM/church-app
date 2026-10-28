import { z } from "zod";
import {
  assetLabelFormatSchema, DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS, DEFAULT_ASSET_LABEL_FORMAT, degressiveCoefficientsSchema, isFinanceRole, ROLES,
} from "@church/shared";

/** Known parish settings (§15.1, §21, §25). Unknown keys are rejected on write. */
export const settingsSchema = z.object({
  default_currency: z.enum(["CDF", "USD"]),
  piece_number_mode: z.enum(["manual", "auto", "mixed"]),
  negative_balance_alert: z.object({ enabled: z.boolean(), threshold_minor: z.string().regex(/^-?\d+$/, "Montant invalide") }),
  // The alert shows account balances: roles without financial access are dropped (leniently, so a stored value
  // that still lists one keeps its extra_emails instead of falling back to the defaults).
  alert_recipients: z.object({ roles: z.array(z.enum(ROLES)).transform((rs) => rs.filter(isFinanceRole)), extra_emails: z.array(z.string().email()) }),
  retention_policy_note: z.string().max(4000),
  backup_note: z.string().max(4000),
  closure_rule: z.enum(["mensuelle", "annuelle", "les deux"]),
  // Immobilisations: dégressif coefficients by duration, and the étiquette layout.
  asset_degressive_coefficients: degressiveCoefficientsSchema,
  asset_label_format: assetLabelFormatSchema,
});
export type ParishSettings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const SETTINGS_DEFAULTS: ParishSettings = {
  default_currency: "CDF",
  piece_number_mode: "mixed",
  negative_balance_alert: { enabled: true, threshold_minor: "0" },
  alert_recipients: { roles: ["tresorier", "pasteur"], extra_emails: [] },
  retention_policy_note: "",
  backup_note: "",
  closure_rule: "mensuelle",
  asset_degressive_coefficients: DEFAULT_ASSET_DEGRESSIVE_COEFFICIENTS,
  asset_label_format: DEFAULT_ASSET_LABEL_FORMAT,
};
