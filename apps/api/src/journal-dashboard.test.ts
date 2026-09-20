import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Journal + dashboard (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;
  const entry = (kind: "recette" | "depense", amount: string, date: string, extra: object = {}) => ({
    parishId: ids.parish, kind, accountId: ids.acct, categoryId: kind === "recette" ? ids.recette : ids.depense, date, amountMinor: amount, ...extra,
  });
  const validated = async (kind: "recette" | "depense", amount: string, date: string, extra: object = {}) => {
    const t = await json(await call("caissier", "POST", "/transactions", entry(kind, amount, date, extra)));
    expect(t.id).toBeTruthy();
    await call("caissier", "POST", `/transactions/${t.id}/submit`);
    expect((await call("tresorier", "POST", `/transactions/${t.id}/validate1`)).status).toBe(200);
    expect((await call("pasteur", "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
    return t;
  };
  const journal = async (qs: string) => json(await call("pasteur", "GET", `/transactions/journal?${qs}`));
  const cdf = (s: any[]) => s.find((x) => x.currency === "CDF");

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse J', ${"J" + sfx}) returning id`;
    ids.parish = p!.id;
    for (const role of ["caissier", "tresorier", "pasteur"]) {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${role}-${sfx}`}, ${`${role}-${sfx}@t.org`}, ${`Nom ${role}`}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${p!.id}, ${role})`;
      ids[role] = u!.id;
    }
    const [a] = await sql`insert into accounts (parish_id, type, currency, name) values (${p!.id}, 'caisse', 'CDF', 'Caisse J') returning id`;
    const [b] = await sql`insert into accounts (parish_id, type, currency, name) values (${p!.id}, 'caisse', 'CDF', 'Caisse neg') returning id`;
    ids.acct = a!.id; ids.acct2 = b!.id;
    if (!(await sql`select 1 from exchange_rates limit 1`).length) await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from) values ('2800', '2020-01-01')`;
    const cats = await sql`select id, name from categories`;
    ids.recette = cats.find((c) => c.name === "Offrande ordinaire")!.id;
    ids.depense = cats.find((c) => c.name === "Loyer")!.id;
    await sql.end();
  });

  test("journal: columns, opening/closing, period totals, cancelled rows and transfers", async () => {
    await validated("recette", "100000", "2026-01-05");
    const r2 = await validated("recette", "50000", "2026-02-10", { description: "Culte du dimanche xyzsearch", subCategory: "Dimanche 2" });
    const dep = await validated("depense", "30000", "2026-02-15", { documentNumber: "FAC-77" });
    const draft = await json(await call("caissier", "POST", "/transactions", entry("recette", "7000", "2026-02-20")));
    const cancelled = await json(await call("caissier", "POST", "/transactions", entry("recette", "9000", "2026-02-21")));
    const admin = postgres(ADMIN_URL!, { max: 1 });
    await admin`update transactions set status = 'annulee' where id = ${cancelled.id}`;
    // a validated transfer leg: moves the account balance but is neither recette nor dépense
    await admin`insert into transactions (parish_id, reference, kind, direction, account_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by)
      values (${ids.parish!}, ${"T-" + sfx}, 'transfert', 'out', ${ids.acct!}, 'CDF', 1000, '2800', 0, '2026-02-18', 'validee', ${ids.caissier!})`;
    await admin.end();

    const j = await journal("from=2026-02-01&to=2026-02-28");
    const s = cdf(j.summary);
    expect(s).toMatchObject({ opening: "100000", in: "50000", out: "31000", recettes: "50000", depenses: "30000", closing: "119000" });
    const row = j.rows.find((x: any) => x.id === r2.id);
    expect(row).toMatchObject({ accountName: "Caisse J", categoryName: "Offrande ordinaire", subCategory: "Dimanche 2", enteredByName: "Nom caissier",
      validator1Name: "Nom tresorier", validator2Name: "Nom pasteur", runningBalance: "150000", amountMinor: "50000" });
    expect(row.createdAt).toBeTruthy(); expect(row.validator1At).toBeTruthy(); expect(row.validator2At).toBeTruthy();
    expect(row.documentNumber).toBe(row.reference); // mixed default: generated when blank
    expect(j.rows.find((x: any) => x.id === dep.id).documentNumber).toBe("FAC-77");
    const can = j.rows.find((x: any) => x.id === cancelled.id);
    expect(can.status).toBe("annulee");
    expect(can.runningBalance).toBe(j.rows.find((x: any) => x.id === draft.id).runningBalance); // neither moves the balance

    // filters
    expect((await journal("from=2026-02-01&to=2026-02-28&kind=depense")).rows.map((x: any) => x.id)).toEqual([dep.id]);
    expect((await journal("q=XYZSEARCH")).rows.map((x: any) => x.id)).toEqual([r2.id]);
    expect((await journal("q=FAC-77")).rows.map((x: any) => x.id)).toEqual([dep.id]);
    expect((await journal("q=" + encodeURIComponent("%"))).rows.length).toBe(0); // wildcard is escaped
    expect((await journal("status=annulee")).rows.map((x: any) => x.id)).toEqual([cancelled.id]);
    const byVal = await journal(`validatorId=${ids.tresorier}`);
    expect(byVal.rows.length).toBe(3);
    expect((await journal(`enteredBy=${ids.pasteur}`)).rows.length).toBe(0);
    expect((await journal("currency=USD")).rows.length).toBe(0);
    ids.dep = dep.id;
    const people = await json(await call("pasteur", "GET", "/transactions/people"));
    expect(people.length).toBeGreaterThanOrEqual(3);
    expect(people.find((p: any) => p.id === ids.caissier).initiator).toBe(true);
    expect(people.find((p: any) => p.id === ids.tresorier).validator).toBe(true);
  });

  test("dashboard totals equal journal totals for the same filters (transfers excluded)", async () => {
    for (const [from, to] of [["2026-02-01", "2026-02-28"], ["2026-01-01", "2026-12-31"], ["2026-01-06", "2026-02-12"]]) {
      const j = cdf((await journal(`from=${from}&to=${to}`)).summary);
      const dash = await json(await call("pasteur", "GET", `/dashboard?from=${from}&to=${to}&currency=CDF`));
      const t = cdf(dash.totals);
      expect(t.recettes).toBe(j.recettes);
      expect(t.depenses).toBe(j.depenses);
      const bal = dash.balances.find((b: any) => b.id === ids.acct);
      expect(bal.balance).toBe(j.closing);
      expect(dash.byCategory.filter((x: any) => x.kind === "recette").reduce((a: bigint, x: any) => a + BigInt(x.total), 0n).toString()).toBe(j.recettes);
    }
    const usd = await json(await call("pasteur", "GET", "/dashboard?from=2026-01-01&to=2026-12-31&currency=USD"));
    expect(usd.totals).toEqual([]);
  });

  test("negative balance alerts honour the setting; engagements engagé / libéré / non libéré", async () => {
    const admin = postgres(ADMIN_URL!, { max: 1 });
    await admin`insert into transactions (parish_id, reference, kind, direction, account_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by)
      values (${ids.parish!}, ${"N-" + sfx}, 'depense', 'out', ${ids.acct2!}, 'CDF', 500, '2800', 0, '2026-02-01', 'validee', ${ids.caissier!})`;
    const [p] = await admin`insert into pledges (parish_id, category_id, currency, amount_minor, type) values (${ids.parish!}, ${ids.recette!}, 'CDF', 1000, 'construction') returning id`;
    await admin`insert into engagement_releases (parish_id, pledge_id, date, currency, amount_minor, created_by) values (${ids.parish!}, ${p!.id}, '2026-02-02', 'CDF', 400, ${ids.caissier!})`;

    let dash = await json(await call("pasteur", "GET", "/dashboard?from=2026-01-01&to=2026-12-31"));
    expect(dash.negativeAlerts.map((b: any) => b.id)).toEqual([ids.acct2]);
    expect(dash.engagements.pledges.find((e: any) => e.type === "construction")).toMatchObject({ currency: "CDF", engaged: "1000", released: "400", remaining: "600" });

    await admin`insert into settings (parish_id, key, value) values (${ids.parish!}, 'negative_balance_alert', '{"enabled": false}'::jsonb)`;
    dash = await json(await call("pasteur", "GET", "/dashboard?from=2026-01-01&to=2026-12-31"));
    expect(dash.negativeAlerts).toEqual([]);
    await admin.end();
  });

  test("subCategory + commitmentId persisted; commitment rules; piece number modes; balance endpoint", async () => {
    const admin = postgres(ADMIN_URL!, { max: 1 });
    const [m] = await admin`insert into commitments (parish_id, category_id, payee, currency, amount_minor) values (${ids.parish!}, ${ids.depense!}, 'Bailleur', 'CDF', 500) returning id`;
    const [closed] = await admin`insert into commitments (parish_id, category_id, payee, currency, amount_minor, status) values (${ids.parish!}, ${ids.depense!}, 'Payé', 'CDF', 500, 'paid') returning id`;
    const t = await json(await call("caissier", "POST", "/transactions", entry("depense", "100", "2026-03-01", { subCategory: "Loyer mars", commitmentId: m!.id })));
    expect(t).toMatchObject({ subCategory: "Loyer mars", commitmentId: m!.id });
    const detail = await json(await call("caissier", "GET", `/transactions/${t.id}`));
    expect(detail).toMatchObject({ subCategory: "Loyer mars", commitmentId: m!.id, enteredByName: "Nom caissier", validator1Name: null });
    expect((await call("caissier", "POST", "/transactions", entry("depense", "100", "2026-03-01", { commitmentId: closed!.id }))).status).toBe(422);
    expect((await call("caissier", "POST", "/transactions", entry("recette", "100", "2026-03-01", { commitmentId: m!.id }))).status).toBe(422);
    const p = await json(await call("caissier", "PATCH", `/transactions/${t.id}`, { subCategory: "Autre" }));
    expect(p.subCategory).toBe("Autre");

    const bal = await json(await call("caissier", "GET", `/transactions/balance?accountId=${ids.acct}`));
    expect(bal).toMatchObject({ currency: "CDF", balance: "119000" });
    expect((await json(await call("caissier", "GET", "/transactions/config"))).pieceNumberMode).toBe("mixed");

    await admin`insert into settings (parish_id, key, value) values (${ids.parish!}, 'piece_number_mode', '"manual"'::jsonb)`;
    expect((await call("caissier", "POST", "/transactions", entry("recette", "100", "2026-03-01"))).status).toBe(422);
    expect((await call("caissier", "POST", "/transactions", entry("recette", "100", "2026-03-01", { documentNumber: "P-1" }))).status).toBe(201);
    await admin`update settings set value = '"auto"'::jsonb where parish_id = ${ids.parish!} and key = 'piece_number_mode'`;
    const a = await json(await call("caissier", "POST", "/transactions", entry("recette", "100", "2026-03-01", { documentNumber: "ignored" })));
    expect(a.documentNumber).toBe(a.reference);
    await admin.end();
  });
});
