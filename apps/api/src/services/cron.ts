import { and, eq, inArray, sql } from "drizzle-orm";
import { parishes, userParishRoles, users, withScope, type Db } from "@church/db";
import { monthlyReport, pendingDigest } from "@church/emails";
import type { Mailer } from "./mailer";
import { safeSend } from "./mailer";

async function recipients(db: Db, parishId: string, role: string) {
  return db.select({ email: users.email }).from(users)
    .innerJoin(userParishRoles, eq(userParishRoles.userId, users.id))
    .where(and(eq(userParishRoles.parishId, parishId), eq(userParishRoles.role, role), eq(users.active, true)));
}

async function allParishes(db: Db) {
  return db.select().from(parishes).where(eq(parishes.active, true));
}

/** 18:00 daily: one digest per parish and step, only if something is pending. */
export async function sendDigests(db: Db, mailer: Mailer, appUrl: string) {
  const ps = await allParishes(db);
  if (!ps.length) return;
  const counts = await withScope(db, { userId: "00000000-0000-0000-0000-000000000000", parishIds: ps.map((p) => p.id) }, async (tx) =>
    [...(await tx.execute(sql`select parish_id, status, count(*)::int as n from transactions where status in ('soumise','validee1') group by 1,2`))] as any[]);
  for (const p of ps) {
    for (const [status, role, step] of [["soumise", "tresorier", 1], ["validee1", "pasteur", 2]] as const) {
      const n = counts.find((r) => r.parish_id === p.id && r.status === status)?.n ?? 0;
      if (!n) continue;
      const to = await recipients(db, p.id, role);
      await safeSend(mailer, to.map((r) => ({ to: r.email, ...pendingDigest({ parish: p.name, step, count: n, appUrl }) })));
    }
  }
}

/** 1st of the month: summary of the previous month for parishes whose period is closed. */
export async function sendMonthlyReports(db: Db, mailer: Mailer, appUrl: string, now = new Date()) {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prev.getUTCFullYear(), month = prev.getUTCMonth() + 1;
  const ps = await allParishes(db);
  if (!ps.length) return;
  const rows = await withScope(db, { userId: "00000000-0000-0000-0000-000000000000", parishIds: ps.map((p) => p.id) }, async (tx) =>
    [...(await tx.execute(sql`
      select p.parish_id, t.kind, sum(t.amount_usd_minor)::bigint as usd
      from periods p join transactions t on t.parish_id = p.parish_id and t.status = 'validee'
        and extract(year from t.date) = p.year and extract(month from t.date) = p.month
      where p.year = ${year} and p.month = ${month} and p.closed_at is not null and t.kind in ('recette','depense')
      group by 1,2`))] as any[]);
  const usd = (m: bigint) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(Number(m) / 100);
  for (const p of ps) {
    const mine = rows.filter((r) => r.parish_id === p.id);
    if (!mine.length) continue;
    const rec = BigInt(mine.find((r) => r.kind === "recette")?.usd ?? 0);
    const dep = BigInt(mine.find((r) => r.kind === "depense")?.usd ?? 0);
    const msg = monthlyReport({ parish: p.name, period: `${String(month).padStart(2, "0")}/${year}`, appUrl,
      lines: [{ label: "Recettes (équiv. USD)", value: usd(rec) }, { label: "Dépenses (équiv. USD)", value: usd(dep) }, { label: "Résultat", value: usd(rec - dep) }] });
    const to = [...(await recipients(db, p.id, "pasteur")), ...(await recipients(db, p.id, "tresorier"))];
    await safeSend(mailer, to.map((r) => ({ to: r.email, ...msg })));
  }
}
