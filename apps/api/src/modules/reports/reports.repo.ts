import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@church/db";
import { inList } from "../../services/sql";
import type { ReportQuery as Q } from "./reports.dto";

/** WHERE fragment on transactions aliased `t` (caller supplies kinds + default statuses). */
export function txWhere(q: Q, parishId: string | null, o: { kinds?: string[]; defaultStatus?: string[]; alias?: string; skip?: ("period")[] }): SQL {
  const t = sql.raw(o.alias ?? "t");
  const statuses = q.status ? q.status.split(",") : o.defaultStatus;
  const parts: SQL[] = [
    o.kinds ? sql`${t}.kind in (${inList(o.kinds)})` : sql`true`,
    statuses ? sql`${t}.status in (${inList(statuses)})` : sql`true`,
    parishId ? sql`${t}.parish_id = ${parishId}::uuid` : sql`true`,
    q.currency ? sql`${t}.currency = ${q.currency}` : sql`true`,
    q.accountId ? sql`${t}.account_id = ${q.accountId}::uuid` : sql`true`,
    q.categoryId ? sql`${t}.category_id = ${q.categoryId}::uuid` : sql`true`,
    q.enteredBy ? sql`${t}.entered_by = ${q.enteredBy}::uuid` : sql`true`,
    q.validator ? sql`(${t}.validator1_id = ${q.validator}::uuid or ${t}.validator2_id = ${q.validator}::uuid)` : sql`true`,
    q.from ? sql`${t}.date >= ${q.from}::date` : sql`true`,
    q.to ? sql`${t}.date <= ${q.to}::date` : sql`true`,
  ];
  return sql.join(parts, sql` and `);
}

const signed = sql`case when t.direction = 'in' then t.amount_minor else -t.amount_minor end`;

export async function listScopeUsers(tx: Tx, parishId: string | null) {
  return await tx.execute(sql`
    select distinct u.id, u.full_name from users u join user_parish_roles r on r.user_id = u.id
    where ${parishId ? sql`r.parish_id = ${parishId}::uuid` : sql`true`} order by u.full_name`);
}

export async function journalRows(tx: Tx, q: Q, parishId: string | null) {
  return [...await tx.execute(sql`
        select t.id, t.date::text as date, t.reference, t.kind, t.direction, t.status, t.currency, t.amount_minor::text as amount,
          t.description, a.name as account, cat.name as category, ue.full_name as entered_by, v1.full_name as validator1, v2.full_name as validator2
        from transactions t join accounts a on a.id = t.account_id left join categories cat on cat.id = t.category_id
          join users ue on ue.id = t.entered_by left join users v1 on v1.id = t.validator1_id left join users v2 on v2.id = t.validator2_id
        where ${txWhere(q, parishId, {})} order by t.date, t.created_at, t.id limit 5000`)] as any[];
}

/** Opening = validated balance before `from`, honouring only the account / currency filters. */
export async function journalOpening(tx: Tx, q: Q, parishId: string | null) {
  return [...await tx.execute(sql`
        select t.currency, coalesce(sum(${signed}), 0)::text as opening from transactions t
        where t.status = 'validee' and t.date < ${q.from}::date and ${txWhere({ accountId: q.accountId, currency: q.currency } as Q, parishId, {})}
        group by t.currency`)] as any[];
}

/** Per account: opening (validated, before `from`), entrées, sorties in period. */
export async function accountBalances(tx: Tx, q: Q, parishId: string | null) {
  const before = q.from ? sql`t.date < ${q.from}::date` : sql`false`;
  const inPeriod = sql.join([q.from ? sql`t.date >= ${q.from}::date` : sql`true`, q.to ? sql`t.date <= ${q.to}::date` : sql`true`], sql` and `);
  return await tx.execute(sql`
    select a.id, a.name, a.type, a.currency,
      coalesce(sum(case when ${before} then ${signed} else 0 end), 0)::text as opening,
      coalesce(sum(case when ${inPeriod} and t.direction = 'in' then t.amount_minor else 0 end), 0)::text as entrees,
      coalesce(sum(case when ${inPeriod} and t.direction = 'out' then t.amount_minor else 0 end), 0)::text as sorties
    from accounts a left join transactions t on t.account_id = a.id and t.status = 'validee'
      and (${q.to ? sql`t.date <= ${q.to}::date` : sql`true`})
    where ${parishId ? sql`a.parish_id = ${parishId}::uuid` : sql`true`}
      ${q.currency ? sql`and a.currency = ${q.currency}` : sql``} ${q.accountId ? sql`and a.id = ${q.accountId}::uuid` : sql``}
    group by a.id, a.name, a.type, a.currency order by a.type, a.name`);
}

export async function transferLegs(tx: Tx, q: Q, parishId: string | null) {
  return await tx.execute(sql`
      select t.transfer_group_id::text as grp, t.kind, t.direction, t.date::text as date, t.status, t.currency, t.amount_minor::text as amount, t.rate_used, a.name as account, a.type as account_type
      from transactions t join accounts a on a.id = t.account_id
      where t.kind in ('transfert', 'change') and t.transfer_group_id is not null and ${parishId ? sql`t.parish_id = ${parishId}::uuid` : sql`true`}
        and t.status ${q.status ? sql`in (${inList(q.status.split(","))})` : sql`<> 'annulee'`}
        and t.transfer_group_id in (select t.transfer_group_id from transactions t where ${txWhere({ ...q, status: undefined }, parishId, { kinds: ["transfert", "change"] })})
      order by t.date, t.transfer_group_id, t.direction desc`);
}

