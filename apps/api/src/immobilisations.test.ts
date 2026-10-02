import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Immobilisations (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const DAY = "2026-02-01"; // well within the pastDate window used for acquisitionDate

  const call = (as: string, method: string, path: string, body?: unknown, parish = ids.parishA) =>
    app.request(`/api/immobilisations${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [pa] = await sql`insert into parishes (name, code) values ('Immo A', ${"IA" + sfx}) returning id`;
    const [pb] = await sql`insert into parishes (name, code) values ('Immo B', ${"IB" + sfx}) returning id`;
    const [pc] = await sql`insert into parishes (name, code) values ('Immo C', ${"IC" + sfx}) returning id`;
    ids.parishA = pa!.id; ids.parishB = pb!.id; ids.parishC = pc!.id;
    const mk = async (key: string, parish: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${parish}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("admin", ids.parishA!, "administrateur");
    await mk("tresorier", ids.parishA!, "tresorier");
    await mk("pasteur", ids.parishA!, "pasteur");
    await mk("caissier", ids.parishA!, "caissier");
    await mk("auditeur", ids.parishA!, "auditeur");
    await mk("evang", ids.parishA!, "evangelisation");
    await mk("tresorierB", ids.parishB!, "tresorier");
    await mk("tresorierC", ids.parishC!, "tresorier");

    const [acct] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parishA!}, 'caisse', 'CDF', 'Caisse Immo') returning id`;
    ids.acct = acct!.id;
    const cats = await sql`select id, name from categories`;
    ids.dep = cats.find((c: any) => c.name === "Loyer")!.id;
    ids.rec = cats.find((c: any) => c.name === "Offrande ordinaire")!.id;

    const [depTx] = await sql`insert into transactions (parish_id, reference, kind, direction, account_id, category_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by)
      values (${ids.parishA!}, ${`IM-${sfx}-1`}, 'depense', 'out', ${ids.acct!}, ${ids.dep!}, 'CDF', 50000, '2800', 0, ${DAY}, 'validee', ${ids.caissier!}) returning id`;
    ids.depTx = depTx!.id;
    const [recTx] = await sql`insert into transactions (parish_id, reference, kind, direction, account_id, category_id, currency, amount_minor, rate_used, amount_usd_minor, date, status, entered_by)
      values (${ids.parishA!}, ${`IM-${sfx}-2`}, 'recette', 'in', ${ids.acct!}, ${ids.rec!}, 'CDF', 10000, '2800', 0, ${DAY}, 'validee', ${ids.caissier!}) returning id`;
    ids.recTx = recTx!.id;

    await sql.end();
  });

  test("administrateur/tresorier/pasteur can create; caissier/auditeur/evangelisation get 403", async () => {
    for (const as of ["admin", "tresorier", "pasteur"]) {
      const r = await call(as, "POST", "", { type: "mobilier", name: `Chaise ${as}`, acquisitionDate: DAY, currency: "CDF", amountMinor: "50000", usefulLifeYears: 5 });
      expect(r.status).toBe(201);
    }
    for (const as of ["caissier", "auditeur", "evang"]) {
      const r = await call(as, "POST", "", { type: "mobilier", name: "Interdit", acquisitionDate: DAY, currency: "CDF", amountMinor: "50000", usefulLifeYears: 5 });
      expect(r.status).toBe(403);
    }
  });

  // Reading requires transaction.readAll: administrateur/tresorier/pasteur/auditeur have it, caissier and
  // evangelisation do not (per packages/shared/src/permissions.ts, the single source of truth for both
  // API enforcement and the web UI) — so caissier is 403 on read here too, same as evangelisation.
  test("read access follows transaction.readAll, not asset.manage", async () => {
    expect((await call("admin", "GET", "")).status).toBe(200);
    expect((await call("tresorier", "GET", "")).status).toBe(200);
    expect((await call("pasteur", "GET", "")).status).toBe(200);
    expect((await call("auditeur", "GET", "")).status).toBe(200);
    expect((await call("caissier", "GET", "")).status).toBe(403);
    expect((await call("evang", "GET", "")).status).toBe(403);
  });

  test("codes are sequential within a parish and independent between parishes", async () => {
    const r1 = await json(await call("tresorier", "POST", "", { type: "materiel", name: "Ordinateur 1", acquisitionDate: DAY, currency: "CDF", amountMinor: "100000", usefulLifeYears: 3 }));
    const r2 = await json(await call("tresorier", "POST", "", { type: "materiel", name: "Ordinateur 2", acquisitionDate: DAY, currency: "CDF", amountMinor: "100000", usefulLifeYears: 3 }));
    expect(r1.code).toMatch(/^IMMO-\d{3,}$/);
    expect(Number(r2.code.split("-")[1])).toBe(Number(r1.code.split("-")[1]) + 1);
    // A different parish's counter starts independently at 1, regardless of parish A's progress.
    const rb = await json(await call("tresorierB", "POST", "", { type: "materiel", name: "Ordinateur B", acquisitionDate: DAY, currency: "CDF", amountMinor: "100000", usefulLifeYears: 3 }, ids.parishB));
    expect(rb.code).toBe("IMMO-001");
  });

  test("terrain: usefulLifeYears is forced null server-side and the schedule is empty", async () => {
    const created = await json(await call("admin", "POST", "", { type: "terrain", name: "Parcelle", acquisitionDate: DAY, currency: "CDF", amountMinor: "200000", usefulLifeYears: 20 }));
    expect(created.usefulLifeYears).toBeNull();
    const got = await json(await call("admin", "GET", `/${created.id}`));
    expect(got.schedule).toEqual([]);
  });

  test("non-terrain asset without usefulLifeYears is rejected (422)", async () => {
    const r = await call("admin", "POST", "", { type: "mobilier", name: "Sans durée", acquisitionDate: DAY, currency: "CDF", amountMinor: "50000" });
    expect(r.status).toBe(422);
  });

  test("depreciation schedule matches hand-computed values: 50000 / 5 years = 10000/year", async () => {
    const created = await json(await call("admin", "POST", "", { type: "mobilier", name: "Chaises", acquisitionDate: DAY, currency: "CDF", amountMinor: "50000", usefulLifeYears: 5 }));
    const got = await json(await call("admin", "GET", `/${created.id}`));
    expect(got.schedule.map((r: any) => r.annuityMinor)).toEqual(["10000", "10000", "10000", "10000", "10000"]);
    expect(got.schedule.map((r: any) => r.fiscalYear)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(got.schedule[4].accumulatedMinor).toBe("50000");
    expect(got.schedule[4].netBookValueMinor).toBe("0");
  });

  test("transactionId must belong to the same parish and be a dépense", async () => {
    const ok = await call("admin", "POST", "", { type: "materiel", name: "Imprimante", acquisitionDate: DAY, currency: "CDF", amountMinor: "80000", usefulLifeYears: 4, transactionId: ids.depTx });
    expect(ok.status).toBe(201);
    const wrongKind = await call("admin", "POST", "", { type: "materiel", name: "Mauvais type", acquisitionDate: DAY, currency: "CDF", amountMinor: "80000", usefulLifeYears: 4, transactionId: ids.recTx });
    expect(wrongKind.status).toBe(422);
    const notFound = await call("admin", "POST", "", { type: "materiel", name: "Introuvable", acquisitionDate: DAY, currency: "CDF", amountMinor: "80000", usefulLifeYears: 4, transactionId: crypto.randomUUID() });
    expect(notFound.status).toBe(422);
  });

  test("/report aggregates per-currency totals, accumulated depreciation, VNC and the type breakdown", async () => {
    await call("tresorierC", "POST", "", { type: "mobilier", name: "Chaise", acquisitionDate: DAY, currency: "CDF", amountMinor: "50000", usefulLifeYears: 5 }, ids.parishC);
    await call("tresorierC", "POST", "", { type: "terrain", name: "Terrain", acquisitionDate: DAY, currency: "CDF", amountMinor: "200000" }, ids.parishC);
    const rep = await json(await call("tresorierC", "GET", "/report?year=2026", undefined, ids.parishC));
    expect(rep.totalCount).toBe(2);
    expect(rep.totalsByCurrency.find((x: any) => x.currency === "CDF").totalAmountMinor).toBe("250000");
    // Only the mobilier depreciates (year 1 of 5: annuity 10000); the terrain never does.
    expect(rep.accumulatedByCurrency.find((x: any) => x.currency === "CDF").accumulatedMinor).toBe("10000");
    expect(rep.vncByCurrency.find((x: any) => x.currency === "CDF").netBookValueMinor).toBe("240000");
    expect(rep.byType.find((x: any) => x.type === "terrain").count).toBe(1);
    expect(rep.byType.find((x: any) => x.type === "mobilier").totalAmountMinor).toBe("50000");
  });

  test("parish isolation: assets from parish A are invisible from parish B", async () => {
    const list = await json(await call("tresorierB", "GET", "", undefined, ids.parishB));
    expect(list.every((a: any) => a.code !== undefined)).toBe(true);
    expect(list.some((a: any) => a.name === "Chaises")).toBe(false);
  });
});
