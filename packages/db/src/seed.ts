import { createDb } from "./client";
import { requireDatabaseUrl } from "./env";
import { categories, funds } from "./schema";
import { BANK_CATEGORIES, DEPENSE_CATEGORIES, RECETTE_CATEGORIES } from "./seed-data";

const db = createDb(requireDatabaseUrl());
const [construction] = await db.insert(funds).values({ name: "Construction", description: "Achat parcelle et construction" })
  .onConflictDoNothing().returning();
const fundId = construction?.id ?? (await db.select().from(funds))[0]?.id;

const rows = [
  ...RECETTE_CATEGORIES.map((name) => ({
    kind: "recette", name,
    fundId: name === "Achat parcelle et construction" ? fundId : null,
    requiresDepartment: name === "Offrande activités département",
  })),
  ...Object.entries(DEPENSE_CATEGORIES).flatMap(([group, names]) => names.map((name) => ({ kind: "depense", name, group }))),
  ...BANK_CATEGORIES.map((name) => ({ kind: "banque", name })),
];
await db.insert(categories).values(rows).onConflictDoNothing();
console.log(`Seeded ${rows.length} categories`);
process.exit(0);
