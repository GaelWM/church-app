import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { can } from "@church/shared";
import type { AppEnv } from "../env";
import { parishScope } from "../middleware/auth";
import { run } from "../services/run";
import { inList } from "../services/sql";

/** Report reads need report.export OR transaction.readAll (caissier has neither). */
const requireReportAccess = async (c: any, next: any) => {
  const roles = c.get("roles");
  if (!can(roles, "report.export") && !can(roles, "transaction.readAll")) throw new HTTPException(403, { message: "Permission refusée" });
  await next();
};

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  from: opt(date), to: opt(date), currency: opt(z.enum(["CDF", "USD"])),
  accountId: opt(z.string().uuid()), categoryId: opt(z.string().uuid()), status: opt(z.string()),
  enteredBy: opt(z.string().uuid()), validator: opt(z.string().uuid()),
  // report specific
  type: opt(z.string()), serviceType: opt(z.string()), category: opt(z.string()), q: opt(z.string()),
});
type Q = z.infer<typeof querySchema>;

const S = (v: unknown) => (v === null || v === undefined ? null : String(v));
const big = (v: unknown) => BigInt(String(v ?? 0));
const zero = 0n;

/** WHERE fragment on transactions aliased `t` (caller supplies kinds + default statuses). */
function txWhere(q: Q, parishId: string | null, o: { kinds?: string[]; defaultStatus?: string[]; alias?: string; skip?: ("period")[] }): SQL {
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

type Tot = { currency: string; [k: string]: string };
/** Sum named bigint fields per currency. */
function sumBy(rows: Record<string, any>[], fields: string[]): Tot[] {
  const m = new Map<string, Record<string, bigint>>();
  for (const r of rows) {
    const acc = m.get(r.currency) ?? Object.fromEntries(fields.map((f) => [f, zero]));
    for (const f of fields) acc[f] = acc[f]! + big(r[f]);
    m.set(r.currency, acc);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.toString()])) }));
}

const signed = sql`case when t.direction = 'in' then t.amount_minor else -t.amount_minor end`;

/** Per account: opening (validated, before `from`), entrées, sorties in period, closing. */
async function balances(tx: any, q: Q, parishId: string | null) {
  const before = q.from ? sql`t.date < ${q.from}::date` : sql`false`;
  const inPeriod = sql.join([q.from ? sql`t.date >= ${q.from}::date` : sql`true`, q.to ? sql`t.date <= ${q.to}::date` : sql`true`], sql` and `);
  const rows = await tx.execute(sql`
    select a.id, a.name, a.type, a.currency,
      coalesce(sum(case when ${before} then ${signed} else 0 end), 0)::text as opening,
      coalesce(sum(case when ${inPeriod} and t.direction = 'in' then t.amount_minor else 0 end), 0)::text as entrees,
      coalesce(sum(case when ${inPeriod} and t.direction = 'out' then t.amount_minor else 0 end), 0)::text as sorties
    from accounts a left join transactions t on t.account_id = a.id and t.status = 'validee'
      and (${q.to ? sql`t.date <= ${q.to}::date` : sql`true`})
    where ${parishId ? sql`a.parish_id = ${parishId}::uuid` : sql`true`}
      ${q.currency ? sql`and a.currency = ${q.currency}` : sql``} ${q.accountId ? sql`and a.id = ${q.accountId}::uuid` : sql``}
    group by a.id, a.name, a.type, a.currency order by a.type, a.name`);
  return [...rows].map((r: any) => ({
    accountId: r.id as string, account: r.name as string, type: r.type as string, currency: r.currency as string,
    opening: r.opening as string, entrees: r.entrees as string, sorties: r.sorties as string,
    closing: (big(r.opening) + big(r.entrees) - big(r.sorties)).toString(),
  }));
}

const CULTE_FIELDS = ["m_adulte", "m_enfant", "m_bebe", "f_adulte", "f_enfant", "f_bebe"] as const;
const camel = (s: string) => s.replace(/_(\w)/g, (_, x) => x.toUpperCase());

