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
