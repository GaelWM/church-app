import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb, withScope } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL; // superuser: fixtures only
const APP_URL = process.env.TEST_APP_DATABASE_URL; // non-superuser: what the API uses (RLS applies)
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("API end to end (real Postgres, RLS + triggers)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const mailer = memoryMailer();
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => mailer });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};

  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Paroisse A', ${"A" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Paroisse B', ${"B" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("caissier", ids.parishA!, "caissier"); await mk("tresorier", ids.parishA!, "tresorier");
    await mk("pasteur", ids.parishA!, "pasteur"); await mk("admin", ids.parishA!, "administrateur");
    await mk("caissierB", ids.parishB!, "caissier");
    const [acct] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parishA!}, 'caisse', 'CDF', 'Caisse CDF') returning id`;
    const [bank] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parishA!}, 'banque', 'CDF', 'Banque CDF') returning id`;
    const [acct2] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parishA!}, 'caisse', 'CDF', 'Caisse batch') returning id`;
    ids.acct = acct!.id; ids.bank = bank!.id; ids.acctBatch = acct2!.id;
    await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from) values ('2800', '2020-01-01')`;
    const cats = await sql`select id, kind, name from categories`;
    ids.recette = cats.find((c) => c.name === "Offrande ordinaire")!.id;
    ids.depense = cats.find((c) => c.name === "Loyer")!.id;
    await sql.end();
    // tokens are auth0 ids
    for (const k of ["caissier", "tresorier", "pasteur", "admin", "caissierB"]) ids[`tok_${k}`] = `${k}-${sfx}`;
  });

  const entry = (kind: "recette" | "depense", amount: string, date = "2026-03-10") => ({
    parishId: ids.parishA, kind, accountId: ids.acct, categoryId: kind === "recette" ? ids.recette : ids.depense, date, amountMinor: amount,
  });

  test("unknown Auth0 user gets 403; missing token 401", async () => {
    expect((await call("nobody", "GET", "/me")).status).toBe(403);
    const r = await app.request("/api/me", {}, env);
    expect(r.status).toBe(401);
  });

  test("full validation flow: enter → submit → validate1 → validate2 counts in balance", async () => {
    const r = await call(ids.tok_caissier!, "POST", "/transactions", entry("recette", "1000000"));
    expect(r.status).toBe(201);
    const t = await json(r);
    expect(t.status).toBe("brouillon");
    expect(t.reference).toMatch(/^A.+-2026-000001$/);
    expect(t.amountUsdMinor).toBe("357"); // 10 000,00 CDF / 2800 = 3,57 USD
    ids.tx1 = t.id;

    expect((await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/validate1`)).status).toBe(403); // perm
    expect((await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/validate1`)).status).toBe(422); // still a draft
    expect((await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`)).status).toBe(200);
    expect((await call(ids.tok_pasteur!, "POST", `/transactions/${t.id}/validate2`)).status).toBe(422); // wrong state
    expect((await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/validate1`)).status).toBe(200);

    let dash = await json(await call(ids.tok_pasteur!, "GET", "/dashboard"));
    expect(dash.balances.find((b: any) => b.id === ids.acct).balance).toBe("0"); // not yet counted
    expect((await call(ids.tok_pasteur!, "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
    dash = await json(await call(ids.tok_pasteur!, "GET", "/dashboard"));
    expect(dash.balances.find((b: any) => b.id === ids.acct).balance).toBe("1000000");
  });

  test("validated rows are frozen by the database trigger", async () => {
    const sql = postgres(APP_URL!, { max: 1 });
    try {
      const scoped = (q: (tx: any) => Promise<unknown>) => sql.begin(async (tx) => {
        await tx`select set_config('app.parish_ids', ${ids.parishA!}, true)`;
        return q(tx);
      });
      await expect(scoped((tx) => tx`update transactions set description = 'x' where id = ${ids.tx1!}`)).rejects.toThrow(/validée/);
      await expect(scoped((tx) => tx`delete from transactions where id = ${ids.tx1!}`)).rejects.toThrow(/validée/);
    } finally {
      await sql.end();
    }
    expect((await call(ids.tok_caissier!, "PATCH", `/transactions/${ids.tx1}`, { description: "x" })).status).toBe(422);
  });

  test("overdraft: dépense above balance cannot be validated", async () => {
    const t = await json(await call(ids.tok_caissier!, "POST", "/transactions", entry("depense", "5000000")));
    await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`);
    await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/validate1`);
    const r = await call(ids.tok_pasteur!, "POST", `/transactions/${t.id}/validate2`);
    expect(r.status).toBe(422);
    expect((await json(r)).error).toMatch(/Solde insuffisant/);
  });

  test("rejection needs a reason, emails the author, and allows resubmission", async () => {
    const t = await json(await call(ids.tok_caissier!, "POST", "/transactions", entry("recette", "50000")));
    await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`);
    expect((await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/reject`, { comment: "" })).status).toBe(400);
    expect((await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/reject`, { comment: "Montant erroné" })).status).toBe(200);
    expect(mailer.sent.some((m) => m.to === `caissier-${sfx}@t.org` && m.html.includes("Montant erroné"))).toBe(true);
    expect((await call(ids.tok_caissier!, "PATCH", `/transactions/${t.id}`, { amountMinor: "60000" })).status).toBe(200);
    expect((await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`)).status).toBe(200);
    const detail = await json(await call(ids.tok_caissier!, "GET", `/transactions/${t.id}`));
    expect(detail.events.map((e: any) => e.toStatus)).toEqual(["brouillon", "soumise", "rejetee", "soumise"]);
  });

  test("batch actions: validate several entries at once and reject with a reason", async () => {
    const mk = async (amount: string) => {
      // separate account so balances asserted by other tests are unaffected
      const t = await json(await call(ids.tok_caissier!, "POST", "/transactions", { ...entry("recette", amount, "2026-06-02"), accountId: ids.acctBatch }));
      await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`);
      return t.id as string;
    };
    const [a, b, c] = [await mk("1000"), await mk("2000"), await mk("3000")];
    let r = await call(ids.tok_tresorier!, "POST", "/transactions/batch/validate1", { ids: [a, b, c] });
    expect(r.status).toBe(200);
    expect((await json(r)).results.every((x: any) => x.ok)).toBe(true);
    r = await call(ids.tok_pasteur!, "POST", "/transactions/batch/reject", { ids: [c], comment: "Doublon" });
    expect(r.status).toBe(200);
    expect((await json(r)).results[0].ok).toBe(true);
    r = await call(ids.tok_pasteur!, "POST", "/transactions/batch/validate2", { ids: [a, b, c] });
    const results = (await json(r)).results as Array<{ id: string; ok: boolean }>;
    expect(results.filter((x) => x.ok).map((x) => x.id).sort()).toEqual([a, b].sort()); // c was rejected
    expect((await call(ids.tok_caissier!, "POST", "/transactions/batch/validate1", { ids: [a] })).status).toBe(403);
    const rejected = await json(await call(ids.tok_caissier!, "GET", `/transactions/${c}`));
    expect(rejected.status).toBe("rejetee");
  });

  test("administrateur is read-only on money", async () => {
    expect((await call(ids.tok_admin!, "POST", "/transactions", entry("recette", "100"))).status).toBe(403);
    expect((await call(ids.tok_admin!, "GET", "/transactions")).status).toBe(200);
  });

  test("parish isolation: API scope and database RLS", async () => {
    expect((await call(ids.tok_caissierB!, "GET", "/transactions", undefined, ids.parishA)).status).toBe(403);
    const db = createDb(APP_URL!);
    const seenByB = await withScope(db, { userId: ids.caissierB!, parishIds: [ids.parishB!] }, (tx) => tx.execute(`select id from transactions` as any));
    expect([...seenByB].length).toBe(0);
    const seenByA = await withScope(db, { userId: ids.caissier!, parishIds: [ids.parishA!] }, (tx) => tx.execute(`select id from transactions` as any));
    expect([...seenByA].length).toBeGreaterThan(0);
  });

  test("reversal (contre-passation) links to the original and nets to zero once validated", async () => {
    const r = await call(ids.tok_caissier!, "POST", `/transactions/${ids.tx1}/reverse`, { comment: "Doublon" });
    expect(r.status).toBe(201);
    const rev = await json(r);
    expect(rev.direction).toBe("out");
    expect(rev.reversesId).toBe(ids.tx1);
    expect((await call(ids.tok_caissier!, "POST", `/transactions/${ids.tx1}/reverse`, { comment: "again" })).status).toBe(422);
    await call(ids.tok_caissier!, "POST", `/transactions/${rev.id}/submit`);
    await call(ids.tok_tresorier!, "POST", `/transactions/${rev.id}/validate1`);
    await call(ids.tok_pasteur!, "POST", `/transactions/${rev.id}/validate2`);
    const dash = await json(await call(ids.tok_pasteur!, "GET", "/dashboard"));
    expect(dash.balances.find((b: any) => b.id === ids.acct).balance).toBe("0");
  });

  test("versement moves money between accounts as two linked lines, validated together", async () => {
    // fund the caisse first
    const t = await json(await call(ids.tok_caissier!, "POST", "/transactions", entry("recette", "300000", "2026-04-02")));
    for (const [who, a] of [["caissier", "submit"], ["tresorier", "validate1"], ["pasteur", "validate2"]] as const)
      await call(ids[`tok_${who}`]!, "POST", `/transactions/${t.id}/${a}`);
    const r = await call(ids.tok_caissier!, "POST", "/banking/operations", { type: "versement", fromAccountId: ids.acct, toAccountId: ids.bank, date: "2026-04-03", amountMinor: "200000" });
    expect(r.status).toBe(201);
    const [out] = await json(r);
    for (const [who, a] of [["caissier", "submit"], ["tresorier", "validate1"], ["pasteur", "validate2"]] as const)
      expect((await call(ids[`tok_${who}`]!, "POST", `/transactions/${out.id}/${a}`)).status).toBe(200);
    const dash = await json(await call(ids.tok_pasteur!, "GET", "/dashboard"));
    expect(dash.balances.find((b: any) => b.id === ids.acct).balance).toBe("100000");
    expect(dash.balances.find((b: any) => b.id === ids.bank).balance).toBe("200000");
    // transfers never count as recettes/dépenses
    expect(dash.monthly.every((m: any) => ["recette", "depense"].includes(m.kind))).toBe(true);
  });

  test("closed period blocks new entries; close refused while entries pending", async () => {
    const t = await json(await call(ids.tok_caissier!, "POST", "/transactions", entry("recette", "1000", "2026-05-05")));
    expect((await call(ids.tok_pasteur!, "POST", "/banking/periods/close", { year: 2026, month: 5 })).status).toBe(422);
    await call(ids.tok_caissier!, "POST", `/transactions/${t.id}/submit`);
    await call(ids.tok_tresorier!, "POST", `/transactions/${t.id}/validate1`);
    await call(ids.tok_pasteur!, "POST", `/transactions/${t.id}/validate2`);
    expect((await call(ids.tok_pasteur!, "POST", "/banking/periods/close", { year: 2026, month: 5 })).status).toBe(200);
    const r = await call(ids.tok_caissier!, "POST", "/transactions", entry("recette", "1000", "2026-05-20"));
    expect(r.status).toBe(422);
    expect((await json(r)).error).toMatch(/clôturée/);
  });

  test("audit log shows who did what by name; global entries are visible to administrators only", async () => {
    const name = `Catégorie ${sfx}`;
    expect((await call(ids.tok_admin!, "POST", "/categories", { kind: "recette", name })).status).toBe(201);
    const adminRows = await json(await call(ids.tok_admin!, "GET", "/audit"));
    const created = adminRows.find((a: any) => a.action === "category.create" && a.after?.name === name);
    expect(created).toBeTruthy(); // global entry (no parish) is visible to the admin
    expect(created.actorName).toBe("admin");
    expect(created.actorEmail).toBe(`admin-${sfx}@t.org`);
    const tx = adminRows.find((a: any) => a.action === "transaction.validate2");
    expect(["tresorier", "pasteur"]).toContain(tx.actorName); // parish entries carry names too
    const pastorRows = await json(await call(ids.tok_pasteur!, "GET", "/audit"));
    expect(pastorRows.some((a: any) => a.action === "category.create" && a.after?.name === name)).toBe(false);
    expect(pastorRows.every((a: any) => a.actorName)).toBe(true);
  });

  test("audit log records actions and is append-only", async () => {
    const rows = await json(await call(ids.tok_admin!, "GET", "/audit"));
    expect(rows.some((a: any) => a.action === "transaction.validate2")).toBe(true);
    expect((await call(ids.tok_caissier!, "GET", "/audit")).status).toBe(403);
    const sql = postgres(APP_URL!, { max: 1 });
    try {
      await expect(Promise.resolve(sql`delete from audit_log`)).rejects.toThrow(/ajout seul/);
    } finally {
      await sql.end();
    }
  });
});