export const reportRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .use(requireReportAccess)

  // Users of the current scope, for the initiateur / validateur filters.
  .get("/users", async (c) => {
    const parishId = c.get("parishId");
    const rows = await run(c, (tx) => tx.execute(sql`
      select distinct u.id, u.full_name from users u join user_parish_roles r on r.user_id = u.id
      where ${parishId ? sql`r.parish_id = ${parishId}::uuid` : sql`true`} order by u.full_name`));
    return c.json([...rows].map((r: any) => ({ id: r.id, fullName: r.full_name })));
  })

  .get("/journal", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const out = await run(c, async (tx) => {
      const rows = [...await tx.execute(sql`
        select t.id, t.date::text as date, t.reference, t.kind, t.direction, t.status, t.currency, t.amount_minor::text as amount,
          t.description, a.name as account, cat.name as category, ue.full_name as entered_by, v1.full_name as validator1, v2.full_name as validator2
        from transactions t join accounts a on a.id = t.account_id left join categories cat on cat.id = t.category_id
          join users ue on ue.id = t.entered_by left join users v1 on v1.id = t.validator1_id left join users v2 on v2.id = t.validator2_id
        where ${txWhere(q, parishId, {})} order by t.date, t.created_at, t.id limit 5000`)] as any[];
      // Opening = validated balance before `from`, honouring only the account / currency filters.
      const opening = q.from ? [...await tx.execute(sql`
        select t.currency, coalesce(sum(${signed}), 0)::text as opening from transactions t
        where t.status = 'validee' and t.date < ${q.from}::date and ${txWhere({ accountId: q.accountId, currency: q.currency } as Q, parishId, {})}
        group by t.currency`)] as any[] : [];
      const items = rows.map((r) => ({
        id: r.id, date: r.date, reference: r.reference, kind: r.kind, account: r.account, category: r.category, description: r.description,
        entree: r.direction === "in" ? r.amount : null, sortie: r.direction === "out" ? r.amount : null,
        currency: r.currency, status: r.status, enteredBy: r.entered_by, validator1: r.validator1, validator2: r.validator2,
      }));
      // Totals and closing balance count validated lines only (same rule as the journal balance).
      const val = rows.filter((r) => r.status === "validee").map((r) => ({ currency: r.currency, entrees: r.direction === "in" ? r.amount : "0", sorties: r.direction === "out" ? r.amount : "0" }));
      const cur = new Set<string>([...opening.map((o) => o.currency), ...rows.map((r) => r.currency)]);
      const totals = [...cur].sort().map((currency) => {
        const t = sumBy(val, ["entrees", "sorties"]).find((x) => x.currency === currency) ?? { entrees: "0", sorties: "0" };
        const op = big(opening.find((o) => o.currency === currency)?.opening);
        return { currency, opening: op.toString(), entrees: t.entrees!, sorties: t.sorties!, closing: (op + big(t.entrees) - big(t.sorties)).toString() };
      });
      return { rows: items, totals, meta: { count: items.length, truncated: rows.length >= 5000 } };
    });
    return c.json(out);
  })

  .get("/recettes-par-categorie", zValidator("query", querySchema), (c) => byCategory(c, "recette"))
  .get("/depenses-par-categorie", zValidator("query", querySchema), (c) => byCategory(c, "depense"))

  .get("/soldes-par-compte", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query");
    const rows = await run(c, (tx) => balances(tx, q, c.get("parishId")));
    return c.json({ rows, totals: sumBy(rows, ["opening", "entrees", "sorties", "closing"]), meta: { from: q.from ?? null, to: q.to ?? null } });
  })

  .get("/consolide", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query");
    const acc = await run(c, (tx) => balances(tx, q, c.get("parishId")));
    const groups = new Map<string, any[]>();
    for (const a of acc) { const k = `${a.type}|${a.currency}`; groups.set(k, [...(groups.get(k) ?? []), a]); }
    const rows = [...groups].map(([k, list]) => {
      const [type, currency] = k.split("|") as [string, string];
      return { type, accounts: list.length, ...sumBy(list, ["opening", "entrees", "sorties", "closing"])[0]! };
    });
    return c.json({ rows, totals: sumBy(acc, ["opening", "entrees", "sorties", "closing"]), meta: { from: q.from ?? null, to: q.to ?? null } });
  })

  .get("/transferts", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const legs = await run(c, (tx) => tx.execute(sql`
      select t.transfer_group_id::text as grp, t.kind, t.direction, t.date::text as date, t.status, t.currency, t.amount_minor::text as amount, t.rate_used, a.name as account, a.type as account_type
      from transactions t join accounts a on a.id = t.account_id
      where t.kind in ('transfert', 'change') and t.transfer_group_id is not null and ${parishId ? sql`t.parish_id = ${parishId}::uuid` : sql`true`}
        and t.status ${q.status ? sql`in (${inList(q.status.split(","))})` : sql`<> 'annulee'`}
        and t.transfer_group_id in (select t.transfer_group_id from transactions t where ${txWhere({ ...q, status: undefined }, parishId, { kinds: ["transfert", "change"] })})
      order by t.date, t.transfer_group_id, t.direction desc`));
    const groups = new Map<string, any[]>();
    for (const l of legs as any[]) groups.set(l.grp, [...(groups.get(l.grp) ?? []), l]);
    const rows = [...groups.values()].map((g) => {
      const out = g.find((x) => x.direction === "out"); const inn = g.find((x) => x.direction === "in");
      return {
        group: out?.grp ?? inn?.grp, date: (out ?? inn).date, kind: (out ?? inn).kind, source: out?.account ?? null, destination: inn?.account ?? null,
        currency: out?.currency ?? inn?.currency, amount: out?.amount ?? inn?.amount, receivedCurrency: inn?.currency ?? null, receivedAmount: inn?.amount ?? null,
        rate: (out ?? inn).kind === "change" ? (out ?? inn).rate_used : null,
        // No fee is linked to a transfer group in the schema (fees are separate "frais" dépenses).
        fees: null, status: (out ?? inn).status,
      };
    });
    return c.json({ rows, totals: sumBy(rows, ["amount"]), meta: { count: rows.length } });
  })

  .get("/engagements", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const data = await run(c, async (tx) => {
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
      return [...pledges, ...commits].map((r) => {
        const solde = big(r.engage) - big(r.libere);
        return { id: r.id, nature: r.nature, name: r.name, type: r.type, category: r.category, currency: r.currency, dueDate: r.due_date,
          engage: r.engage, libere: r.libere, nonLibere: (solde > 0n ? solde : zero).toString(), solde: solde.toString() };
      });
    });
    return c.json({ rows: data, totals: sumBy(data, ["engage", "libere", "nonLibere", "solde"]), meta: { count: data.length } });
  })

  .get("/effectifs", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const recs = await run(c, (tx) => tx.execute(sql`
      select id, service_date::text as date, service_type, ${sql.raw(CULTE_FIELDS.join(", "))} from attendance_records
      where ${sql.join([
        parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`,
        q.from ? sql`service_date >= ${q.from}::date` : sql`true`, q.to ? sql`service_date <= ${q.to}::date` : sql`true`,
        q.serviceType ? sql`service_type = ${q.serviceType}` : sql`true`,
      ], sql` and `)} order by service_date, service_type`));
    const days = new Map<string, number>();
    const seen = new Set<string>();
    const rows = (recs as any[]).map((r) => {
      const counts = Object.fromEntries(CULTE_FIELDS.map((f) => [camel(f), Number(r[f])])) as Record<string, number>;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      days.set(r.date, (days.get(r.date) ?? 0) + total);
      return { id: r.id, date: r.date, serviceType: r.service_type, ...counts, total, dayTotal: null as number | null };
    });
    for (const r of rows) if (!seen.has(r.date)) { seen.add(r.date); r.dayTotal = days.get(r.date)!; }
    const keys = [...CULTE_FIELDS.map(camel), "total"];
    const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (r as any)[k], 0)]));
    return c.json({ rows, totals, meta: { count: rows.length, days: [...days].map(([date, total]) => ({ date, total })) } });
  })

  .get("/membres", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const rows = await run(c, (tx) => tx.execute(sql`
      select id, full_name, phone, whatsapp, email, address, home_church, invited_by, created_at::date::text as since from members
      where ${parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`} ${q.q ? sql`and full_name ilike ${"%" + q.q + "%"}` : sql``} order by full_name`));
    return c.json({ rows: [...rows].map((r: any) => ({ id: r.id, fullName: r.full_name, phone: r.phone, whatsapp: r.whatsapp, email: r.email, address: r.address, homeChurch: r.home_church, invitedBy: r.invited_by, since: r.since })), totals: [], meta: { count: rows.length } });
  })

  .get("/ouvriers", zValidator("query", querySchema), async (c) => {
    const q = c.req.valid("query"); const parishId = c.get("parishId");
    const rows = await run(c, (tx) => tx.execute(sql`
      select w.id, w.full_name, w.category, w.phone, w.email, w.whatsapp, w.address, w.basic_teaching_done, w.active, d.name as department
      from workers w left join departments d on d.id = w.department_id
      where ${parishId ? sql`w.parish_id = ${parishId}::uuid` : sql`true`} ${q.category ? sql`and w.category = ${q.category}` : sql``}
      ${q.q ? sql`and w.full_name ilike ${"%" + q.q + "%"}` : sql``} order by w.category, w.full_name`));
    return c.json({ rows: [...rows].map((r: any) => ({ id: r.id, fullName: r.full_name, category: r.category, department: r.department, phone: r.phone, email: r.email, whatsapp: r.whatsapp, address: r.address, basicTeaching: r.basic_teaching_done, active: r.active })), totals: [], meta: { count: rows.length } });
  })

  .get("/dedicaces", zValidator("query", querySchema), (c) => register(c, "child_dedications", "date", "id, date::text as date, child_name, mother_name, father_name, pastor_name, form_completed",
    (r) => ({ id: r.id, date: r.date, childName: r.child_name, motherName: r.mother_name, fatherName: r.father_name, pastorName: r.pastor_name, formCompleted: r.form_completed })))
  .get("/baptemes", zValidator("query", querySchema), (c) => register(c, "baptisms", "date", "id, date::text as date, full_name, place, address, phone, email, whatsapp, pastor_name",
    (r) => ({ id: r.id, date: r.date, fullName: r.full_name, place: r.place, address: r.address, phone: r.phone, email: r.email, whatsapp: r.whatsapp, pastorName: r.pastor_name })))
  .get("/mariages", zValidator("query", querySchema), (c) => register(c, "marriages", "date", "id, date::text as date, husband_name, wife_name, couple_address, phone, pastor_name, blessing_place",
    (r) => ({ id: r.id, date: r.date, husbandName: r.husband_name, wifeName: r.wife_name, coupleAddress: r.couple_address, phone: r.phone, pastorName: r.pastor_name, blessingPlace: r.blessing_place })));

