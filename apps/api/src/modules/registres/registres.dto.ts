import { z } from "zod";

export const MAX_BYTES = 8 * 1024 * 1024;
export const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** A register entry date: a real calendar day, from 1900 to tomorrow (UTC slack for local time). */
const regDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").refine((s) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && t >= Date.UTC(1900, 0, 1) && t <= Date.now() + 86_400_000;
}, "Date hors de la période autorisée");
const opt = z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null));
const req = (label: string) => z.string({ message: `${label} requis` }).trim().min(1, `${label} requis`).max(300);

export const schemas = {
  dedications: z.object({ date: regDate, childName: req("Nom de l'enfant"), motherName: opt, fatherName: opt, pastorName: opt, formCompleted: z.boolean().optional() }),
  baptisms: z.object({ fullName: req("Nom"), date: regDate, place: opt, address: opt, phone: opt, email: z.string().trim().email("Email invalide").optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)), whatsapp: opt, pastorName: opt }),
  marriages: z.object({ husbandName: req("Nom de l'époux"), wifeName: req("Nom de l'épouse"), coupleAddress: opt, phone: opt, date: regDate, pastorName: opt, blessingPlace: opt }),
} as const;

/** Filters accepted by the register list endpoint (raw query-string values). */
export type RecordListQuery = { from?: string; to?: string; q?: string; pastor?: string };
