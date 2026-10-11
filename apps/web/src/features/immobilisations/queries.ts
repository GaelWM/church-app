import { useQuery } from "@tanstack/react-query";
import { useApi } from "../../core/api";
import { useScopedKey } from "../../core/queries";
import type { AssetDetail, AssetFilters, AssetPage, AssetRefs, AssetRequest, AuditEntry, EtatHistoryEntry, Inventory, InventoryDetail, RequestEvent } from "./types";

export const PAGE_SIZE = 50;

/** Query-string form of the register filters (empty values are dropped by the API client). */
export const filterParams = (f: AssetFilters, extra: Record<string, string> = {}): Record<string, string | undefined> => ({
  q: f.q, account: f.account, subaccount: f.subaccount, year: f.year, locationId: f.locationId, supplierId: f.supplierId,
  currency: f.currency, mode: f.mode, etat: f.etat, statut: f.statut, from: f.from, to: f.to, sort: f.sort, dir: f.dir, page: String(f.page), ...extra,
});

/** Locations, acronyms, suppliers, dégressif coefficients, label layout and the latest CDF rate, in one call. */
export function useAssetRefs(includeInactive = false) {
  const api = useApi();
  return useQuery({
    queryKey: useScopedKey("asset-refs", includeInactive),
    queryFn: () => api.get<AssetRefs>("/immobilisations/refs", includeInactive ? { all: "1" } : undefined),
    staleTime: 60_000,
  });
}

export function useAssetPage(f: AssetFilters) {
  const api = useApi();
  return useQuery({
    queryKey: useScopedKey("assets", f),
    queryFn: () => api.get<AssetPage>("/immobilisations", filterParams(f, { pageSize: String(PAGE_SIZE) })),
    placeholderData: (prev) => prev,
  });
}

export function useAsset(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset", id), queryFn: () => api.get<AssetDetail>(`/immobilisations/${id}`), enabled: !!id });
}

export function useEtatHistory(id: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset-etat-history", id), queryFn: () => api.get<EtatHistoryEntry[]>(`/immobilisations/${id}/etat-history`), enabled: !!id && enabled });
}

export function useAssetAudit(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset-audit", id), queryFn: () => api.get<AuditEntry[]>(`/immobilisations/${id}/audit`), enabled: !!id });
}

export function useAssetRequests(params: { assetId?: string; status?: string } = {}) {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset-requests", params), queryFn: () => api.get<AssetRequest[]>("/immobilisations/requests", params) });
}

export function useAssetRequest(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: useScopedKey("asset-request", id),
    queryFn: () => api.get<AssetRequest & { events: RequestEvent[] }>(`/immobilisations/requests/${id}`), enabled,
  });
}

export function useInventories() {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset-inventories"), queryFn: () => api.get<Inventory[]>("/immobilisations/inventories") });
}

export function useInventory(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: useScopedKey("asset-inventory", id), queryFn: () => api.get<InventoryDetail>(`/immobilisations/inventories/${id}`), enabled: !!id });
}
