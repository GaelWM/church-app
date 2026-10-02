import type { BudgetPeriod, Currency, InvestmentType } from "@church/shared";

export interface ExpenseLine {
  id: string;
  parishId: string;
  year: number;
  categoryId: string;
  categoryName: string;
  categoryGroup: string | null;
  period: BudgetPeriod;
  periodIndex: number;
  currency: Currency;
  amountMinor: string;
  observation?: string | null;
  // Live-computed (never stored):
  realizedMinor: string;
  varianceMinor: string;
  overBudget: boolean;
  consumptionBp: number | null;
}

export interface Investment {
  id: string;
  parishId: string;
  year: number;
  name: string;
  type: InvestmentType;
  currency: Currency;
  amountMinor: string;
  observation?: string | null;
  active: boolean;
  // Live-computed (never stored):
  realizedMinor: string;
  balanceMinor: string;
}

export interface InvestmentOption { id: string; name: string; year: number; currency: Currency }

export interface InvestmentTransaction {
  id: string;
  date: string;
  reference: string;
  status: string;
  description?: string | null;
  amountMinor: string;
  currency: Currency;
}

export interface SummaryRow {
  currency: Currency;
  expenses: { planned: string; realized: string };
  investments: { planned: string; realized: string };
  total: { planned: string; realized: string };
  consumptionBp: number | null;
}
