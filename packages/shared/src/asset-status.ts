import type { AssetStatut, PersistedAssetStatut } from "./enums";
import type { DepreciationState } from "./depreciation";

/**
 * Statut shown to users: the stored statut, refined for an `actif` asset by its depreciation state
 * ("En cours d'amortissement", "Entièrement amorti"). Those two are derived, never persisted, so no
 * cron job has to keep them in sync.
 */
export function displayStatut(statut: PersistedAssetStatut, state: DepreciationState): AssetStatut {
  if (statut !== "actif") return statut;
  if (state === "en_amortissement") return "en_amortissement";
  if (state === "entierement_amorti") return "entierement_amorti";
  return "actif";
}

/** Only live (validated, still owned) assets count in the patrimoine totals: general state, VNC, par catégorie… */
export const countsInPatrimoine = (statut: PersistedAssetStatut): boolean => statut === "actif";

/** Statuts in which the asset can no longer be modified or have its état changed directly. */
export const isFrozenStatut = (statut: PersistedAssetStatut): boolean => statut !== "brouillon";

/** Statuts in which an état change or a modification request is meaningful. */
export const acceptsRequests = (statut: PersistedAssetStatut): boolean => statut === "actif";
