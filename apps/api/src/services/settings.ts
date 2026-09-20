import { eq } from "drizzle-orm";
import { z } from "zod";
import { settings, type Tx } from "@church/db";
import { ROLES } from "@church/shared";

/** Known parish settings (§15.1, §21, §25). Unknown keys are rejected on write. */
export const settingsSchema = z.object({
  default_currency: z.enum(["CDF", "USD"]),
  piece_number_mode: z.enum(["manual", "auto", "mixed"]),
  negative_balance_alert: z.object({ enabled: z.boolean(), threshold_minor: z.string().regex(/^-?\d+$/, "Montant invalide") }),
  alert_recipients: z.object({ roles: z.array(z.enum(ROLES)), extra_emails: z.array(z.string().email()) }),
  retention_policy_note: z.string().max(4000),
  backup_note: z.string().max(4000),
  closure_rule: z.enum(["mensuelle", "annuelle", "les deux"]),
});
export type ParishSettings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().strict();

export const SETTINGS_DEFAULTS: ParishSettings = {
  default_currency: "CDF",
  piece_number_mode: "mixed",
  negative_balance_alert: { enabled: true, threshold_minor: "0" },
  alert_recipients: { roles: ["tresorier", "pasteur"], extra_emails: [] },
  retention_policy_note: "",
  backup_note: "",
  closure_rule: "mensuelle",
};

/** All settings of a parish with defaults filled in (invalid stored values fall back to the default). */
export async function getSettings(tx: Tx, parishId: string): Promise<ParishSettings> {
  const rows = await tx.select().from(settings).where(eq(settings.parishId, parishId));
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  for (const r of rows) {
    const shape = (settingsSchema.shape as Record<string, z.ZodType>)[r.key];
    const v = shape?.safeParse(r.value);
    if (v?.success) out[r.key] = v.data;
  }
  return out as ParishSettings;
}
