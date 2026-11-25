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

export type DomainEventBody =
  | DamageApplied
  | HealingApplied
  | TemporaryHpSet
  | ResourceConsumed
  | CurrencySpent
  | JournalNoteAppended;

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
