/** Demo data for local development only (idempotent). Users log in via the dev picker. */
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { requireDatabaseUrl } from "./env";
import { accounts, departments, exchangeRates, members, parishes, userParishRoles, users } from "./schema";

const db = createDb(requireDatabaseUrl());
let [p] = await db.select().from(parishes).where(eq(parishes.code, "KIN01"));
if (!p) [p] = await db.insert(parishes).values({ name: "Paroisse Centrale (démo)", code: "KIN01", city: "Kinshasa" }).returning();

const demo = [
  ["administrateur", "Alice Administrateur"], ["caissier", "Claude Caissier"],
  ["tresorier", "Thérèse Trésorière"], ["pasteur", "Paul Pasteur"],
] as const;
for (const [role, fullName] of demo) {
  const auth0Id = `dev|${role}`;
  let [u] = await db.select().from(users).where(eq(users.auth0Id, auth0Id));
  if (!u) {
    [u] = await db.insert(users).values({ auth0Id, email: `${role}@demo.local`, fullName }).returning();
    await db.insert(userParishRoles).values({ userId: u!.id, parishId: p!.id, role, consolidatedAccess: role === "pasteur" });
  }
}
if (!(await db.select().from(accounts).where(eq(accounts.parishId, p!.id))).length) {
  await db.insert(accounts).values([
    { parishId: p!.id, type: "caisse", currency: "CDF", name: "Caisse CDF" },
    { parishId: p!.id, type: "caisse", currency: "USD", name: "Caisse USD" },
    { parishId: p!.id, type: "banque", currency: "USD", name: "Banque USD", bankName: "Rawbank", number: "0001-234" },
    { parishId: p!.id, type: "mobile_money", currency: "CDF", name: "M-Pesa", bankName: "Vodacom" },
  ]);
  await db.insert(departments).values([{ parishId: p!.id, name: "Jeunesse" }, { parishId: p!.id, name: "Mamans" }, { parishId: p!.id, name: "Chorale" }]);
  await db.insert(members).values([{ parishId: p!.id, fullName: "Marie Kabila" }, { parishId: p!.id, fullName: "Jean Mbuyi" }]);
}
if (!(await db.select().from(exchangeRates)).length) await db.insert(exchangeRates).values({ rateCdfPerUsd: "2800", effectiveFrom: "2020-01-01" });
console.log("Demo data ready (parish KIN01; users dev|administrateur, dev|caissier, dev|tresorier, dev|pasteur)");
process.exit(0);
