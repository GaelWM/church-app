import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { can, type Permission, type Role } from "@church/shared";
import { useApi } from "./api";
import type { Me, Parish } from "./types";

interface Session {
  me: Me;
  /** Selected parish id, or "all" for the consolidated (read-only) view. */
  parishId: string;
  setParishId: (id: string) => void;
  parish: Parish | undefined;
  roles: Role[];
  consolidated: boolean;
  /** Mirrors the API permission map (the API stays the authority). */
  can: (p: Permission) => boolean;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("Session missing");
  return s;
};

const KEY = "church.parish";

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [parishId, setParishIdState] = useState(() => {
    const saved = localStorage.getItem(KEY);
    return saved && (saved === "all" || me.parishes.some((p) => p.id === saved)) ? saved : me.parishes[0]?.id ?? "";
  });
  const setParishId = (id: string) => { localStorage.setItem(KEY, id); setParishIdState(id); };
  const value = useMemo<Session>(() => {
    const consolidated = parishId === "all";
    const parish = me.parishes.find((p) => p.id === parishId);
    const roles = consolidated
      ? [...new Set(me.parishes.filter((p) => p.consolidatedAccess).flatMap((p) => p.roles))]
      : parish?.roles ?? [];
    // Consolidated view is read-only: strip write permissions.
    const canFn = (p: Permission) => can(roles, p) && !(consolidated && !["transaction.readAll", "transaction.readOwn", "report.export", "audit.view"].includes(p));
    return { me, parishId, setParishId, parish, roles, consolidated, can: canFn };
  }, [me, parishId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me"), retry: false, staleTime: 5 * 60_000 });
}

// Reset stale parish selection when memberships change.
export function useParishGuard() {
  const { me, parishId, setParishId } = useSession();
  useEffect(() => {
    if (parishId !== "all" && !me.parishes.some((p) => p.id === parishId) && me.parishes[0]) setParishId(me.parishes[0].id);
  }, [me, parishId]);
}
