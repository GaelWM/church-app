import {
  amountsAt, displayStatut, type DepreciationInput, type DepreciationMethod, type PersistedAssetStatut,
} from "@church/shared";
import type { AssetListRow, AssetRow } from "./immobilisations.repo";

export const costOf = (a: AssetRow): bigint => a.costMinor ?? a.paMinor + a.faaMinor;

export const depreciationInput = (a: AssetRow): DepreciationInput => ({
  method: a.depreciationMethod as DepreciationMethod, costMinor: costOf(a), years: a.usefulLifeYears,
  inServiceDate: a.inServiceDate, coefficient: a.degressiveCoefficient,
});

export type OpenRequestRef = { id: string; kind: string; status: string; reference: string };

/** The asset as the API returns it: stored fields, names, and the depreciation figures as of `asOf`. */
export function toView(r: AssetListRow, asOf: string, openRequest: OpenRequestRef | null = null) {
  const a = r.a;
  const d = amountsAt(depreciationInput(a), asOf);
  return {
    ...a, costMinor: costOf(a), locationName: r.locationName, supplierName: r.supplierName,
    rate: d.rate, depreciableMinor: d.depreciableMinor, exerciseMinor: d.exerciseMinor,
    accumulatedMinor: d.accumulatedMinor, vncMinor: d.vncMinor, depreciationState: d.state,
    displayStatut: displayStatut(a.statut as PersistedAssetStatut, d.state), openRequest,
  };
}
export type AssetView = ReturnType<typeof toView>;
