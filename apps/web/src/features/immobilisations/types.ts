import type {
  InventorySummary, AssetEtat, AssetLabelFormat, AssetRequestKind, AssetStatut, ChangeRequestStatus, CoefficientBand, DepreciationMethod, PersistedAssetStatut,
} from "@church/shared";

/** Bigints travel as strings. Shapes mirror apps/api/src/modules/immobilisations (the API is the authority). */
export interface OpenRequestRef { id: string; kind: AssetRequestKind; status: ChangeRequestStatus; reference: string }

export interface Asset {
  id: string; parishId: string; code: string; registeredAt: string; acronym: string;
  accountCode: string; subaccountCode: string; description: string; invoiceNumber: string | null;
  supplierId: string | null; supplierName: string | null; locationId: string; locationName: string;
  acquisitionDate: string; inServiceDate: string | null;
  currency: string; fxRatePerUsd: string | null; fxRateDate: string | null;
  paMinor: string; faaMinor: string; costMinor: string;
  depreciationMethod: DepreciationMethod; usefulLifeYears: number | null; degressiveCoefficient: string | null;
  statut: PersistedAssetStatut; displayStatut: AssetStatut; etat: AssetEtat; observations: string | null; transactionId: string | null;
  rate: number | null; depreciableMinor: string; exerciseMinor: string; accumulatedMinor: string; vncMinor: string; depreciationState: string;
  openRequest: OpenRequestRef | null; createdBy: string; createdAt: string; updatedAt: string;
}
export interface ScheduleRow { index: number; fiscalYear: number; months: number; annuityMinor: string; accumulatedMinor: string; vncMinor: string }
export interface AssetDetail extends Asset { schedule: ScheduleRow[] }
export interface AssetPage { rows: Asset[]; total: number; page: number; pageSize: number; asOf: string }

export interface Prefix { id: string; parishId: string; acronym: string; label: string; subaccountCodes: string[]; active: boolean }
export interface Location { id: string; parishId: string; name: string; sortOrder: number; active: boolean }
export interface Supplier { id: string; parishId: string; name: string; phone: string | null; address: string | null; note: string | null; active: boolean }
export interface AssetRefs {
  prefixes: Prefix[]; locations: Location[]; suppliers: Supplier[];
  degressiveCoefficients: CoefficientBand[]; labelFormat: AssetLabelFormat; cdfPerUsd: string | null;
}

export interface AssetRequest {
  id: string; reference: string; kind: AssetRequestKind; reason: string; status: ChangeRequestStatus;
  assetId: string; assetCode: string; assetDescription: string; assetStatut: PersistedAssetStatut; assetCurrency: string;
  proposedChanges: Record<string, unknown> | null; oldValues: Record<string, unknown> | null;
  n1Skipped: boolean; n2Skipped: boolean; rejectedReason: string | null;
  requesterId: string; requesterName: string; tresorierName: string | null; tresorierAt: string | null;
  pasteurName: string | null; pasteurAt: string | null; executedAt: string | null; createdAt: string;
}
export interface RequestEvent { id: string; fromStatus: string | null; toStatus: ChangeRequestStatus; actorName: string; at: string; comment: string | null }

export interface EtatHistoryEntry {
  id: string; at: string; oldEtat: AssetEtat | null; newEtat: AssetEtat; reason: string; observation: string | null;
  locationName: string; actorName: string; requestReference: string | null;
  validation: "non_requis" | "approuve" | "en_attente" | "refuse"; rejectedReason?: string | null;
}
export interface AuditEntry { id: string; at: string; action: string; entity: string; actorName: string | null; before: unknown; after: unknown }

export interface AssetFilters {
  q: string; account: string; subaccount: string; year: string; locationId: string; supplierId: string;
  currency: string; mode: string; etat: string; statut: string; from: string; to: string; sort: string; dir: "asc" | "desc"; page: number;
}
export const EMPTY_FILTERS: AssetFilters = {
  q: "", account: "", subaccount: "", year: "", locationId: "", supplierId: "", currency: "", mode: "", etat: "", statut: "", from: "", to: "",
  sort: "created_at", dir: "desc", page: 1,
};

export interface Inventory {
  id: string; reference: string; locationId: string | null; locationName: string | null; status: "en_cours" | "cloture";
  startedOn: string; observations: string | null; createdAt: string; closedAt: string | null;
  total: number; checked: number; absents: number; extras: number;
}
export interface InventoryLine {
  id: string; inventoryId: string; assetId: string | null;
  expectedCode: string | null; expectedDescription: string | null; expectedLocationId: string | null; expectedLocationName: string | null; expectedEtat: AssetEtat | null;
  present: boolean | null; foundLocationId: string | null; foundLocationName: string | null; foundEtat: AssetEtat | null;
  responsible: string | null; observation: string | null; extraDescription: string | null; checkedAt: string | null; checkedByName: string | null;
}
export interface InventoryDetail extends Omit<Inventory, "total" | "checked" | "absents" | "extras"> { summary: InventorySummary; lines: InventoryLine[] }
