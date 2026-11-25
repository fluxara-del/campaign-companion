/** Događaji domene (schemaVersion 1). Nose vrijednosti prije i poslije radi provjerljivog replaya. */
export type DamageApplied = {
  type: "DamageApplied";
  payload: {
    characterId: string;
    amount: number;
    damageType: string | null;
    tempBefore: number;
    tempAfter: number;
    hpBefore: number;
    hpAfter: number;
    /** Šteta iznad 0 HP; masivna šteta i death saves nisu automatizirani (ADR-0005). */
    excessDamage: number;
    droppedToZero: boolean;
  };
};

export type HealingApplied = {
  type: "HealingApplied";
  payload: { characterId: string; amount: number; hpBefore: number; hpAfter: number; hpMax: number };
};

export type TemporaryHpSet = {
  type: "TemporaryHpSet";
  payload: {
    characterId: string;
    offered: number;
    mode: "replace" | "keep_current";
    tempBefore: number;
    tempAfter: number;
  };
};

export type ResourceConsumed = {
  type: "ResourceConsumed";
  payload: { resourcePoolId: string; characterId: string; amount: number; before: number; after: number };
};

export type CurrencySpent = {
  type: "CurrencySpent";
  payload: { walletId: string; amountMinor: number; reason: string; before: number; after: number };
};

export type JournalNoteAppended = {
  type: "JournalNoteAppended";
  payload: { journalEntryId: string; title: string | null; text: string };
};

// --- Faza 3 ---

type Ab = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";

export type AbilityScoreSet = {
  type: "AbilityScoreSet";
  payload: { characterId: string; ability: Ab; before: number | null; after: number; reason: string };
};

export type StatOverrideSet = {
  type: "StatOverrideSet";
  payload: {
    characterId: string;
    target: string;
    modifierId: string;
    before: { value: number; reason: string } | null;
    after: { value: number; reason: string } | null;
  };
};

export type SpellDetailsSet = {
  type: "SpellDetailsSet";
  payload: {
    spellSelectionId: string;
    before: { spellLevel: number | null; concentration: boolean | null };
    after: { spellLevel: number | null; concentration: boolean | null };
  };
};

export type SpellPreparedSet = {
  type: "SpellPreparedSet";
  payload: { spellSelectionId: string; before: boolean; after: boolean };
};

export type SpellCast = {
  type: "SpellCast";
  payload: {
    spellSelectionId: string;
    characterId: string;
    spellName: string;
    spellLevel: number;
    cost: { kind: "slot" | "free_use"; resourcePoolId: string; before: number; after: number } | { kind: "none" };
  };
};

export type ConcentrationStarted = {
  type: "ConcentrationStarted";
  payload: { characterId: string; spellSelectionId: string };
};

export type ConcentrationEnded = {
  type: "ConcentrationEnded";
  payload: { characterId: string; spellSelectionId: string; reason: string };
};

export type RollRequested = {
  type: "RollRequested";
  payload: { rollRequestId: string; characterId: string; kind: "concentration_save"; dc: number; reason: string };
};

export type RollRequestResolved = {
  type: "RollRequestResolved";
  payload: { rollRequestId: string; characterId: string; dc: number; total: number; outcome: "maintained" | "broken" | "moot" };
};

export type ConditionApplied = {
  type: "ConditionApplied";
  payload: { conditionId: string; characterId: string; name: string; source: string; durationNote: string | null };
};

export type ConditionRemoved = {
  type: "ConditionRemoved";
  payload: { conditionId: string; characterId: string; name: string; source: string; durationNote: string | null; reason: string };
};

export type ItemPlacement = { holderRef: string | null; containerItemId: string | null; location: string | null; equipped: boolean | null };

export type ItemMoved = {
  type: "ItemMoved";
  payload: { itemId: string; name: string; before: ItemPlacement; after: ItemPlacement; viaContainerOf: string | null };
};

export type ItemEquippedSet = {
  type: "ItemEquippedSet";
  payload: { itemId: string; name: string; before: boolean | null; after: boolean };
};

export type RestCompleted = {
  type: "RestCompleted";
  payload: {
    characterId: string;
    kind: "short" | "long";
    previewHash: string;
    hp: { before: number; after: number } | null;
    temp: { before: number; after: number } | null;
    pools: { resourcePoolId: string; before: number | null; after: number | null }[];
  };
};

export type DomainEventBody =
  | DamageApplied
  | HealingApplied
  | TemporaryHpSet
  | ResourceConsumed
  | CurrencySpent
  | JournalNoteAppended
  | AbilityScoreSet
  | StatOverrideSet
  | SpellDetailsSet
  | SpellPreparedSet
  | SpellCast
  | ConcentrationStarted
  | ConcentrationEnded
  | RollRequested
  | RollRequestResolved
  | ConditionApplied
  | ConditionRemoved
  | ItemMoved
  | ItemEquippedSet
  | RestCompleted;

export type EventType = DomainEventBody["type"];

export type Visibility = "player" | "dm" | "shared";
export type KnowledgeKind = "observed" | "reported" | "rumor" | "inferred" | "canon";

/** Događaj prije dodjele `seq`, ID-a i vremena (to radi servis unutar transakcije). */
export type EventDraft = DomainEventBody & {
  schemaVersion: 1;
  visibility: Visibility;
  knowledgeKind: KnowledgeKind | null;
};

export const EVENT_SCHEMA_VERSION = 1 as const;