async function register(c: any, table: string, dateCol: string, cols: string, map: (r: any) => Record<string, unknown>) {
  const q = c.req.valid("query") as Q; const parishId = c.get("parishId");
  const rows = await run(c, (tx) => tx.execute(sql`
    select ${sql.raw(cols)} from ${sql.raw(table)} where ${sql.join([
      parishId ? sql`parish_id = ${parishId}::uuid` : sql`true`,
      q.from ? sql`${sql.raw(dateCol)} >= ${q.from}::date` : sql`true`, q.to ? sql`${sql.raw(dateCol)} <= ${q.to}::date` : sql`true`,
    ], sql` and `)} order by ${sql.raw(dateCol)}`));
  return c.json({ rows: [...rows].map(map), totals: [], meta: { count: rows.length } });
}

async function byCategory(c: any, kind: "recette" | "depense") {
  const q = c.req.valid("query") as Q; const parishId = c.get("parishId");
  const rows = await run(c, (tx) => tx.execute(sql`
    select cat.id as category_id, coalesce(cat.name, 'Sans catégorie') as category, cat."group" as grp, t.currency,
      count(*)::int as count, sum(t.amount_minor)::text as total
    from transactions t left join categories cat on cat.id = t.category_id
    where ${txWhere(q, parishId, { kinds: [kind], defaultStatus: ["validee"] })}
    group by cat.id, cat.name, cat."group", t.currency order by t.currency, sum(t.amount_minor) desc`));
  const items = [...rows].map((r: any) => ({ categoryId: r.category_id, category: r.category, group: r.grp, currency: r.currency, count: r.count, total: r.total as string }));
  return c.json({ rows: items, totals: sumBy(items, ["total"]).map((t) => ({ ...t, count: String(items.filter((i) => i.currency === t.currency).reduce((a, i) => a + i.count, 0)) })), meta: { kind, statuses: q.status ?? "validee" } });
}
