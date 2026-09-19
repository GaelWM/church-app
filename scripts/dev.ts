import net from "node:net";
import { existsSync, readFileSync } from "node:fs";

const auth0Mode = process.argv.includes("--auth0");
if (auth0Mode) {
  const env = existsSync("apps/web/.env.local") ? readFileSync("apps/web/.env.local", "utf8") : "";
  const missing = ["VITE_AUTH0_DOMAIN", "VITE_AUTH0_CLIENT_ID", "VITE_AUTH0_AUDIENCE"].filter((k) => !new RegExp(`^${k}=.+`, "m").test(env));
  if (missing.length) {
    console.error(`\n✖ apps/web/.env.local is missing: ${missing.join(", ")} (see apps/web/.env.example)\n`);
    process.exit(1);
  }
}

// Preflight: fail early with a clear message instead of a bare 500 from the API.
const reachable = (port: number) => new Promise<boolean>((resolve) => {
  const sock = net.connect({ port, host: "127.0.0.1" }, () => { sock.destroy(); resolve(true); });
  sock.on("error", () => resolve(false));
  sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
});
if (!(await reachable(54320))) {
  console.error("\n✖ The local database is not running (port 54320). Run: bun run dev:setup\n");
  process.exit(1);
}
for (const [port, what] of [[8787, "API (wrangler)"], [5173, "web (vite)"]] as const) {
  if (await reachable(port)) {
    console.error(`\n✖ Port ${port} is already in use — is the ${what} already running? Stop it first (e.g. pkill -f workerd; pkill -f vite).\n`);
    process.exit(1);
  }
}

// Runs API (wrangler dev on :8787) and web (vite on :5173, proxies /api) together.
const procs = [
  // --auth0 also turns the dev login OFF, so user creation/blocking really calls the Auth0 Management API.
  Bun.spawn(["bunx", "wrangler", "dev", "--port", "8787", ...(auth0Mode ? ["--var", "DEV_AUTH:0"] : [])], { cwd: "apps/api", stdout: "inherit", stderr: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }),
  // --auth0: real Auth0 Universal Login (no demo-user picker); default: local demo users, no Auth0 needed.
  Bun.spawn(["bun", "run", auth0Mode ? "dev" : "dev:local"], { cwd: "apps/web", stdout: "inherit", stderr: "inherit" }),
];
console.log(auth0Mode ? "\n→ Open http://localhost:5173 (NOT :8787) — you will be sent to Auth0 to log in\n" : "\n→ Open http://localhost:5173 (NOT :8787) and pick a demo user\n");
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop); process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
