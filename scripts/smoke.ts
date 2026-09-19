/**
 * Post-deploy smoke test:  bun run smoke <base-url> [--local]
 * --local  skips the checks that only make sense for a deployed environment (dev login must be OFF there).
 */
const args = process.argv.slice(2);
const local = args.includes("--local");
const base = (args.find((a) => !a.startsWith("--")) ?? "").replace(/\/$/, "");
if (!base) { console.error("usage: bun run smoke <base-url> [--local]"); process.exit(2); }

let failed = 0;
const check = async (name: string, fn: () => Promise<string | true>) => {
  try {
    const r = await fn();
    console.log(r === true ? `PASS ${name}` : `FAIL ${name}: ${r}`);
    if (r !== true) failed++;
  } catch (e) { console.log(`FAIL ${name}: ${(e as Error).message}`); failed++; }
};
const get = (path: string, init?: RequestInit) => fetch(base + path, { redirect: "manual", ...init });

await check("API health", async () => { const r = await get("/api/health"); return r.status === 200 || `HTTP ${r.status}`; });
await check("API ready (database reachable, RLS not bypassable)", async () => {
  const r = await get("/api/health/ready");
  return r.status === 200 || `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
});
await check("unauthenticated request is rejected (401)", async () => { const r = await get("/api/me"); return r.status === 401 || `HTTP ${r.status}`; });
await check("bogus token is rejected (401)", async () => {
  const r = await get("/api/me", { headers: { authorization: "Bearer not-a-jwt" } });
  return r.status === 401 || `HTTP ${r.status}`;
});
await check("API responses are not cacheable", async () => {
  const r = await get("/api/health");
  return /no-store/.test(r.headers.get("cache-control") ?? "") || `cache-control: ${r.headers.get("cache-control")}`;
});
await check("SPA served at /", async () => {
  const r = await get("/");
  return (r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html")) || `HTTP ${r.status}`;
});
await check("SPA deep link falls back to index.html", async () => {
  const r = await get("/recettes");
  return (r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html")) || `HTTP ${r.status}`;
});
await check("security headers on the app shell", async () => {
  const h = (await get("/")).headers;
  const missing = ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"].filter((k) => !h.get(k));
  return missing.length === 0 || `missing: ${missing.join(", ")}`;
});
if (!local) {
  await check("dev login endpoint is OFF (must 404 outside local development)", async () => {
    const r = await get("/api/dev/users");
    return r.status === 404 || `HTTP ${r.status} — DEV_AUTH must never be enabled in a deployed environment`;
  });
  await check("served over HTTPS", async () => base.startsWith("https://") || "base URL is not https");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
