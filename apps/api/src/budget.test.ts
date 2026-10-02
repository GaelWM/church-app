import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("Budget: lignes de dépenses, investissements, suivi & écarts (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const YEAR = new Date().getFullYear(); // transaction dates must be real past dates, so the budget year tracks "now"

  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${as}-${sfx}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;

  // Full workflow so rate_used / amount_usd_minor are computed by the real service (never hand-rolled).
  const validated = async (kind: "recette" | "depense", accountId: string, categoryId: string, amount: string, date: string, extra: object = {}) => {
    const t = await json(await call("caissier", "POST", "/transactions", { parishId: ids.parish, kind, accountId, categoryId, date, amountMinor: amount, ...extra }));
    expect(t.id).toBeTruthy();
    await call("caissier", "POST", `/transactions/${t.id}/submit`);
    expect((await call("tresorier", "POST", `/transactions/${t.id}/validate1`)).status).toBe(200);
    expect((await call("pasteur", "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
    return t;
  };
  const draft = async (kind: "recette" | "depense", accountId: string, categoryId: string, amount: string, date: string, extra: object = {}) => {
    const t = await json(await call("caissier", "POST", "/transactions", { parishId: ids.parish, kind, accountId, categoryId, date, amountMinor: amount, ...extra }));
    expect(t.id).toBeTruthy();
    return t;
  };

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse Budget', ${"BU" + sfx}) returning id`;
    ids.parish = p!.id;
    const mk = async (key: string, role: string) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${`${key}-${sfx}`}, ${`${key}-${sfx}@t.org`}, ${`Nom ${key}`}) returning id`;
      await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${ids.parish!}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("caissier", "caissier");
    await mk("tresorier", "tresorier");
    await mk("pasteur", "pasteur");
    await mk("auditeur", "auditeur");
    await mk("evang", "evangelisation");

    const [cdf] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parish!}, 'caisse', 'CDF', 'Caisse Budget CDF') returning id`;
    const [usd] = await sql`insert into accounts (parish_id, type, currency, name) values (${ids.parish!}, 'caisse', 'USD', 'Caisse Budget USD') returning id`;
    ids.acctCdf = cdf!.id; ids.acctUsd = usd!.id;

    if (!(await sql`select 1 from exchange_rates limit 1`).length) await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from) values ('2800', '2020-01-01')`;

    const cats = await sql`select id, name, kind from categories`;
    ids.catLoyer = cats.find((c) => c.name === "Loyer" && c.kind === "depense")!.id; // group "Locaux et charges"
    ids.catEau = cats.find((c) => c.name === "Eau" && c.kind === "depense")!.id;
    ids.catRecette = cats.find((c) => c.name === "Offrande ordinaire" && c.kind === "recette")!.id;
    const [inactive] = await sql`insert into categories (kind, name, "group", active) values ('depense', ${"Catégorie inactive " + sfx}, 'Divers', false) returning id`;
    ids.catInactive = inactive!.id;
    await sql.end();
  });

  test("fund the caisses (a dépense can only validate up to the account's balance)", async () => {
    await validated("recette", ids.acctCdf!, ids.catRecette!, "20000000", `${YEAR}-01-01`);
    await validated("recette", ids.acctUsd!, ids.catRecette!, "100000", `${YEAR}-01-01`);
  });

  test("tresorier/pasteur can create+read budget lines; caissier/auditeur/evangelisation are rejected on writes", async () => {
    const asTresorier = await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catLoyer, period: "annuel", currency: "CDF", amountMinor: "1000000" });
    expect(asTresorier.status).toBe(201);
    const line = await json(asTresorier);
    ids.lineLoyer = line.id;

    const asPasteur = await call("pasteur", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "annuel", currency: "CDF", amountMinor: "200000" });
    expect(asPasteur.status).toBe(201);
    ids.lineEau = (await json(asPasteur)).id;

    for (const as of ["caissier", "auditeur", "evang"]) {
      expect((await call(as, "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catLoyer, period: "annuel", currency: "USD", amountMinor: "100" })).status).toBe(403);
      expect((await call(as, "PATCH", `/budget/expenses/${ids.lineLoyer}`, { amountMinor: "1" })).status).toBe(403);
      expect((await call(as, "DELETE", `/budget/expenses/${ids.lineLoyer}`)).status).toBe(403);
    }

    // Read gate: transaction.readAll only (tresorier, pasteur, auditeur, administrateur) -- caissier and evangelisation lack it.
    expect((await call("auditeur", "GET", `/budget/expenses?year=${YEAR}`)).status).toBe(200);
    expect((await call("tresorier", "GET", `/budget/expenses?year=${YEAR}`)).status).toBe(200);
    expect((await call("caissier", "GET", `/budget/expenses?year=${YEAR}`)).status).toBe(403);
    expect((await call("evang", "GET", `/budget/expenses?year=${YEAR}`)).status).toBe(403);
    expect((await call("caissier", "GET", `/budget/investments?year=${YEAR}`)).status).toBe(403);
    expect((await call("caissier", "GET", `/budget/summary?year=${YEAR}`)).status).toBe(403);

    // The one exception: a caissier filling the dépense entry form can read the investment options list.
    expect((await call("caissier", "GET", "/budget/investments/options")).status).toBe(200);
    expect((await call("evang", "GET", "/budget/investments/options")).status).toBe(403); // no transaction.create nor transaction.readAll
  });

  test("category must be a depense category and must be active", async () => {
    expect((await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catRecette, period: "annuel", currency: "CDF", amountMinor: "100" })).status).toBe(422);
    expect((await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catInactive, period: "annuel", currency: "CDF", amountMinor: "100" })).status).toBe(422);
  });

  test("periodIndex must be consistent with period (zod-level validation)", async () => {
    expect((await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "trimestriel", periodIndex: 0, currency: "USD", amountMinor: "100" })).status).toBe(400);
    expect((await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "mensuel", periodIndex: 13, currency: "USD", amountMinor: "100" })).status).toBe(400);
    expect((await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "annuel", periodIndex: 1, currency: "USD", amountMinor: "100" })).status).toBe(400);
  });

  test("mixing period granularity for the same category/year/currency is rejected, but a different currency is fine", async () => {
    const annuel = await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "annuel", currency: "USD", amountMinor: "100" });
    expect(annuel.status).toBe(201);
    const mixed = await call("tresorier", "POST", "/budget/expenses", { year: YEAR, categoryId: ids.catEau, period: "mensuel", periodIndex: 3, currency: "USD", amountMinor: "50" });
    expect(mixed.status).toBe(422);
    // CDF already uses "annuel" for this category (ids.lineEau) -- adding another CDF annuel line (different periodIndex N/A) still has to match "annuel".
    const sameGranularity = await call("tresorier", "POST", "/budget/expenses", { year: YEAR + 1, categoryId: ids.catEau, period: "annuel", currency: "CDF", amountMinor: "10" });
    expect(sameGranularity.status).toBe(201); // different year => different key, always allowed
  });

  test("Réalisé sums only validated dépenses in the line's category/period, excludes investment-linked spend, converts currency via the transaction's own rate", async () => {
    // Loyer line: annuel, CDF, planned 1 000 000 (10 000,00 CDF)
    const inv = await json(await call("tresorier", "POST", "/budget/investments", { year: YEAR, name: "Projet exclu du budget dépenses", currency: "CDF", amountMinor: "999999" }));
    ids.invForExclusion = inv.id;

    await validated("depense", ids.acctCdf!, ids.catLoyer!, "300000", `${YEAR}-02-01`); // +300000 CDF
    await validated("depense", ids.acctUsd!, ids.catLoyer!, "100", `${YEAR}-03-01`); // 1,00 USD * 2800 = +280000 CDF
    await validated("depense", ids.acctCdf!, ids.catLoyer!, "999999", `${YEAR}-04-01`, { investmentId: ids.invForExclusion }); // excluded: investment-linked
    await draft("depense", ids.acctCdf!, ids.catLoyer!, "123456", `${YEAR}-05-01`); // excluded: not validated
    await validated("depense", ids.acctCdf!, ids.catEau!, "111111", `${YEAR}-02-01`); // excluded: different category
    await validated("depense", ids.acctCdf!, ids.catLoyer!, "777777", `${YEAR - 5}-02-01`); // excluded: outside the line's year

    const rows = await json(await call("tresorier", "GET", `/budget/expenses?year=${YEAR}`));
    const line = rows.find((r: any) => r.id === ids.lineLoyer);
    expect(line.realizedMinor).toBe("580000");
    expect(line.amountMinor).toBe("1000000");
    expect(line.varianceMinor).toBe("420000");
    expect(line.overBudget).toBe(false);
    expect(line.consumptionBp).toBe(5800); // 58.00%
  });

  test("deleting an investment with linked transactions 409s; investment realized/balance are computed correctly", async () => {
    const inv = await json(await call("tresorier", "POST", "/budget/investments", { year: YEAR, name: "Achat véhicule", type: "vehicule", currency: "CDF", amountMinor: "500000" }));
    ids.invVehicule = inv.id;

    await validated("depense", ids.acctCdf!, ids.catLoyer!, "200000", `${YEAR}-06-01`, { investmentId: inv.id });

    const del = await call("tresorier", "DELETE", `/budget/investments/${inv.id}`);
    expect(del.status).toBe(409);

    const rows = await json(await call("pasteur", "GET", `/budget/investments?year=${YEAR}`));
    const row = rows.find((r: any) => r.id === inv.id);
    expect(row.realizedMinor).toBe("200000");
    expect(row.balanceMinor).toBe("300000");

    const txs = await json(await call("pasteur", "GET", `/budget/investments/${inv.id}/transactions`));
    expect(txs.length).toBe(1);
    expect(txs[0].amountMinor).toBe("200000");
    expect(txs[0].currency).toBe("CDF");
  });

  test("investments/options lists active investments only, visible to a caissier filling the dépense form", async () => {
    const inactive = await json(await call("tresorier", "POST", "/budget/investments", { year: YEAR, name: "Projet désactivé", currency: "CDF", amountMinor: "1", active: false }));
    const opts = await json(await call("caissier", "GET", "/budget/investments/options"));
    expect(opts.some((o: any) => o.id === ids.invVehicule)).toBe(true);
    expect(opts.some((o: any) => o.id === inactive.id)).toBe(false);
  });

  test("Suivi & Écarts summary aggregates expenses + investments per currency", async () => {
    const rows = await json(await call("pasteur", "GET", `/budget/summary?year=${YEAR}`));
    const cdf = rows.find((r: any) => r.currency === "CDF");
    expect(cdf).toBeTruthy();
    expect(BigInt(cdf.expenses.planned)).toBeGreaterThan(0n);
    expect(BigInt(cdf.investments.planned)).toBeGreaterThan(0n);
    expect(cdf.total.planned).toBe((BigInt(cdf.expenses.planned) + BigInt(cdf.investments.planned)).toString());
    expect(cdf.total.realized).toBe((BigInt(cdf.expenses.realized) + BigInt(cdf.investments.realized)).toString());
    const expectedBp = BigInt(cdf.total.planned) > 0n ? Number((BigInt(cdf.total.realized) * 10000n) / BigInt(cdf.total.planned)) : null;
    expect(cdf.consumptionBp).toBe(expectedBp);
  });

  test("update (PATCH) and delete an expense line", async () => {
    const upd = await call("tresorier", "PATCH", `/budget/expenses/${ids.lineEau}`, { observation: "révisé" });
    expect(upd.status).toBe(200);
    expect((await json(upd)).observation).toBe("révisé");
    expect((await call("tresorier", "DELETE", `/budget/expenses/${ids.lineEau}`)).status).toBe(200);
    const rows = await json(await call("tresorier", "GET", `/budget/expenses?year=${YEAR}`));
    expect(rows.some((r: any) => r.id === ids.lineEau)).toBe(false);
  });
});
