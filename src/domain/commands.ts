import { z } from "zod";
import { canonicalHash } from "./canonical";
import { DomainError } from "./errors";

/** Stabilni ID entiteta: dopušta i legacy oblike (npr. `PC-001`, `KDZ-001`). */
export const EntityId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, "Neispravan ID");

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

export const BatchCommand = z.discriminatedUnion("type", [
  ApplyDamage,
  ApplyHealing,
  SetTemporaryHp,
  ConsumeResource,
  SpendCurrency,
  AppendJournalNote,
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
