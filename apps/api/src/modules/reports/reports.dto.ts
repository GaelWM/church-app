import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportQuerySchema = z.object({
  from: opt(date), to: opt(date), currency: opt(z.enum(["CDF", "USD"])),
  accountId: opt(z.string().uuid()), categoryId: opt(z.string().uuid()), status: opt(z.string()),
  enteredBy: opt(z.string().uuid()), validator: opt(z.string().uuid()),
  // report specific
  type: opt(z.string()), serviceType: opt(z.string()), category: opt(z.string()), q: opt(z.string()),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
