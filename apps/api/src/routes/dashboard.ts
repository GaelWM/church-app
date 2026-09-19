import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../env";
import { parishScope } from "../middleware/auth";
import { run } from "../services/run";
import { inList } from "../services/sql";

export const dashboardRoutes = new Hono<AppEnv>()
  .use(parishScope)
  .get("/", async (c) => {
    // Validated only by default; ?provisional=1 includes pending entries (labelled "provisoire" in the UI).
    const provisional = c.req.query("provisional") === "1";
    const statuses = provisional ? ["validee", "soumise", "validee1"] : ["validee"];
    const from = c.req.query("from") ?? new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
    const pid = c.get("parishId");
    const scope = pid ? sql`and t.parish_id = ${pid}::uuid` : sql``;
    const roles = c.get("roles");

    return c.json(await run(c, async (tx) => {
      const q = async (s: any) => [...(await tx.execute(s))] as any[];

      const balances = await q(sql`
        select a.id, a.name, a.type, a.currency, a.parish_id,
          coalesce(sum(case when t.direction='in' then t.amount_minor else -t.amount_minor end),0)::text as balance
        from accounts a left join transactions t on t.account_id = a.id and t.status in (${inList(statuses)}) 
        where a.active ${pid ? sql`and a.parish_id = ${pid}::uuid` : sql``}
        group by a.id order by a.parish_id, a.name`);

      // Recettes vs dépenses by month, per currency plus USD equivalent at each entry's own rate.
      const monthly = await q(sql`
        select to_char(date_trunc('month', t.date),'YYYY-MM') as month, t.kind, t.currency,
          sum(t.amount_minor)::text as total, sum(t.amount_usd_minor)::text as total_usd
        from transactions t where t.kind in ('recette','depense') and t.status in (${inList(statuses)})
          and t.date between ${from}::date and ${to}::date ${scope}
        group by 1,2,3 order by 1`);

      const topCategories = await q(sql`
        select c.name, t.kind, sum(t.amount_usd_minor)::text as total_usd,
          sum(case when t.date >= (${to}::date - (${to}::date - ${from}::date)/2) then t.amount_usd_minor else 0 end)::text as recent_half_usd,
          sum(case when t.date <  (${to}::date - (${to}::date - ${from}::date)/2) then t.amount_usd_minor else 0 end)::text as previous_half_usd
        from transactions t join categories c on c.id = t.category_id
        where t.kind in ('recette','depense') and t.status in (${inList(statuses)}) and t.date between ${from}::date and ${to}::date ${scope}
        group by c.name, t.kind order by sum(t.amount_usd_minor) desc limit 10`);

      const [pending] = await q(sql`
        select count(*) filter (where t.status='soumise')::int as awaiting_first,
               count(*) filter (where t.status='validee1')::int as awaiting_second
        from transactions t where true ${scope}`);

      const pledges = await q(sql`
        select p.id, p.donor_name, p.currency, p.amount_minor::text as promised, p.due_date,
          coalesce((select sum(t.amount_minor) from transactions t where t.pledge_id = p.id and t.status='validee'),0)::text as received
        from pledges p where true ${pid ? sql`and p.parish_id = ${pid}::uuid` : sql``}`);

      const obligations = await q(sql`
        select id, payee, currency, amount_minor::text as amount, due_date from commitments
        where status = 'open' ${pid ? sql`and parish_id = ${pid}::uuid` : sql``} order by due_date nulls last limit 20`);

      const attendance = await q(sql`
        select a.service_date, a.service_type, (a.hommes+a.femmes+a.jeunes+a.enfants+a.visiteurs) as total,
          (select coalesce(sum(t.amount_usd_minor),0)::text from transactions t join categories c on c.id=t.category_id
            where t.parish_id = a.parish_id and t.date = a.service_date and t.kind='recette' and t.status in (${inList(statuses)}) and c.name like 'Offrande%') as offering_usd
        from attendance_records a where a.status = 'validee' and a.service_date between ${from}::date and ${to}::date
          ${pid ? sql`and a.parish_id = ${pid}::uuid` : sql``} order by a.service_date`);

      return { provisional, from, to, balances, monthly, topCategories, pending, pledges, obligations, attendance, roles };
    }));
  });
