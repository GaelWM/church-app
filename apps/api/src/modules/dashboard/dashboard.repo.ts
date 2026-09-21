import { sql } from "drizzle-orm";
import type { Tx } from "@church/db";
import { inList } from "../../services/sql";

/** Common filters of a dashboard request, already normalised by the service. */
export type Filters = {
  statuses: string[]; from: string; to: string;
  cur: string | null; // currency filter
  pid: string | null; // parish scope
};

const q = async (tx: Tx, s: any) => [...(await tx.execute(s))] as any[];
const scopeOf = (f: Filters) => (f.pid ? sql`and t.parish_id = ${f.pid}::uuid` : sql``);
const curOf = (f: Filters) => (f.cur ? sql`and t.currency = ${f.cur}` : sql``);

export const accountBalances = (tx: Tx, f: Filters) => q(tx, sql`
        select a.id, a.name, a.type, a.currency, a.parish_id,
          coalesce(sum(case when t.direction='in' then t.amount_minor else -t.amount_minor end),0)::text as balance
        from accounts a left join transactions t on t.account_id = a.id and t.status in (${inList(f.statuses)}) and t.date <= ${f.to}::date
        where a.active ${f.cur ? sql`and a.currency = ${f.cur}` : sql``} ${f.pid ? sql`and a.parish_id = ${f.pid}::uuid` : sql``}
        group by a.id order by a.parish_id, a.name`);

export const monthly = (tx: Tx, f: Filters) => q(tx, sql`
        select to_char(date_trunc('month', t.date),'YYYY-MM') as month, t.kind, t.currency,
          sum(t.amount_minor)::text as total, sum(t.amount_usd_minor)::text as total_usd
        from transactions t where t.kind in ('recette','depense') and t.status in (${inList(f.statuses)})
          and t.date between ${f.from}::date and ${f.to}::date ${scopeOf(f)} ${curOf(f)}
        group by 1,2,3 order by 1`);

export const totals = (tx: Tx, f: Filters) => q(tx, sql`
        select t.currency, sum(case when t.kind='recette' then t.amount_minor else 0 end)::text as recettes,
          sum(case when t.kind='depense' then t.amount_minor else 0 end)::text as depenses
        from transactions t where t.kind in ('recette','depense') and t.status in (${inList(f.statuses)})
          and t.date between ${f.from}::date and ${f.to}::date ${scopeOf(f)} ${curOf(f)}
        group by t.currency order by t.currency`);

export const byCategory = (tx: Tx, f: Filters) => q(tx, sql`
        select t.kind, c.name, t.currency, sum(t.amount_minor)::text as total, sum(t.amount_usd_minor)::text as total_usd
        from transactions t join categories c on c.id = t.category_id
        where t.kind in ('recette','depense') and t.status in (${inList(f.statuses)}) and t.date between ${f.from}::date and ${f.to}::date ${scopeOf(f)} ${curOf(f)}
        group by t.kind, c.name, t.currency order by sum(t.amount_usd_minor) desc`);

export const engagementsOf = (tx: Tx, f: Filters, table: "pledges" | "commitments", fk: "pledge_id" | "commitment_id") => q(tx, sql`
        select e.type, e.currency, sum(e.amount_minor)::text as engaged,
          coalesce(sum((select coalesce(sum(r.amount_minor),0) from engagement_releases r where r.${sql.raw(fk)} = e.id)),0)::text as released
        from ${sql.raw(table)} e where true ${table === "commitments" ? sql`and e.status <> 'cancelled'` : sql``}
          ${f.cur ? sql`and e.currency = ${f.cur}` : sql``} ${f.pid ? sql`and e.parish_id = ${f.pid}::uuid` : sql``}
        group by e.type, e.currency order by e.type, e.currency`);

export async function findNegativeBalanceAlertSetting(tx: Tx, parishId: string) {
  const [st] = await q(tx, sql`select value from settings where parish_id = ${parishId}::uuid and key = 'negative_balance_alert'`);
  return st;
}

export const topCategories = (tx: Tx, f: Filters) => q(tx, sql`
        select c.name, t.kind, sum(t.amount_usd_minor)::text as total_usd,
          sum(case when t.date >= (${f.to}::date - (${f.to}::date - ${f.from}::date)/2) then t.amount_usd_minor else 0 end)::text as recent_half_usd,
          sum(case when t.date <  (${f.to}::date - (${f.to}::date - ${f.from}::date)/2) then t.amount_usd_minor else 0 end)::text as previous_half_usd
        from transactions t join categories c on c.id = t.category_id
        where t.kind in ('recette','depense') and t.status in (${inList(f.statuses)}) and t.date between ${f.from}::date and ${f.to}::date ${scopeOf(f)} ${curOf(f)}
        group by c.name, t.kind order by sum(t.amount_usd_minor) desc limit 10`);

export async function pendingCounts(tx: Tx, f: Filters) {
  const [pending] = await q(tx, sql`
        select count(*) filter (where t.status='soumise')::int as awaiting_first,
               count(*) filter (where t.status='validee1')::int as awaiting_second
        from transactions t where true ${scopeOf(f)}`);
  return pending;
}

export const pledges = (tx: Tx, f: Filters) => q(tx, sql`
        select p.id, p.donor_name, p.currency, p.amount_minor::text as promised, p.due_date,
          coalesce((select sum(t.amount_minor) from transactions t where t.pledge_id = p.id and t.status='validee'),0)::text as received
        from pledges p where true ${f.pid ? sql`and p.parish_id = ${f.pid}::uuid` : sql``}`);

export const openCommitments = (tx: Tx, f: Filters) => q(tx, sql`
        select id, payee, currency, amount_minor::text as amount, due_date from commitments
        where status = 'open' ${f.pid ? sql`and parish_id = ${f.pid}::uuid` : sql``} order by due_date nulls last limit 20`);

export const attendance = (tx: Tx, f: Filters) => q(tx, sql`
        select a.service_date, a.service_type, (a.hommes+a.femmes+a.jeunes+a.enfants+a.visiteurs+a.m_adulte+a.m_enfant+a.m_bebe+a.f_adulte+a.f_enfant+a.f_bebe) as total,
          (select coalesce(sum(t.amount_usd_minor),0)::text from transactions t join categories c on c.id=t.category_id
            where t.parish_id = a.parish_id and t.date = a.service_date and t.kind='recette' and t.status in (${inList(f.statuses)}) and c.name like 'Offrande%') as offering_usd
        from attendance_records a where a.status = 'validee' and a.service_date between ${f.from}::date and ${f.to}::date
          ${f.pid ? sql`and a.parish_id = ${f.pid}::uuid` : sql``} order by a.service_date`);
