import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Rapports (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const get = async (as: string, path: string, parish = ids.parishA) => {
    const r = await app.request(`/api/reports${path}`, { headers: { authorization: `Bearer ${as}-${sfx}`, "x-parish-id": parish! } }, env);
    return { status: r.status, body: (await r.json()) as any };
  };

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Rapport A', ${"RA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Rapport B', ${"RB" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("caissier", ids.parishA!, "caissier"); await mk("tresorier", ids.parishA!, "tresorier"); await mk("tresorierB", ids.parishB!, "tresorier");
    const acc = async (parish: string, type: string, name: string) => (await sql`insert into accounts (parish_id, type, currency, name) values (${parish}, ${type}, 'CDF', ${name}) returning id`)[0]!.id as string;
    ids.caisse = await acc(ids.parishA!, "caisse", "Caisse R"); ids.banque = await acc(ids.parishA!, "banque", "Banque R"); ids.caisseB = await acc(ids.parishB!, "caisse", "Caisse RB");
    const cats = await sql`select id, kind, name from categories`;
    ids.rec = cats.find((c) => c.name === "Offrande ordinaire")!.id; ids.dep = cats.find((c) => c.name === "Loyer")!.id;
    let n = 0;
    const tx = (parish: string, account: string, kind: string, dir: string, amount: number, date: string, status = "validee", cat: string | null = null, group: string | null = null) =>
      sql`insert into transactions (parish_id, reference, kind, direction, account_id, category_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by, transfer_group_id)
          values (${parish}, ${`R-${sfx}-${n++}`}, ${kind}, ${dir}, ${account}, ${cat}, 'CDF', ${amount}, '2800', 0, ${date}, ${status}, ${ids.caissier!}, ${group})`;
    await tx(ids.parishA!, ids.caisse, "recette", "in", 100000, "2026-01-10", "validee", ids.rec);
    await tx(ids.parishA!, ids.caisse, "recette", "in", 50000, "2026-02-10", "validee", ids.rec);
    await tx(ids.parishA!, ids.caisse, "recette", "in", 7000, "2026-02-11", "annulee", ids.rec);
    await tx(ids.parishA!, ids.caisse, "recette", "in", 9000, "2026-02-12", "brouillon", ids.rec);
    await tx(ids.parishA!, ids.caisse, "depense", "out", 20000, "2026-02-15", "validee", ids.dep);
    const grp = crypto.randomUUID();
    await tx(ids.parishA!, ids.caisse, "transfert", "out", 30000, "2026-02-20", "validee", null, grp);
    await tx(ids.parishA!, ids.banque, "transfert", "in", 30000, "2026-02-20", "validee", null, grp);
    await tx(ids.parishB!, ids.caisseB, "recette", "in", 999999, "2026-02-10", "validee", ids.rec);
    await sql`insert into attendance_records (parish_id, service_date, service_type, m_adulte, m_enfant, m_bebe, f_adulte, f_enfant, f_bebe, entered_by)
      values (${ids.parishA!}, '2026-03-01', '1er culte', 10, 2, 1, 12, 3, 2, ${ids.caissier!}), (${ids.parishA!}, '2026-03-01', '2e culte', 5, 0, 0, 5, 0, 0, ${ids.caissier!})`;
    await sql.end();
  });

  test("recettes par catégorie: only validated recettes, no transfers, annulled excluded", async () => {
    const r = await get("tresorier", "/recettes-par-categorie");
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual([{ currency: "CDF", total: "150000", count: "2" }]);
    const dep = await get("tresorier", "/depenses-par-categorie");
    expect(dep.body.totals[0].total).toBe("20000");
    const annul = await get("tresorier", "/recettes-par-categorie?status=annulee");
    expect(annul.body.totals[0].total).toBe("7000");
  });

  test("soldes par compte: opening + in - out = closing; consolidé = somme des comptes", async () => {
    const r = await get("tresorier", "/soldes-par-compte?from=2026-02-01&to=2026-02-28");
    const caisse = r.body.rows.find((x: any) => x.account === "Caisse R");
    expect(caisse.opening).toBe("100000");
    expect(BigInt(caisse.opening) + BigInt(caisse.entrees) - BigInt(caisse.sorties)).toBe(BigInt(caisse.closing));
    expect(caisse.closing).toBe("100000");
    const banque = r.body.rows.find((x: any) => x.account === "Banque R");
    expect(banque.closing).toBe("30000");
    const c = await get("tresorier", "/consolide?from=2026-02-01&to=2026-02-28");
    const sum = r.body.rows.reduce((a: bigint, x: any) => a + BigInt(x.closing), 0n);
    expect(c.body.totals[0].closing).toBe(sum.toString());
    expect(c.body.rows.reduce((a: bigint, x: any) => a + BigInt(x.closing), 0n)).toBe(sum);
  });

  test("journal: opening, totals, closing", async () => {
    const r = await get("tresorier", "/journal?from=2026-02-01&to=2026-02-28&accountId=" + ids.caisse);
    expect(r.body.totals[0]).toEqual({ currency: "CDF", opening: "100000", entrees: "50000", sorties: "50000", closing: "100000" });
    expect(r.body.rows.length).toBe(5); // includes annulée / brouillon lines, listed but not counted
  });

  test("transferts grouped by transfer group", async () => {
    const r = await get("tresorier", "/transferts");
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0]).toMatchObject({ source: "Caisse R", destination: "Banque R", amount: "30000" });
  });

  test("effectifs totals", async () => {
    const r = await get("tresorier", "/effectifs?from=2026-03-01&to=2026-03-31");
    expect(r.body.rows.length).toBe(2);
    expect(r.body.rows[0].total).toBe(30);
    expect(r.body.rows[0].dayTotal).toBe(40);
    expect(r.body.rows[1].dayTotal).toBeNull();
    expect(r.body.totals.total).toBe(40);
  });

  test("caissier forbidden; parish isolation", async () => {
    expect((await get("caissier", "/journal")).status).toBe(403);
    const b = await get("tresorierB", "/recettes-par-categorie", ids.parishB);
    expect(b.body.totals[0].total).toBe("999999");
    expect((await get("tresorierB", "/recettes-par-categorie", ids.parishA)).status).toBeGreaterThanOrEqual(400);
  });
});
