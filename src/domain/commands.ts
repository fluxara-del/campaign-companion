import { z } from "zod";
import { canonicalHash } from "./canonical";
import { DomainError } from "./errors";
import { RESERVED_KEYS } from "./records";

/** Stabilni ID entiteta: dopušta i legacy oblike (npr. `PC-001`, `KDZ-001`). */
export const EntityId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, "Neispravan ID")
  .refine((v) => !RESERVED_KEYS.has(v), "Rezervirani ključ nije dopušten kao ID");

/** ID-jevi koje generira klijent (batch, naredba): UUID. */
export const ClientId = z.uuid();

const Amount = (max: number) => z.int().min(1).max(max);
const Visibility = z.enum(["player", "dm", "shared"]);

export const IntentRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("player_choice"), messageId: EntityId, turnId: EntityId.optional() }),
  z.strictObject({ kind: z.literal("roll_result"), rollId: EntityId }),
  z.strictObject({ kind: z.literal("dm_consequence"), turnId: EntityId, ruleRef: z.string().min(1).max(120) }),
]);
export type IntentRef = z.infer<typeof IntentRef>;

const commandBase = { commandId: ClientId, intentRef: IntentRef };

export const ApplyDamage = z.strictObject({
  ...commandBase,
  type: z.literal("ApplyDamage"),
  payload: z.strictObject({
    characterId: EntityId,
    amount: Amount(10_000),
    damageType: z.string().min(1).max(32).nullable(),
  }),
});

export const ApplyHealing = z.strictObject({
  ...commandBase,
  type: z.literal("ApplyHealing"),
  payload: z.strictObject({ characterId: EntityId, amount: Amount(10_000) }),
});

export const SetTemporaryHp = z.strictObject({
  ...commandBase,
  type: z.literal("SetTemporaryHp"),
  payload: z.strictObject({
    characterId: EntityId,
    amount: z.int().min(0).max(10_000),
    /** 2024: privremeni HP se ne zbraja; igrač bira zadržati postojeće ili uzeti nove. */
    mode: z.enum(["replace", "keep_current"]),
  }),
});

export const ConsumeResource = z.strictObject({
  ...commandBase,
  type: z.literal("ConsumeResource"),
  payload: z.strictObject({ resourcePoolId: EntityId, amount: Amount(100) }),
});

export const SpendCurrency = z.strictObject({
  ...commandBase,
  type: z.literal("SpendCurrency"),
  payload: z.strictObject({
    walletId: EntityId,
    amountMinor: Amount(1_000_000_000),
    reason: z.string().min(1).max(200),
  }),
});

export const AppendJournalNote = z.strictObject({
  ...commandBase,
  type: z.literal("AppendJournalNote"),
  payload: z.strictObject({
    title: z.string().min(1).max(200).nullable(),
    text: z.string().min(1).max(10_000),
    visibility: Visibility,
  }),
});

// --- Faza 3: character sheet ---