export async function engagementRows(tx: Tx, q: Q, parishId: string | null) {
  const common = (alias: string) => sql.join([
    parishId ? sql`${sql.raw(alias)}.parish_id = ${parishId}::uuid` : sql`true`,
    q.currency ? sql`${sql.raw(alias)}.currency = ${q.currency}` : sql`true`,
    q.categoryId ? sql`${sql.raw(alias)}.category_id = ${q.categoryId}::uuid` : sql`true`,
    q.type ? sql`${sql.raw(alias)}.type = ${q.type}` : sql`true`,
    q.from ? sql`(${sql.raw(alias)}.due_date is null or ${sql.raw(alias)}.due_date >= ${q.from}::date)` : sql`true`,
    q.to ? sql`(${sql.raw(alias)}.due_date is null or ${sql.raw(alias)}.due_date <= ${q.to}::date)` : sql`true`,
  ], sql` and `);
  const rel = (col: string) => sql`coalesce((select sum(r.amount_minor) from engagement_releases r where r.${sql.raw(col)} = x.id
        ${q.to ? sql`and r.date <= ${q.to}::date` : sql``}), 0)::text`;
  const pledges = [...await tx.execute(sql`
        select x.id, 'promesse' as nature, coalesce(m.full_name, x.donor_name, '') as name, x.type, cat.name as category, x.currency,
          x.amount_minor::text as engage, ${rel("pledge_id")} as libere, x.due_date::text as due_date
        from pledges x left join members m on m.id = x.member_id join categories cat on cat.id = x.category_id where ${common("x")} order by x.due_date nulls last`)] as any[];
  const commits = [...await tx.execute(sql`
        select x.id, 'engagement' as nature, x.payee as name, x.type, cat.name as category, x.currency, x.amount_minor::text as engage,
          case when x.status = 'paid' and not exists (select 1 from engagement_releases r where r.commitment_id = x.id) then x.amount_minor::text else ${rel("commitment_id")} end as libere,
          x.due_date::text as due_date
        from commitments x join categories cat on cat.id = x.category_id where x.status <> 'cancelled' and ${common("x")} order by x.due_date nulls last`)] as any[];
  return [...pledges, ...commits];
}

export async function attendanceRows(tx: Tx, q: Q, parishId: string | null, fields: readonly string[]) {
  return await tx.execute(sql`
      select id, service_date::text as date, service_type, ${sql.raw(fields.join(", "))} from attendance_records
      where ${sql.join([
        parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`,
        q.from ? sql`service_date >= ${q.from}::date` : sql`true`, q.to ? sql`service_date <= ${q.to}::date` : sql`true`,
        q.serviceType ? sql`service_type = ${q.serviceType}` : sql`true`,
      ], sql` and `)} order by service_date, service_type`);
}

export async function memberRows(tx: Tx, q: Q, parishId: string | null) {
  return await tx.execute(sql`
      select id, full_name, phone, whatsapp, email, address, home_church, invited_by, created_at::date::text as since from members
      where ${parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`} ${q.q ? sql`and full_name ilike ${"%" + q.q + "%"}` : sql``} order by full_name`);
}

export async function workerRows(tx: Tx, q: Q, parishId: string | null) {
  return await tx.execute(sql`
      select w.id, w.full_name, w.category, w.phone, w.email, w.whatsapp, w.address, w.basic_teaching_done, w.active, d.name as department
      from workers w left join departments d on d.id = w.department_id
      where ${parishId ? sql`w.parish_id = ${parishId}::uuid` : sql`true`} ${q.category ? sql`and w.category = ${q.category}` : sql``}
      ${q.q ? sql`and w.full_name ilike ${"%" + q.q + "%"}` : sql``} order by w.category, w.full_name`);
}

export async function registerRows(tx: Tx, q: Q, parishId: string | null, table: string, dateCol: string, cols: string) {
  return await tx.execute(sql`
    select ${sql.raw(cols)} from ${sql.raw(table)} where ${sql.join([
      parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`,
      q.from ? sql`${sql.raw(dateCol)} >= ${q.from}::date` : sql`true`, q.to ? sql`${sql.raw(dateCol)} <= ${q.to}::date` : sql`true`,
    ], sql` and `)} order by ${sql.raw(dateCol)}`);
}

export async function totalsByCategory(tx: Tx, q: Q, parishId: string | null, kind: "recette" | "depense") {
  return await tx.execute(sql`
    select cat.id as category_id, coalesce(cat.name, 'Sans catégorie') as category, cat."group" as grp, t.currency,
      count(*)::int as count, sum(t.amount_minor)::text as total
    from transactions t left join categories cat on cat.id = t.category_id
    where ${txWhere(q, parishId, { kinds: [kind], defaultStatus: ["validee"] })}
    group by cat.id, cat.name, cat."group", t.currency order by t.currency, sum(t.amount_minor) desc`);
}
