import net from "node:net";

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
  Bun.spawn(["bunx", "wrangler", "dev", "--port", "8787"], { cwd: "apps/api", stdout: "inherit", stderr: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }),
  Bun.spawn(["bun", "run", "dev:local"], { cwd: "apps/web", stdout: "inherit", stderr: "inherit" }),
];
console.log("\n→ Open http://localhost:5173 (NOT :8787) and pick a demo user\n");
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop); process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
