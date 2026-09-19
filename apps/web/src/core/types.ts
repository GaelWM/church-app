import type { Currency, Role, TxStatus } from "@church/shared";

export interface Parish { id: string; name: string; code: string; city?: string | null; active: boolean; roles: Role[]; consolidatedAccess: boolean }
export interface Me { user: { id: string; email: string; fullName: string }; parishes: Parish[]; permissions: Record<Role, string[]> }
export interface Account { id: string; parishId: string; type: "caisse" | "banque" | "mobile_money"; currency: Currency; name: string; bankName?: string | null; number?: string | null; active: boolean }
export interface Category { id: string; kind: "recette" | "depense" | "banque"; name: string; group?: string | null; fundId?: string | null; requiresDepartment: boolean; active: boolean }
export interface Tx {
  id: string; parishId: string; reference: string; kind: string; direction: "in" | "out"; accountId: string; categoryId: string | null;
  currency: Currency; amountMinor: string; rateUsed: string; amountUsdMinor: string; date: string; status: TxStatus;
  description?: string | null; beneficiary?: string | null; documentNumber?: string | null; departmentId?: string | null; memberId?: string | null;
  enteredBy: string; transferGroupId?: string | null; reversesId?: string | null; pledgeId?: string | null; reconciledAt?: string | null;
}
export interface JournalRow extends Omit<Tx, "amountMinor"> { amount_minor?: string; amountMinor: string; running_balance: string }
