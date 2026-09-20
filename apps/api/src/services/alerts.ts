import { and, eq, inArray, sql } from "drizzle-orm";
import { parishes, userParishRoles, users, withScope, type Db } from "@church/db";
import { negativeBalanceEmail } from "@church/emails";
import type { Mailer } from "./mailer";
import { safeSend } from "./mailer";
import { getSettings } from "./settings";

const SYSTEM = "00000000-0000-0000-0000-000000000000";

/** Daily: email the configured recipients when an account's validated balance is under the parish threshold. */
export async function checkNegativeBalances(db: Db, mailer: Mailer, appUrl: string) {
  const ps = await db.select().from(parishes).where(eq(parishes.active, true));
  if (!ps.length) return;
  const scope = { userId: SYSTEM, parishIds: ps.map((p) => p.id) };
  for (const p of ps) {
    const found = await withScope(db, scope, async (tx) => {
      const s = await getSettings(tx, p.id);
      if (!s.negative_balance_alert.enabled) return null;
      const threshold = BigInt(s.negative_balance_alert.threshold_minor);
      const rows = [...(await tx.execute(sql`
        select a.name, a.currency, coalesce(sum(case when t.direction = 'in' then t.amount_minor else -t.amount_minor end), 0)::text as bal
        from accounts a left join transactions t on t.account_id = a.id and t.status = 'validee'
        where a.parish_id = ${p.id} and a.active group by a.id, a.name, a.currency`))] as any[];
      const low = rows.filter((r) => BigInt(r.bal) < threshold);
      return low.length ? { s, low, threshold } : null;
    });
    if (!found) continue;
    const { s, low, threshold } = found;
    const fmt = (m: bigint, cur: string) => `${new Intl.NumberFormat("fr-FR").format(Number(m) / 100)} ${cur}`;
    const roleEmails = s.alert_recipients.roles.length
      ? await db.select({ email: users.email }).from(users).innerJoin(userParishRoles, eq(userParishRoles.userId, users.id))
        .where(and(eq(userParishRoles.parishId, p.id), inArray(userParishRoles.role, s.alert_recipients.roles), eq(users.active, true)))
      : [];
    const to = [...new Set([...roleEmails.map((r) => r.email), ...s.alert_recipients.extra_emails])];
    const msg = negativeBalanceEmail({
      parish: p.name, appUrl, threshold: fmt(threshold, ""),
      accounts: low.map((r) => ({ name: `${r.name} (${r.currency})`, balance: fmt(BigInt(r.bal), r.currency) })),
    });
    await safeSend(mailer, to.map((email) => ({ to: email, ...msg })));
  }
}
