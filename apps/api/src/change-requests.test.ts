import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "@church/db";
import { createApp } from "./index";
import { memoryMailer } from "./services/mailer";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const d = ADMIN_URL && APP_URL ? describe : describe.skip;

d("§27 change requests (real Postgres)", () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const sharedDb = APP_URL ? createDb(APP_URL) : (undefined as never);
  const app = createApp({ verifyToken: async (t) => ({ sub: t }), createDb: () => sharedDb, mailer: () => memoryMailer() });
  afterAll(async () => { await (sharedDb as any).$client?.end(); });
  const env = { APP_URL: "http://app", MAIL_FROM: "x@x", KV: {}, FILES: {}, EMAIL: {} } as any;
  const ids: Record<string, string> = {};
  const tok = (k: string) => `${k}-${sfx}`;
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method, headers: { authorization: `Bearer ${tok(as)}`, "content-type": "application/json", "x-parish-id": ids.parish! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const json = async (r: Response) => r.json() as Promise<any>;

  beforeAll(async () => {
    const sql = postgres(ADMIN_URL!);
    const [p] = await sql`insert into parishes (name, code) values ('Paroisse CR', ${"CR" + sfx}) returning id`;
    ids.parish = p!.id;
    const mk = async (key: string, ...roles: string[]) => {
      const [u] = await sql`insert into users (auth0_id, email, full_name) values (${tok(key)}, ${`${key}-${sfx}@t.org`}, ${key}) returning id`;
      for (const role of roles) await sql`insert into user_parish_roles (user_id, parish_id, role) values (${u!.id}, ${p!.id}, ${role})`;
      ids[key] = u!.id;
    };
    await mk("caissier", "caissier"); await mk("tresorier", "tresorier"); await mk("pasteur", "pasteur");
    await mk("auditeur", "auditeur"); await mk("dual", "caissier", "tresorier"); // fixture only: bypasses the role-conflict rule
    const [a] = await sql`insert into accounts (parish_id, type, currency, name) values (${p!.id}, 'caisse', 'CDF', 'Caisse CR') returning id`;
    ids.acct = a!.id;
    await sql`insert into exchange_rates (rate_cdf_per_usd, effective_from) values ('2800', '2020-01-01') on conflict do nothing`;
    const cats = await sql`select id, name from categories`;
    ids.recette = cats.find((c) => c.name === "Offrande ordinaire")!.id;
    await sql.end();
  });

  const validated = async (amount = "100000") => {
    const t = await json(await call("caissier", "POST", "/transactions", {
      parishId: ids.parish, kind: "recette", accountId: ids.acct, categoryId: ids.recette, date: "2026-03-10", amountMinor: amount, description: "Original",
    }));
    await call("caissier", "POST", `/transactions/${t.id}/submit`);
    await call("tresorier", "POST", `/transactions/${t.id}/validate1`);
    expect((await call("pasteur", "POST", `/transactions/${t.id}/validate2`)).status).toBe(200);
    return t.id as string;
  };
  const balance = async () => (await json(await call("pasteur", "GET", "/dashboard"))).balances.find((b: any) => b.id === ids.acct).balance;

  test("annulation: caissier requests, trésorier then pasteur approve, entry becomes annulée and leaves the balance", async () => {
    const txId = await validated("100000");
    const before = BigInt(await balance());
    expect((await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "abc" })).status).toBe(400); // motif trop court
    const r = await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Saisie en double" });
    expect(r.status).toBe(201);
    const req = await json(r);
    expect(req.reference).toMatch(/^DEM-CR.+-\d{4}-000001$/);
    expect(req.status).toBe("en_attente_tresorier");
    // double request refused
    expect((await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Encore une fois" })).status).toBe(422);
    // requester / wrong roles cannot approve
    expect((await call("caissier", "POST", `/change-requests/${req.id}/approve1`, {})).status).toBe(403);
    expect((await call("pasteur", "POST", `/change-requests/${req.id}/approve2`, {})).status).toBe(422); // N1 first
    expect((await call("tresorier", "POST", `/change-requests/${req.id}/approve1`)).status).toBe(200);
    expect(await balance()).toBe(before.toString()); // nothing executed yet
    const done = await json(await call("pasteur", "POST", `/change-requests/${req.id}/approve2`, {}));
    expect(done.status).toBe("executee");
    expect(done.tresorierName).toBe("tresorier"); expect(done.pasteurName).toBe("pasteur"); expect(done.requesterName).toBe("caissier");
    expect((await json(await call("pasteur", "GET", `/transactions/${txId}`))).status).toBe("annulee");
    expect(await balance()).toBe((before - 100000n).toString());
    // history
    const detail = await json(await call("pasteur", "GET", `/change-requests/${req.id}`));
    expect(detail.events.map((e: any) => e.toStatus)).toEqual(["en_attente_tresorier", "approuvee_n1", "approuvee_n2", "executee"]);
    expect(detail.events.every((e: any) => e.actorName && e.at)).toBe(true);
    // no new request on an annulled entry
    expect((await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Déjà annulée" })).status).toBe(422);
    // audit rows
    const sql = postgres(ADMIN_URL!);
    try {
      const rows = await sql`select action from audit_log where entity_id in (${req.id}, ${txId}) order by at`;
      const actions = rows.map((x) => x.action);
      for (const a of ["change_request.create", "change_request.approve1", "change_request.approve2", "change_request.execute", "transaction.cancel"]) expect(actions).toContain(a);
    } finally { await sql.end(); }
  });

  test("rejection: stays in history, entry untouched; needs a comment", async () => {
    const txId = await validated();
    const req = await json(await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Erreur présumée" }));
    expect((await call("tresorier", "POST", `/change-requests/${req.id}/reject`, { comment: "" })).status).toBe(400);
    const rej = await json(await call("tresorier", "POST", `/change-requests/${req.id}/reject`, { comment: "Non justifié" }));
    expect(rej.status).toBe("rejetee");
    expect((await json(await call("pasteur", "GET", `/transactions/${txId}`))).status).toBe("validee");
    const list = await json(await call("auditeur", "GET", "/change-requests?status=rejetee"));
    expect(list.some((x: any) => x.id === req.id && x.requesterName === "caissier")).toBe(true);
    // a new request is possible once the previous one is closed
    expect((await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Nouvelle demande" })).status).toBe(201);
  });

  test("requester cannot approve their own request", async () => {
    const txId = await validated();
    const req = await json(await call("dual", "POST", "/change-requests", { transactionId: txId, kind: "annulation", reason: "Demande du dual" }));
    const r = await call("dual", "POST", `/change-requests/${req.id}/approve1`, {});
    expect(r.status).toBe(422);
    expect((await json(r)).error).toMatch(/propre demande/);
  });

  test("modification keeps old and new values, applies only after both approvals", async () => {
    const txId = await validated();
    const bad = await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "modification", reason: "Montant faux", changes: { amountMinor: "5" } });
    expect(bad.status).toBe(400); // amounts are not modifiable
    const req = await json(await call("caissier", "POST", "/change-requests", { transactionId: txId, kind: "modification", reason: "Libellé imprécis", changes: { description: "Corrigé", beneficiary: "Jean" } }));
    expect(req.oldValues).toEqual({ description: "Original", beneficiary: null });
    expect(req.proposedChanges).toEqual({ description: "Corrigé", beneficiary: "Jean" });
    await call("tresorier", "POST", `/change-requests/${req.id}/approve1`, {});
    expect((await json(await call("pasteur", "GET", `/transactions/${txId}`))).description).toBe("Original");
    expect((await json(await call("pasteur", "GET", "/change-requests?status=approuvee_n1"))).some((x: any) => x.id === req.id)).toBe(true);
    expect((await call("pasteur", "POST", `/change-requests/${req.id}/approve2`, {})).status).toBe(200);
    const t = await json(await call("pasteur", "GET", `/transactions/${txId}`));
    expect(t.description).toBe("Corrigé"); expect(t.beneficiary).toBe("Jean"); expect(t.status).toBe("validee");
  });

  test("only validated entries; scoped reads; change_requests cannot be deleted", async () => {
    const t = await json(await call("caissier", "POST", "/transactions", { parishId: ids.parish, kind: "recette", accountId: ids.acct, categoryId: ids.recette, date: "2026-03-10", amountMinor: "1000" }));
    expect((await call("caissier", "POST", "/change-requests", { transactionId: t.id, kind: "annulation", reason: "Brouillon" })).status).toBe(422);
    expect((await call("caissier", "GET", "/change-requests?mine=1")).status).toBe(200);
    const sql = postgres(ADMIN_URL!);
    try {
      await expect(Promise.resolve(sql`delete from change_requests`)).rejects.toThrow(/ajout seul/);
    } finally { await sql.end(); }
  });
});