const AbilityKey = z.enum(["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
const Reason = z.string().min(1).max(300);

/** Trajna promjena lika (ne potrošnja u igri): zahtijeva razlog. */
export const SetAbilityScore = z.strictObject({
  ...commandBase,
  type: z.literal("SetAbilityScore"),
  payload: z.strictObject({ characterId: EntityId, ability: AbilityKey, value: z.int().min(1).max(30), reason: Reason }),
});

export const STAT_TARGETS = /^(proficiencyBonus|initiative|ac|speed|spellSaveDc|spellAttack|passive:(Perception|Insight|Investigation)|mod:(STR|DEX|CON|INT|WIS|CHA)|save:(STR|DEX|CON|INT|WIS|CHA)|skill:[A-Za-z ]{3,30})$/;

/** Override izvedene vrijednosti s razlogom; `value: null` uklanja override. */
export const SetStatOverride = z.strictObject({
  ...commandBase,
  type: z.literal("SetStatOverride"),
  payload: z.strictObject({
    characterId: EntityId,
    target: z.string().regex(STAT_TARGETS, "Nepodržana izvedena vrijednost"),
    value: z.int().min(-50).max(100).nullable(),
    reason: Reason,
  }),
});

export const SetSpellDetails = z.strictObject({
  ...commandBase,
  type: z.literal("SetSpellDetails"),
  payload: z.strictObject({ spellSelectionId: EntityId, spellLevel: z.int().min(0).max(9).nullable(), concentration: z.boolean().nullable() }),
});

export const SetSpellPrepared = z.strictObject({
  ...commandBase,
  type: z.literal("SetSpellPrepared"),
  payload: z.strictObject({ spellSelectionId: EntityId, prepared: z.boolean() }),
});

export const ResolveCast = z.strictObject({
  ...commandBase,
  type: z.literal("ResolveCast"),
  payload: z.strictObject({
    spellSelectionId: EntityId,
    /** Igrač izričito bira način troška; slot i besplatna uporaba nikad se ne terete oba. */
    cost: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("slot"), resourcePoolId: EntityId }),
      z.strictObject({ kind: z.literal("free_use"), resourcePoolId: EntityId }),
      z.strictObject({ kind: z.literal("none") }),
    ]),
  }),
});

export const EndConcentration = z.strictObject({
  ...commandBase,
  type: z.literal("EndConcentration"),
  payload: z.strictObject({ characterId: EntityId, reason: Reason }),
});

/** Rezultat igračeva bacanja za otvoreni zahtjev (npr. concentration save). */
export const ResolveRollRequest = z.strictObject({
  ...commandBase,
  type: z.literal("ResolveRollRequest"),
  payload: z.strictObject({ rollRequestId: EntityId, total: z.int().min(-20).max(60) }),
});

export const ApplyCondition = z.strictObject({
  ...commandBase,
  type: z.literal("ApplyCondition"),
  payload: z.strictObject({
    characterId: EntityId,
    name: z.string().min(1).max(60),
    source: z.string().min(1).max(200),
    durationNote: z.string().min(1).max(200).nullable(),
  }),
});

export const RemoveCondition = z.strictObject({
  ...commandBase,
  type: z.literal("RemoveCondition"),
  payload: z.strictObject({ conditionId: EntityId, reason: Reason }),
});

export const TransferItem = z.strictObject({
  ...commandBase,
  type: z.literal("TransferItem"),
  payload: z.strictObject({
    itemId: EntityId,
    /** Točno jedno odredište: držatelj (lik/NPC), spremnik ili lokacija. */
    to: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("holder"), holderRef: EntityId }),
      z.strictObject({ kind: z.literal("container"), containerItemId: EntityId }),
      z.strictObject({ kind: z.literal("location"), location: z.string().min(1).max(200) }),
    ]),
  }),
});

export const SetEquipped = z.strictObject({
  ...commandBase,
  type: z.literal("SetEquipped"),
  payload: z.strictObject({ itemId: EntityId, equipped: z.boolean() }),
});

/** Potvrda odmora: `previewHash` mora odgovarati pregledu koji je igrač vidio. */
export const CompleteRest = z.strictObject({
  ...commandBase,
  type: z.literal("CompleteRest"),
  payload: z.strictObject({ characterId: EntityId, kind: z.enum(["short", "long"]), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }),
});

// --- Faza 4: dnevnik, znanje i sesije ---

const KnowledgeKind = z.enum(["observed", "reported", "rumor", "inferred", "canon"]);
const FactText = z.string().trim().min(1).max(4_000);

/** Izmjena osobne bilješke: nova revizija uz očekivanu staru; povijest ostaje u događajima. */
export const ReviseJournalNote = z.strictObject({
  ...commandBase,
  type: z.literal("ReviseJournalNote"),
  payload: z.strictObject({
    journalEntryId: EntityId,
    expectedRevision: z.int().min(1).max(1_000_000),
    title: z.string().min(1).max(200).nullable(),
    text: z.string().min(1).max(10_000),
  }),
});

