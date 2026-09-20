import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";
import { checkNegativeBalances } from "./services/alerts";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Engagements, releases, settings, role audit", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const mailer = memoryMailer();
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => mailer });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;
  const tok = (k: string) => `${k}-${sfx}`;

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse E', ${"E" + sfx}) returning id`;
    ids.parish = p!.id;
    for (const [key, role] of [["caissier", "caissier"], ["tresorier", "tresorier"], ["pasteur", "pasteur"], ["admin", "administrateur"], ["cible", "caissier"]] as const) {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${tok(key)}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${p!.id}, ${role})`;
      ids[key] = u!.id;
    }
    const [a] = await sql`insert into accounts (parish_id, type, currency, name) values (${p!.id}, 'caisse', 'CDF', 'Caisse E') returning id`;
    ids.acct = a!.id;
    await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from) values ('2800', '2020-01-01')`;
    const cats = await sql`select id, name from categories`;
    ids.recette = cats.find((c) => c.name === "Offrande ordinaire")!.id;
    ids.depense = cats.find((c) => c.name === "Loyer")!.id;
    await sql.end();
  });

  const fund = async (amount: string) => {
    const t = await json(await call(tok("caissier"), "POST", "/transactions", { parishId: ids.parish, kind: "recette", accountId: ids.acct, categoryId: ids.recette, date: "2026-03-10", amountMinor: amount }));
    await call(tok("caissier"), "POST", `/transactions/${t.id}/submit`);
    await call(tok("tresorier"), "POST", `/transactions/${t.id}/validate1`);
    expect((await call(tok("pasteur"), "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
  };

  test("pledge/commitment carry type; manual release reduces solde", async () => {
    const p = await json(await call(tok("caissier"), "POST", "/engagements/pledges", { donorName: "Frère X", categoryId: ids.recette, currency: "CDF", amountMinor: "100000", type: "construction", beneficiary: "Chantier" }));
    expect(p.type).toBe("construction"); expect(p.beneficiary).toBe("Chantier");
    const r = await call(tok("caissier"), "POST", `/engagements/pledges/${p.id}/releases`, { date: "2026-03-11", amountMinor: "30000", note: "acompte" });
    expect(r.status).toBe(201);
    expect((await call(tok("caissier"), "POST", `/engagements/pledges/${p.id}/releases`, { date: "2026-03-11", amountMinor: "0" })).status).toBe(400);
    const list = await json(await call(tok("caissier"), "GET", "/engagements/pledges"));
    const row = list.find((x: any) => x.id === p.id);
    expect(row.releasedMinor).toBe("30000"); expect(row.remainingMinor).toBe("70000");
    expect((await json(await call(tok("caissier"), "GET", `/engagements/pledges/${p.id}/releases`))).length).toBe(1);
    const sum = await json(await call(tok("caissier"), "GET", "/engagements/summary"));
    expect(sum.pledges.find((x: any) => x.type === "construction" && x.currency === "CDF")).toMatchObject({ engagedMinor: "100000", releasedMinor: "30000", remainingMinor: "70000" });
  });

  test("validated recette linked to a pledge auto-creates a release (idempotent)", async () => {
    const p = await json(await call(tok("caissier"), "POST", "/engagements/pledges", { donorName: "Sœur Y", categoryId: ids.recette, currency: "CDF", amountMinor: "50000", type: "partenariat" }));
    const t = await json(await call(tok("caissier"), "POST", "/transactions", { parishId: ids.parish, kind: "recette", accountId: ids.acct, categoryId: ids.recette, date: "2026-03-12", amountMinor: "20000", pledgeId: p.id }));
    await call(tok("caissier"), "POST", `/transactions/${t.id}/submit`);
    await call(tok("tresorier"), "POST", `/transactions/${t.id}/validate1`);
    expect((await call(tok("pasteur"), "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
    const rels = await json(await call(tok("caissier"), "GET", `/engagements/pledges/${p.id}/releases`));
    expect(rels.length).toBe(1); expect(rels[0].transactionId).toBe(t.id); expect(rels[0].amountMinor).toBe("20000");
    // linking the same transaction manually is refused
    const dup = await call(tok("caissier"), "POST", `/engagements/pledges/${p.id}/releases`, { date: "2026-03-12", amountMinor: "20000", transactionId: t.id });
    expect(dup.status).toBe(409);
  });

  test("validated expense linked to a commitment auto-creates a release and marks it paid", async () => {
    await fund("1000000");
    const cm = await json(await call(tok("caissier"), "POST", "/engagements/commitments", { payee: "Entreprise Z", categoryId: ids.depense, currency: "CDF", amountMinor: "300000", type: "construction" }));
    expect(cm.type).toBe("construction");
    // the transactions API does not (yet) accept commitmentId: create the linked draft directly (superuser fixture).
    const sql = postgres(ADMIN_URL!);
    const [t] = await sql`insert into transactions (parish_id, reference, kind, direction, account_id, category_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by, commitment_id)
      values (${ids.parish!}, ${"E" + sfx + "-CM-1"}, 'depense', 'out', ${ids.acct!}, ${ids.depense!}, 'CDF', 300000, '2800', 107, '2026-03-15', 'soumise', ${ids.caissier!}, ${cm.id}) returning id`;
    await sql.end();
    await call(tok("tresorier"), "POST", `/transactions/${t!.id}/validate1`);
    expect((await call(tok("pasteur"), "POST", `/transactions/${t!.id}/validate2`)).status).toBe(200);
    const rels = await json(await call(tok("caissier"), "GET", `/engagements/commitments/${cm.id}/releases`));
    expect(rels.length).toBe(1); expect(rels[0].accountId).toBe(ids.acct);
    const row = (await json(await call(tok("caissier"), "GET", "/engagements/commitments"))).find((x: any) => x.id === cm.id);
    expect(row.status).toBe("paid"); expect(row.remainingMinor).toBe("0");
  });

  test("partial release keeps commitment open", async () => {
    const cm = await json(await call(tok("caissier"), "POST", "/engagements/commitments", { payee: "W", categoryId: ids.depense, currency: "CDF", amountMinor: "1000" }));
    await call(tok("caissier"), "POST", `/engagements/commitments/${cm.id}/releases`, { date: "2026-03-15", amountMinor: "400" });
    let row = (await json(await call(tok("caissier"), "GET", "/engagements/commitments"))).find((x: any) => x.id === cm.id);
    expect(row.status).toBe("open");
    await call(tok("caissier"), "POST", `/engagements/commitments/${cm.id}/releases`, { date: "2026-03-16", amountMinor: "600" });
    row = (await json(await call(tok("caissier"), "GET", "/engagements/commitments"))).find((x: any) => x.id === cm.id);
    expect(row.status).toBe("paid");
  });

  test("settings: defaults, admin-only write, validation, audit before/after", async () => {
    const g = await json(await call(tok("caissier"), "GET", "/settings"));
    expect(g).toMatchObject({ default_currency: "CDF", piece_number_mode: "mixed", closure_rule: "mensuelle", negative_balance_alert: { enabled: true, threshold_minor: "0" }, alert_recipients: { roles: ["tresorier", "pasteur"], extra_emails: [] } });
    expect((await call(tok("tresorier"), "PUT", "/settings", { default_currency: "USD" })).status).toBe(403);
    expect((await call(tok("admin"), "PUT", "/settings", { bogus: 1 })).status).toBe(400);
    expect((await call(tok("admin"), "PUT", "/settings", { default_currency: "EUR" })).status).toBe(400);
    expect((await call(tok("admin"), "PUT", "/settings", { negative_balance_alert: { enabled: true, threshold_minor: "abc" } })).status).toBe(400);
    const ok = await call(tok("admin"), "PUT", "/settings", { default_currency: "USD", closure_rule: "les deux" });
    expect(ok.status).toBe(200);
    const g2 = await json(await call(tok("caissier"), "GET", "/settings"));
    expect(g2.default_currency).toBe("USD"); expect(g2.closure_rule).toBe("les deux"); expect(g2.piece_number_mode).toBe("mixed");
    const sql = postgres(ADMIN_URL!);
    const [a] = await sql`select before, after, actor_id from audit_log where action = 'settings.update' and parish_id = ${ids.parish!} order by at desc limit 1`;
    await sql.end();
    expect(a!.before.default_currency).toBe("CDF"); expect(a!.after.default_currency).toBe("USD"); expect(a!.actor_id).toBe(ids.admin);
  });

  test("negative balance alert emails the configured recipients", async () => {
    await call(tok("admin"), "PUT", "/settings", { negative_balance_alert: { enabled: true, threshold_minor: "999999999" }, alert_recipients: { roles: ["tresorier"], extra_emails: ["extra@t.org"] } });
    mailer.sent.length = 0;
    await checkNegativeBalances(sharedDb, mailer, "http://app");
    const to = mailer.sent.map((m) => m.to);
    expect(to).toContain(`tresorier-${sfx}@t.org`); expect(to).toContain("extra@t.org"); expect(to).not.toContain(`pasteur-${sfx}@t.org`);
    await call(tok("admin"), "PUT", "/settings", { negative_balance_alert: { enabled: false, threshold_minor: "0" } });
    mailer.sent.length = 0;
    await checkNegativeBalances(sharedDb, mailer, "http://app");
    expect(mailer.sent.filter((m) => m.to === "extra@t.org").length).toBe(0);
  });

  test("role change audit has before, after and the admin actor", async () => {
    const r = await call(tok("admin"), "PUT", `/users/${ids.cible!}/roles`, { roles: [{ parishId: ids.parish, role: "tresorier", consolidatedAccess: false }] });
    expect(r.status).toBe(200);
    const sql = postgres(ADMIN_URL!);
    const [a] = await sql`select before, after, actor_id from audit_log where action = 'user.roles' and entity_id = ${ids.cible!} order by at desc limit 1`;
    await sql.end();
    expect(a!.actor_id).toBe(ids.admin);
    expect(a!.before.map((x: any) => x.role)).toEqual(["caissier"]);
    expect(a!.after.map((x: any) => x.role)).toEqual(["tresorier"]);
  });
});
