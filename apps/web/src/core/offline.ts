import { del, get, set, keys } from "idb-keyval";
import { useEffect, useState } from "react";
import type { ApiClient } from "./api";

/**
 * Offline drafts: entries created without connectivity are kept in IndexedDB and
 * posted (as Brouillon) when the connection returns. Nothing is ever auto-submitted.
 */
const PREFIX = "draft:";

export async function queueDraft(parishId: string, payload: unknown) {
  await set(`${PREFIX}${crypto.randomUUID()}`, { parishId, payload, at: Date.now() });
}

export async function pendingDrafts() {
  const ks = (await keys()).filter((k) => String(k).startsWith(PREFIX));
  return Promise.all(ks.map(async (k) => ({ key: k, ...(await get(k)) })));
}

export async function flushDrafts(makeApi: (parishId: string) => ApiClient): Promise<number> {
  let sent = 0;
  for (const d of await pendingDrafts()) {
    try {
      await makeApi(d.parishId).post("/transactions", d.payload);
      await del(d.key);
      sent++;
    } catch (e: any) {
      if (e?.status >= 400 && e?.status < 500) await del(d.key); // invalid: don't retry forever
      else break; // still offline
    }
  }
  return sent;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  return online;
}
