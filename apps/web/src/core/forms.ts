import { z } from "zod";
import { parseAmount } from "@church/shared";

/** French-formatted amount typed by the user ("1 250,50"), validated as a positive amount. */
export const amountField = z.string().refine((v) => { try { return parseAmount(v) > 0n; } catch { return false; } }, "Montant invalide");
export const requiredSelect = (message: string) => z.string().min(1, message);
export const optionalText = z.string().optional();
