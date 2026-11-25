import type { BatchCommand } from "./commands";
import { DomainError } from "./errors";
import { EVENT_SCHEMA_VERSION, type EventDraft } from "./events";
import { getOwn } from "./records";
import type { CampaignState } from "./state";

export const RULESET = { id: "dnd5e-2024", version: "2024.1-companion.0" } as const;

export type DecideContext = { commandIndex: number; newId: () => string };

function violation(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("rule_violation", message, { commandIndex: ctx.commandIndex, ...details });
}

function ruling(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("needs_ruling", message, { commandIndex: ctx.commandIndex, ...details });
}

const mechanical = { schemaVersion: EVENT_SCHEMA_VERSION, visibility: "player", knowledgeKind: null } as const;

/**
 * Čista pravila: iz trenutačnog stanja i jedne naredbe izvodi događaje ili baca
 * `rule_violation` / `needs_ruling`. Ne mijenja stanje (to radi reducer).
 * Podržani opseg: ADR-0005. Sve izvan toga je `needs_ruling`, nikad pretpostavka.
 */
export function decide(state: CampaignState, command: BatchCommand, ctx: DecideContext): EventDraft[] {
  switch (command.type) {
    case "ApplyDamage": {
      const { characterId, amount, damageType } = command.payload;
      const c = getOwn(state.characters, characterId);
      if (!c) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      if (c.hpCurrent === 0) {
        ruling(ctx, "Šteta liku na 0 HP (death save neuspjesi, masivna šteta) nije automatizirana.", { characterId });
      }
      // 2024: šteta najprije troši privremeni HP, ostatak smanjuje trenutačni HP.
      const fromTemp = Math.min(c.hpTemp, amount);
      const remaining = amount - fromTemp;
      const hpAfter = Math.max(0, c.hpCurrent - remaining);
      const excessDamage = remaining - (c.hpCurrent - hpAfter);
      return [
        {
          ...mechanical,
          type: "DamageApplied",
          payload: {
            characterId,
            amount,
            damageType,
            tempBefore: c.hpTemp,
            tempAfter: c.hpTemp - fromTemp,
            hpBefore: c.hpCurrent,
            hpAfter,
            excessDamage,
            droppedToZero: hpAfter === 0,
          },
        },
      ];
    }

    case "ApplyHealing": {
      const { characterId, amount } = command.payload;
      const c = getOwn(state.characters, characterId);
      if (!c) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      if (c.hpMax === null) ruling(ctx, "Maksimalni HP je nepoznat; liječenje nema granicu.", { characterId });
      const hpAfter = Math.min(c.hpMax, c.hpCurrent + amount);
      return [
        {
          ...mechanical,
          type: "HealingApplied",
          payload: { characterId, amount, hpBefore: c.hpCurrent, hpAfter, hpMax: c.hpMax },
        },
      ];
    }

    case "SetTemporaryHp": {
      const { characterId, amount, mode } = command.payload;
      const c = getOwn(state.characters, characterId);
      if (!c) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      // 2024: privremeni HP se ne zbraja; igrač izričito bira zadržati postojeće ili uzeti nove.
      const tempAfter = mode === "replace" ? amount : c.hpTemp;
      return [
        {
          ...mechanical,
          type: "TemporaryHpSet",
          payload: { characterId, offered: amount, mode, tempBefore: c.hpTemp, tempAfter },
        },
      ];
    }

    case "ConsumeResource": {
      const { resourcePoolId, amount } = command.payload;
      const p = getOwn(state.resourcePools, resourcePoolId);
      if (!p) violation(ctx, "Resurs ne postoji u ovoj kampanji.", { resourcePoolId });
      if (p.current === null) ruling(ctx, "Stanje resursa je nepoznato.", { resourcePoolId });
      if (p.current < amount) {
        violation(ctx, "Nedovoljno preostalih uporaba resursa.", { resourcePoolId, current: p.current, amount });
      }
      return [
        {
          ...mechanical,
          type: "ResourceConsumed",
          payload: { resourcePoolId, characterId: p.characterId, amount, before: p.current, after: p.current - amount },
        },
      ];
    }

    case "SpendCurrency": {
      const { walletId, amountMinor, reason } = command.payload;
      const w = getOwn(state.wallets, walletId);
      if (!w) violation(ctx, "Novčanik ne postoji u ovoj kampanji.", { walletId });
      if (w.amountMinor === null) ruling(ctx, "Stanje novčanika je nepoznato.", { walletId });
      if (w.amountMinor < amountMinor) {
        violation(ctx, "Nedovoljno novca u odabranom novčaniku.", { walletId, available: w.amountMinor, amountMinor });
      }
      return [
        {
          ...mechanical,
          type: "CurrencySpent",
          payload: { walletId, amountMinor, reason, before: w.amountMinor, after: w.amountMinor - amountMinor },
        },
      ];
    }

    case "AppendJournalNote": {
      const { title, text, visibility } = command.payload;
      return [
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          visibility,
          knowledgeKind: null,
          type: "JournalNoteAppended",
          payload: { journalEntryId: ctx.newId(), title, text },
        },
      ];
    }
  }
}
