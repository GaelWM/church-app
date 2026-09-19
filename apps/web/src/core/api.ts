import { createContext, useContext } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
  upload<T>(path: string, file: File): Promise<T>;
  fileUrl(path: string): Promise<string>;
}

/** Same-origin fetch client: attaches the Auth0 access token and the selected parish. */
export function createApiClient(getToken: () => Promise<string>, getParish: () => string | null): ApiClient {
  async function raw(method: string, path: string, init: { body?: BodyInit; json?: unknown } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${await getToken()}` };
    const parish = getParish();
    if (parish) headers["x-parish-id"] = parish;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`/api${path}`, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (err as any).error ?? (res.status === 403 ? "not_configured" : res.statusText));
    }
    return res;
  }
  const json = async <T,>(m: string, p: string, body?: unknown) => {
    const res = await raw(m, p, { json: body });
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };
  return {
    request: json,
    get: (path, params) => {
      const q = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString() : "";
      return json("GET", path + (q === "?" ? "" : q));
    },
    post: (p, b) => json("POST", p, b ?? {}),
    patch: (p, b) => json("PATCH", p, b),
    put: (p, b) => json("PUT", p, b),
    del: async (p) => { await raw("DELETE", p); },
    upload: async (p, file) => {
      const fd = new FormData();
      fd.set("file", file);
      return (await raw("POST", p, { body: fd })).json();
    },
    // Attachments need the bearer token, so fetch as blob.
    fileUrl: async (p) => URL.createObjectURL(await (await raw("GET", p)).blob()),
  };
}

export const ApiContext = createContext<ApiClient | null>(null);
export const useApi = () => {
  const c = useContext(ApiContext);
  if (!c) throw new Error("ApiContext missing");
  return c;
};
