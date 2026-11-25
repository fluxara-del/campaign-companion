/**
 * Kanonsko mehaničko stanje kampanje. `null` uvijek znači „nepoznato”, nikad 0.
 * Verzija i sekvenca nisu dio hasha snapshot-a; provjeravaju se zasebno (replay).
 */
export type CharacterState = {
  id: string;
  name: string;
  hpCurrent: number;
  hpMax: number | null;
  hpTemp: number;
};

export type ResourcePoolState = {
  id: string;
  characterId: string;
  resourceKey: string;
  current: number | null;
  max: number | null;
  rechargePolicy: "short_rest" | "long_rest" | "manual" | null;
};

export type WalletState = {
  id: string;
  ownerCharacterId: string | null;
  purpose: "personal" | "group_dedicated";
  label: string;
  currency: string;
  amountMinor: number | null;
};

export type CampaignState = {
  campaignId: string;
  characters: Record<string, CharacterState>;
  resourcePools: Record<string, ResourcePoolState>;
  wallets: Record<string, WalletState>;
};

export function cloneState(state: CampaignState): CampaignState {
  return structuredClone(state);
}
