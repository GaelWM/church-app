import type { Bindings } from "../env";
import { devAuthEnabled } from "./dev";

const TOKEN_KEY = "auth0:mgmt-token";

async function managementToken(env: Bindings): Promise<string> {
  const cached = await env.KV.get(TOKEN_KEY);
  if (cached) return cached;
  const res = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.AUTH0_M2M_CLIENT_ID,
      client_secret: env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) throw new Error(`Auth0 token error ${res.status}: ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  // Free plan allows 1,000 M2M tokens/month: cache for 23h (~30/month).
  await env.KV.put(TOKEN_KEY, access_token, { expirationTtl: 23 * 3600 });
  return access_token;
}

async function mgmt(env: Bindings, path: string, init: RequestInit = {}) {
  const token = await managementToken(env);
  const res = await fetch(`https://${env.AUTH0_DOMAIN}/api/v2${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`Auth0 ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

export async function createAuth0User(env: Bindings, email: string, fullName: string) {
  if (devAuthEnabled(env)) return `dev|${email}`;
  const password = crypto.randomUUID() + crypto.randomUUID().slice(0, 8).toUpperCase() + "!1"; // 46 chars: Auth0 max is 72
  const u = await mgmt(env, "/users", {
    method: "POST",
    body: JSON.stringify({ email, name: fullName, password, connection: "Username-Password-Authentication", email_verified: false }),
  });
  return u.user_id as string;
}

export async function passwordSetLink(env: Bindings, auth0Id: string): Promise<string> {
  if (devAuthEnabled(env)) return env.APP_URL;
  const t = await mgmt(env, "/tickets/password-change", {
    method: "POST",
    body: JSON.stringify({ user_id: auth0Id, result_url: env.APP_URL, ttl_sec: 7 * 24 * 3600, mark_email_as_verified: true }),
  });
  return t.ticket as string;
}

export async function setAuth0Blocked(env: Bindings, auth0Id: string, blocked: boolean) {
  if (devAuthEnabled(env)) return;
  await mgmt(env, `/users/${encodeURIComponent(auth0Id)}`, { method: "PATCH", body: JSON.stringify({ blocked }) });
}
