import type { Tx } from "@church/db";
import * as repo from "./dashboard.repo";

/** Who is asking, and which parish scope (null = all parishes the user can see). */
export type Actor = { parishId: string | null; roles: unknown };

/** Raw `?provisional=&from=&to=&currency=` query-string values. */
export type DashboardQuery = { provisional?: string; from?: string; to?: string; currency?: string };

const norm = (rows: any[]) => rows.map((r) => ({ ...r, remaining: (BigInt(r.engaged) - BigInt(r.released) > 0n ? BigInt(r.engaged) - BigInt(r.released) : 0n).toString() }));

export async function getDashboard(tx: Tx, actor: Actor, query: DashboardQuery) {
  // Validated only by default; ?provisional=1 includes pending entries (labelled "provisoire" in the UI).
  const provisional = query.provisional === "1";
  const statuses = provisional ? ["validee", "soumise", "validee1"] : ["validee"];
  const from = query.from ?? new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const to = query.to ?? new Date().toISOString().slice(0, 10);
  const cur = ["CDF", "USD"].includes(query.currency ?? "") ? query.currency! : null;
  const pid = actor.parishId;
  const f: repo.Filters = { statuses, from, to, cur, pid };

  const balances = await repo.accountBalances(tx, f);
  // Recettes vs dépenses by month, per currency plus USD equivalent at each entry's own rate.
  const monthly = await repo.monthly(tx, f);
  // Cumulated recettes / dépenses. Same predicate as GET /transactions/journal's summary (validated, kind recette|depense),
  // so the two screens always show identical figures for the same filters.
  const totals = await repo.totals(tx, f);
  // Répartition par catégorie: native amount per currency (+ USD equivalent for the "All currencies" view).
  const byCategory = await repo.byCategory(tx, f);
  // Engagements: engagé = sum of amounts, libéré = sum of releases, per type and currency (annulés exclus).
  const engagements = { pledges: norm(await repo.engagementsOf(tx, f, "pledges", "pledge_id")), commitments: norm(await repo.engagementsOf(tx, f, "commitments", "commitment_id")) };

  // Negative-balance alerts honour the parish setting `negative_balance_alert` ({enabled}, default true).
  let alertEnabled = true;
  if (pid) {
    const st = await repo.findNegativeBalanceAlertSetting(tx, pid);
    if (st && typeof st.value === "object" && st.value?.enabled === false) alertEnabled = false;
  }
  const negativeAlerts = alertEnabled ? balances.filter((b) => BigInt(b.balance) < 0n) : [];

  const topCategories = await repo.topCategories(tx, f);
  const pending = await repo.pendingCounts(tx, f);
  const pledges = await repo.pledges(tx, f);
  const obligations = await repo.openCommitments(tx, f);
  const attendance = await repo.attendance(tx, f);

  return { provisional, from, to, currency: cur, totals, byCategory, engagements, negativeAlerts, alertEnabled, balances, monthly, topCategories, pending, pledges, obligations, attendance, roles: actor.roles };
}
