/**
 * Kanonsko mehaničko stanje kampanje. `null` uvijek znači „nepoznato”, nikad 0.
 * Verzija i sekvenca nisu dio hasha snapshot-a; provjeravaju se zasebno (replay).
 * Format 2 (Faza 3) dodaje trajne podatke lika, čarolije, značajke, uvjete,
 * koncentraciju, zahtjeve za bacanje i predmete.
 */
export const SNAPSHOT_FORMAT = 2 as const;

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = (typeof ABILITIES)[number];

export type CharacterState = {
  id: string;
  name: string;
  hpCurrent: number;
  hpMax: number | null;
  hpTemp: number;
  level: number | null;
  speedFt: number | null;
  acBase: number | null;
  spellcastingAbility: Ability | null;
  abilities: Record<Ability, number | null>;
  /** Sortirano, bez duplikata. */
  saveProficiencies: Ability[];
  skillProficiencies: Record<string, "proficient" | "expertise">;
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

export type StatModifierState = {
  id: string;
  characterId: string;
  target: string;
  kind: "bonus" | "override";
  value: number;
  source: string;
  reason: string;
};

export type SpellState = {
  id: string;
  characterId: string;
  name: string;
  spellLevel: number | null;
  known: boolean;
  prepared: boolean;
  alwaysPrepared: boolean;
  concentration: boolean | null;
};

export type FeatureState = {
  id: string;
  characterId: string;
  name: string;
  kind: "passive" | "active" | null;
  resourcePoolId: string | null;
  note: string | null;
};

export type ConditionState = {
  id: string;
  characterId: string;
  name: string;
  source: string;
  durationNote: string | null;
};

export type ConcentrationState = { characterId: string; spellSelectionId: string; instanceId: string };

export type RollRequestState = {
  id: string;
  characterId: string;
  kind: "concentration_save";
  dc: number;
  reason: string;
  status: "pending" | "resolved" | "cancelled";
  total: number | null;
  outcome: "maintained" | "broken" | "moot" | null;
  concentrationInstanceId: string | null;
};

export type ItemState = {
  id: string;
  name: string;
  quantity: number | null;
  ownerRef: string | null;
  holderRef: string | null;
  location: string | null;
  containerItemId: string | null;
  equipped: boolean | null;
};

export type CampaignState = {
  format: typeof SNAPSHOT_FORMAT;
  campaignId: string;
  characters: Record<string, CharacterState>;
  resourcePools: Record<string, ResourcePoolState>;
  wallets: Record<string, WalletState>;
  modifiers: Record<string, StatModifierState>;
  spells: Record<string, SpellState>;
  features: Record<string, FeatureState>;
  conditions: Record<string, ConditionState>;
  /** Ključ je characterId. */
  concentration: Record<string, ConcentrationState>;
  rollRequests: Record<string, RollRequestState>;
  items: Record<string, ItemState>;
};

export function cloneState(state: CampaignState): CampaignState {
  return structuredClone(state);
}

export function emptyAbilities(): Record<Ability, number | null> {
  return { STR: null, DEX: null, CON: null, INT: null, WIS: null, CHA: null };
}