/** Nova tvrdnja o svijetu s vrstom znanja, vidljivošću i izvorom (spec §9). */
export const RecordWorldFact = z.strictObject({
  ...commandBase,
  type: z.literal("RecordWorldFact"),
  payload: z.strictObject({
    subject: z.strictObject({ kind: z.enum(["npc", "quest", "location", "world"]), id: EntityId.nullable() }),
    text: FactText,
    knowledgeKind: KnowledgeKind,
    visibility: Visibility,
    sourceRef: z.string().min(1).max(300).nullable(),
  }),
});

/**
 * Ispravka potvrđene prošlosti: novi događaj koji referencira izvorni (izvorni se ne mijenja).
 * Ako je izvor tvrdnja, ona postaje zamijenjena (uz `replacement`) ili povučena.
 */
export const CorrectConfirmedFact = z.strictObject({
  ...commandBase,
  type: z.literal("CorrectConfirmedFact"),
  payload: z.strictObject({
    targetEventId: EntityId,
    reason: z.string().trim().min(1).max(1_000),
    replacement: z.strictObject({ text: FactText, knowledgeKind: KnowledgeKind, visibility: Visibility }).nullable(),
  }),
});

export const StartSession = z.strictObject({
  ...commandBase,
  type: z.literal("StartSession"),
  payload: z.strictObject({ title: z.string().trim().min(1).max(200).nullable() }),
});

export const EndSession = z.strictObject({
  ...commandBase,
  type: z.literal("EndSession"),
  payload: z.strictObject({ sessionId: EntityId }),
});

export const BatchCommand = z.discriminatedUnion("type", [
  ApplyDamage,
  ApplyHealing,
  SetTemporaryHp,
  ConsumeResource,
  SpendCurrency,
  AppendJournalNote,
  SetAbilityScore,
  SetStatOverride,
  SetSpellDetails,
  SetSpellPrepared,
  ResolveCast,
  EndConcentration,
  ResolveRollRequest,
  ApplyCondition,
  RemoveCondition,
  TransferItem,
  SetEquipped,
  CompleteRest,
  ReviseJournalNote,
  RecordWorldFact,
  CorrectConfirmedFact,
  StartSession,
  EndSession,
]);
export type BatchCommand = z.infer<typeof BatchCommand>;
export type CommandType = BatchCommand["type"];
export const COMMAND_TYPES = BatchCommand.options.map((o) => o.shape.type.value) as CommandType[];

export const MAX_COMMANDS_PER_BATCH = 50;

export const CommandBatch = z.strictObject({
  schemaVersion: z.literal(1),
  batchId: ClientId,
  campaignId: EntityId,
  expectedStateVersion: z.int().min(0),
  commands: z.array(BatchCommand).min(1).max(MAX_COMMANDS_PER_BATCH),
});
export type CommandBatch = z.infer<typeof CommandBatch>;

export type ParsedBatch = { batch: CommandBatch; requestHash: string };

/**
 * Validira batch (nepoznata polja se odbijaju), provjerava jedinstvenost `commandId`
 * unutar batcha i računa kanonski hash uređenog popisa naredbi (ADR-0004).
 */
export function parseBatch(input: unknown): ParsedBatch {
  const result = CommandBatch.safeParse(input);
  if (!result.success) {
    throw new DomainError("validation", "Batch nije valjan.", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const batch = result.data;
  const seen = new Set<string>();
  batch.commands.forEach((c, index) => {
    if (seen.has(c.commandId)) {
      throw new DomainError("duplicate_command_in_batch", "Isti commandId pojavljuje se više puta u batchu.", {
        commandIndex: index,
        commandId: c.commandId,
      });
    }
    seen.add(c.commandId);
  });
  return { batch, requestHash: batchRequestHash(batch) };
}

export function batchRequestHash(batch: CommandBatch): string {
  return canonicalHash({
    schemaVersion: batch.schemaVersion,
    campaignId: batch.campaignId,
    expectedStateVersion: batch.expectedStateVersion,
    commands: batch.commands.map((c) => ({
      commandId: c.commandId,
      type: c.type,
      intentRef: c.intentRef,
      payload: c.payload,
    })),
  });
}
