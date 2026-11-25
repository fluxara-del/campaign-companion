import type { BatchCommand } from "./commands";
import { DomainError } from "./errors";
import { EVENT_SCHEMA_VERSION, type EventDraft, type ItemPlacement } from "./events";
import { getOwn } from "./records";
import { previewRest } from "./rest";
import type { CampaignState } from "./state";

export const RULESET = { id: "dnd5e-2024", version: "2024.1-companion.0" } as const;

export type DecideContext = {
  commandIndex: number;
  newId: () => string;
  /** ID-jevi likova i NPC-eva kampanje (dopušteni držatelji predmeta). */
  knownHolderRefs: ReadonlySet<string>;
};

function violation(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("rule_violation", message, { commandIndex: ctx.commandIndex, ...details });
}

function ruling(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("needs_ruling", message, { commandIndex: ctx.commandIndex, ...details });
}

const mechanical = { schemaVersion: EVENT_SCHEMA_VERSION, visibility: "player", knowledgeKind: null } as const;
/** Trajna promjena lika (ne potrošnja u igri); isti oblik događaja, zasebna semantika u dnevniku. */
const permanent = mechanical;

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
      const events: EventDraft[] = [
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
      const conc = getOwn(state.concentration, characterId);
      if (conc) {
        if (hpAfter === 0) {
          // 0 HP → nesvjestica (incapacitated) → koncentracija završava.
          events.push({ ...mechanical, type: "ConcentrationEnded", payload: { characterId, spellSelectionId: conc.spellSelectionId, reason: "Lik je pao na 0 HP." } });
        } else {
          // 2024: DC je 10 ili polovica štete (zaokruženo naniže), najviše 30. Rezultat unosi igrač.
          const dc = Math.min(30, Math.max(10, Math.floor(amount / 2)));
          events.push({
            ...mechanical,
            type: "RollRequested",
            payload: { rollRequestId: ctx.newId(), characterId, kind: "concentration_save", dc, reason: `Concentration save nakon ${amount} štete` },
          });
        }
      }
      return events;
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
    case "SetAbilityScore": {
      const { characterId, ability, value, reason } = command.payload;
      const c = getOwn(state.characters, characterId);
      if (!c) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      if (c.abilities[ability] === value) violation(ctx, "Vrijednost je već postavljena.", { ability });
      return [{ ...permanent, type: "AbilityScoreSet", payload: { characterId, ability, before: c.abilities[ability], after: value, reason } }];
    }

    case "SetStatOverride": {
      const { characterId, target, value, reason } = command.payload;
      if (!getOwn(state.characters, characterId)) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      const modifierId = `${characterId}:override:${target}`;
      const cur = getOwn(state.modifiers, modifierId);
      if (!cur && value === null) violation(ctx, "Override ne postoji.", { target });
      return [
        {
          ...permanent,
          type: "StatOverrideSet",
          payload: {
            characterId,
            target,
            modifierId,
            before: cur ? { value: cur.value, reason: cur.reason } : null,
            after: value === null ? null : { value, reason },
          },
        },
      ];
    }

    case "SetSpellDetails": {
      const { spellSelectionId, spellLevel, concentration } = command.payload;
      const sp = getOwn(state.spells, spellSelectionId);
      if (!sp) violation(ctx, "Čarolija ne postoji u ovoj kampanji.", { spellSelectionId });
      if (getOwn(state.concentration, sp.characterId)?.spellSelectionId === spellSelectionId && concentration === false) {
        violation(ctx, "Lik trenutačno koncentrira na ovu čaroliju; najprije završi koncentraciju.");
      }
      return [
        {
          ...permanent,
          type: "SpellDetailsSet",
          payload: { spellSelectionId, before: { spellLevel: sp.spellLevel, concentration: sp.concentration }, after: { spellLevel, concentration } },
        },
      ];
    }

    case "SetSpellPrepared": {
      const { spellSelectionId, prepared } = command.payload;
      const sp = getOwn(state.spells, spellSelectionId);
      if (!sp) violation(ctx, "Čarolija ne postoji u ovoj kampanji.", { spellSelectionId });
      if (sp.alwaysPrepared && !prepared) violation(ctx, "Uvijek pripremljena čarolija ne može se odpripremiti.");
      if (sp.prepared === prepared) violation(ctx, prepared ? "Čarolija je već pripremljena." : "Čarolija nije pripremljena.");
      if (prepared && !sp.known) violation(ctx, "Lik ne zna ovu čaroliju.");
      return [{ ...permanent, type: "SpellPreparedSet", payload: { spellSelectionId, before: sp.prepared, after: prepared } }];
    }

    case "ResolveCast": {
      const { spellSelectionId, cost } = command.payload;
      const sp = getOwn(state.spells, spellSelectionId);
      if (!sp) violation(ctx, "Čarolija ne postoji u ovoj kampanji.", { spellSelectionId });
      if (!sp.prepared && !sp.alwaysPrepared) violation(ctx, "Čarolija nije pripremljena.");
      if (sp.spellLevel === null) ruling(ctx, "Razina čarolije nije poznata; postavi je prije bacanja.", { spellSelectionId });
      if (sp.concentration === null) ruling(ctx, "Nije poznato traži li čarolija koncentraciju.", { spellSelectionId });
      const events: EventDraft[] = [];
      let castLevel = sp.spellLevel;
      let costPayload: Extract<EventDraft, { type: "SpellCast" }>["payload"]["cost"] = { kind: "none" };
      if (cost.kind === "none") {
        if (sp.spellLevel > 0) violation(ctx, "Čarolija razine 1+ traži izričit trošak (slot ili besplatnu uporabu).");
      } else {
        const p = getOwn(state.resourcePools, cost.resourcePoolId);
        if (!p || p.characterId !== sp.characterId) violation(ctx, "Resurs ne postoji ili ne pripada liku.", { resourcePoolId: cost.resourcePoolId });
        if (cost.kind === "slot") {
          const m = /^spell-slot-(\d)$/.exec(p.resourceKey);
          if (!m) violation(ctx, "Odabrani resurs nije spell slot.", { resourcePoolId: p.id });
          const slotLevel = Number(m[1]);
          if (slotLevel < sp.spellLevel) violation(ctx, "Slot je niže razine od čarolije.", { slotLevel, spellLevel: sp.spellLevel });
          castLevel = slotLevel;
        } else if (/^spell-slot-/.test(p.resourceKey)) {
          violation(ctx, "Besplatna uporaba ne može biti spell slot.");
        }
        if (p.current === null) ruling(ctx, "Stanje resursa je nepoznato.", { resourcePoolId: p.id });
        if (p.current < 1) violation(ctx, "Nema preostalih uporaba odabranog resursa.", { resourcePoolId: p.id });
        costPayload = { kind: cost.kind, resourcePoolId: p.id, before: p.current, after: p.current - 1 };
      }
      events.push({ ...mechanical, type: "SpellCast", payload: { spellSelectionId, characterId: sp.characterId, spellName: sp.name, spellLevel: castLevel, cost: costPayload } });
      if (sp.concentration) {
        // 2024: početak nove koncentracije završava prethodnu.
        const cur = getOwn(state.concentration, sp.characterId);
        if (cur) {
          events.push({ ...mechanical, type: "ConcentrationEnded", payload: { characterId: sp.characterId, spellSelectionId: cur.spellSelectionId, reason: "Započeta nova koncentracija." } });
        }
        events.push({ ...mechanical, type: "ConcentrationStarted", payload: { characterId: sp.characterId, spellSelectionId } });
      }
      return events;
    }

    case "EndConcentration": {
      const { characterId, reason } = command.payload;
      const cur = getOwn(state.concentration, characterId);
      if (!cur) violation(ctx, "Lik ne koncentrira.", { characterId });
      return [{ ...mechanical, type: "ConcentrationEnded", payload: { characterId, spellSelectionId: cur.spellSelectionId, reason } }];
    }

    case "ResolveRollRequest": {
      const { rollRequestId, total } = command.payload;
      const r = getOwn(state.rollRequests, rollRequestId);
      if (!r) violation(ctx, "Zahtjev za bacanje ne postoji.", { rollRequestId });
      if (r.status !== "pending") violation(ctx, "Zahtjev je već riješen.", { rollRequestId });
      const cur = getOwn(state.concentration, r.characterId);
      const outcome = !cur ? "moot" : total >= r.dc ? "maintained" : "broken";
      const events: EventDraft[] = [
        { ...mechanical, type: "RollRequestResolved", payload: { rollRequestId, characterId: r.characterId, dc: r.dc, total, outcome } },
      ];
      if (outcome === "broken" && cur) {
        events.push({ ...mechanical, type: "ConcentrationEnded", payload: { characterId: r.characterId, spellSelectionId: cur.spellSelectionId, reason: `Neuspješan concentration save (${total} < ${r.dc}).` } });
      }
      return events;
    }

    case "ApplyCondition": {
      const { characterId, name, source, durationNote } = command.payload;
      if (!getOwn(state.characters, characterId)) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      return [{ ...mechanical, type: "ConditionApplied", payload: { conditionId: ctx.newId(), characterId, name, source, durationNote } }];
    }

    case "RemoveCondition": {
      const { conditionId, reason } = command.payload;
      const cond = getOwn(state.conditions, conditionId);
      if (!cond) violation(ctx, "Uvjet ne postoji.", { conditionId });
      return [
        {
          ...mechanical,
          type: "ConditionRemoved",
          payload: { conditionId, characterId: cond.characterId, name: cond.name, source: cond.source, durationNote: cond.durationNote, reason },
        },
      ];
    }

    case "TransferItem": {
      const { itemId, to } = command.payload;
      const it = getOwn(state.items, itemId);
      if (!it) violation(ctx, "Predmet ne postoji u ovoj kampanji.", { itemId });
      let after: ItemPlacement;
      if (to.kind === "holder") {
        if (!ctx.knownHolderRefs.has(to.holderRef)) violation(ctx, "Držatelj nije poznat lik ni NPC.", { holderRef: to.holderRef });
        after = { holderRef: to.holderRef, containerItemId: null, location: null, equipped: false };
      } else if (to.kind === "container") {
        const box = getOwn(state.items, to.containerItemId);
        if (!box) violation(ctx, "Spremnik ne postoji.", { containerItemId: to.containerItemId });
        // Spremnik ne smije biti sam predmet ni bilo što unutar njega (ciklus).
        for (let cur: string | null = box.id, guard = 0; cur; guard++) {
          if (cur === itemId || guard > 1000) violation(ctx, "Premještanje bi stvorilo ciklus spremnika.", { itemId, containerItemId: box.id });
          cur = getOwn(state.items, cur)?.containerItemId ?? null;
        }
        after = { holderRef: box.holderRef, containerItemId: box.id, location: box.location, equipped: false };
      } else {
        after = { holderRef: null, containerItemId: null, location: to.location, equipped: false };
      }
      const before = { holderRef: it.holderRef, containerItemId: it.containerItemId, location: it.location, equipped: it.equipped };
      if (JSON.stringify(before) === JSON.stringify(after)) violation(ctx, "Predmet je već na odredištu.");
      const events: EventDraft[] = [{ ...mechanical, type: "ItemMoved", payload: { itemId, name: it.name, before, after, viaContainerOf: null } }];
      // Sadržaj spremnika putuje sa spremnikom (držatelj i lokacija), ostaje u istom spremniku.
      const descendants = (rootId: string): string[] =>
        Object.values(state.items)
          .filter((x) => x.containerItemId === rootId)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .flatMap((x) => [x.id, ...descendants(x.id)]);
      for (const id of descendants(itemId)) {
        const d = getOwn(state.items, id)!;
        const dBefore = { holderRef: d.holderRef, containerItemId: d.containerItemId, location: d.location, equipped: d.equipped };
        const dAfter = { holderRef: after.holderRef, containerItemId: d.containerItemId, location: after.location, equipped: false };
        if (JSON.stringify(dBefore) !== JSON.stringify(dAfter)) {
          events.push({ ...mechanical, type: "ItemMoved", payload: { itemId: id, name: d.name, before: dBefore, after: dAfter, viaContainerOf: itemId } });
        }
      }
      return events;
    }

    case "SetEquipped": {
      const { itemId, equipped } = command.payload;
      const it = getOwn(state.items, itemId);
      if (!it) violation(ctx, "Predmet ne postoji u ovoj kampanji.", { itemId });
      if (equipped) {
        if (!it.holderRef || !getOwn(state.characters, it.holderRef)) violation(ctx, "Opremiti se može samo predmet koji drži lik.");
        if (it.containerItemId) violation(ctx, "Predmet je u spremniku; najprije ga izvadi.", { containerItemId: it.containerItemId });
      }
      if (it.equipped === equipped) violation(ctx, equipped ? "Predmet je već opremljen." : "Predmet nije opremljen.");
      return [{ ...mechanical, type: "ItemEquippedSet", payload: { itemId, name: it.name, before: it.equipped, after: equipped } }];
    }

    case "CompleteRest": {
      const { characterId, kind, previewHash } = command.payload;
      const preview = previewRest(state, characterId, kind);
      if (!preview) violation(ctx, "Lik ne postoji u ovoj kampanji.", { characterId });
      if (preview.hash !== previewHash) {
        violation(ctx, "Pregled odmora je zastario; učitaj novi pregled i potvrdi ponovno.", { reason: "preview_stale", expectedPreviewHash: preview.hash });
      }
      return [
        {
          ...mechanical,
          type: "RestCompleted",
          payload: {
            characterId,
            kind,
            previewHash,
            hp: preview.hp,
            temp: preview.temp,
            pools: preview.pools.map((p) => ({ resourcePoolId: p.resourcePoolId, before: p.before, after: p.after })),
          },
        },
      ];
    }
  }
}
