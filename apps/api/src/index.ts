import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { createDb } from "@church/db";
import type { AppEnv, Bindings, Deps } from "./env";
import { authenticate } from "./middleware/auth";
import { attachmentRoutes } from "./routes/attachments";
import { bankingRoutes } from "./routes/banking";
import { configRoutes } from "./routes/config";
import { dashboardRoutes } from "./routes/dashboard";
import { engagementRoutes } from "./routes/engagements";
import { transactionRoutes } from "./routes/transactions";
import { sendDigests, sendMonthlyReports } from "./services/cron";
import { devAuthEnabled, consoleMailer } from "./services/dev";
import { cloudflareMailer } from "./services/mailer";
import { users } from "@church/db";
import { eq } from "drizzle-orm";

// bigint money columns serialise as strings in JSON.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

const dbUrl = (env: Bindings) => env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL!;

export function createApp(deps: Deps = {}) {
  const services = createMiddleware<AppEnv>(async (c, next) => {
    c.set("db", (deps.createDb ?? ((e) => createDb(dbUrl(e))))(c.env));
    c.set("mailer", deps.mailer ? deps.mailer(c.env) : devAuthEnabled(c.env) ? consoleMailer : cloudflareMailer(c.env));
    await next();
  });

  const api = new Hono<AppEnv>()
    .use(services)
    .get("/health", (c) => c.json({ ok: true }))
    // Local development only: lists demo users for the login picker (404 unless DEV_AUTH is on).
    .get("/dev/users", async (c) => {
      if (!devAuthEnabled(c.env)) throw new HTTPException(404);
      const rows = await c.get("db").select({ auth0Id: users.auth0Id, fullName: users.fullName, email: users.email }).from(users).where(eq(users.active, true));
      return c.json(rows);
    })
    .use(authenticate(deps))
    .route("/", configRoutes)
    .route("/transactions", transactionRoutes)
    .route("/banking", bankingRoutes)
    .route("/dashboard", dashboardRoutes)
    .route("/engagements", engagementRoutes)
    .route("/attachments", attachmentRoutes);

  const app = new Hono<AppEnv>()
    .route("/api", api)
    .onError((err, c) => {
      if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
      const msg = String((err as any)?.message ?? err);
      // Postgres guard triggers raise readable French messages: surface them as 422.
      if (/Écriture validée|Période clôturée|en ajout seul/.test(msg)) return c.json({ error: msg.replace(/^.*?(Écriture|Période|transaction)/, "$1") }, 422);
      console.error(err);
      // Local development: say what is wrong instead of a generic message.
      if (devAuthEnabled(c.env) && /ECONNREFUSED|CONNECT_TIMEOUT|CONNECTION_CLOSED|Failed query|connect/i.test(msg))
        return c.json({ error: "Base de données inaccessible. Lancez « bun run dev:setup »." }, 503);
      return c.json({ error: "Erreur interne" }, 500);
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;

const app = createApp();
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    const db = createDb(dbUrl(env));
    const mailer = cloudflareMailer(env);
    ctx.waitUntil(event.cron === "0 6 1 * *" ? sendMonthlyReports(db, mailer, env.APP_URL) : sendDigests(db, mailer, env.APP_URL));
  },
};
