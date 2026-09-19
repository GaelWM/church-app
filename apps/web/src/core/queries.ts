import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api";
import { useSession } from "./session";
import type { Account, Category } from "./types";

/** Every parish-scoped query key includes the parish so switching parish refetches. */
export const useScopedKey = (...parts: unknown[]) => [useSession().parishId, ...parts];

export function useAccounts() {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("accounts"), queryFn: () => api.get<Account[]>("/accounts") });
}
export function useCategories(kind?: Category["kind"]) {
  const api = useApi();
  const q = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories"), staleTime: 10 * 60_000 });
  return { ...q, data: q.data?.filter((c) => c.active && (!kind || c.kind === kind)) };
}
export const useInvalidateLedger = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
};
