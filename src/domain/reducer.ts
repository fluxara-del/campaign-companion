import type { DomainEventBody } from "./events";
import { getOwn, setOwn } from "./records";
import type { CampaignState } from "./state";

export class ReplayDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayDivergenceError";
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual ?? null) !== JSON.stringify(expected ?? null)) {
    throw new ReplayDivergenceError(`${label}: stanje ${String(actual)}, događaj očekuje ${String(expected)}`);
  }
}

/**
 * Primjenjuje događaj na stanje (mutira predano stanje). Provjerava vrijednosti „prije”
 * kako bi replay otkrio svako odstupanje umjesto da ga tiho prepiše.
 */
export function applyEvent(state: CampaignState, event: DomainEventBody): CampaignState {
  switch (event.type) {
    case "DamageApplied": {
      const c = getOwn(state.characters, event.payload.characterId);
      if (!c) throw new ReplayDivergenceError(`Nepoznat lik ${event.payload.characterId}`);
      expectEqual("hpTemp", c.hpTemp, event.payload.tempBefore);
      expectEqual("hpCurrent", c.hpCurrent, event.payload.hpBefore);
      c.hpTemp = event.payload.tempAfter;
      c.hpCurrent = event.payload.hpAfter;
      return state;
    }
    case "HealingApplied": {
      const c = getOwn(state.characters, event.payload.characterId);
      if (!c) throw new ReplayDivergenceError(`Nepoznat lik ${event.payload.characterId}`);
      expectEqual("hpCurrent", c.hpCurrent, event.payload.hpBefore);
      expectEqual("hpMax", c.hpMax, event.payload.hpMax);
      c.hpCurrent = event.payload.hpAfter;
      return state;
    }
    case "TemporaryHpSet": {
      const c = getOwn(state.characters, event.payload.characterId);
      if (!c) throw new ReplayDivergenceError(`Nepoznat lik ${event.payload.characterId}`);
      expectEqual("hpTemp", c.hpTemp, event.payload.tempBefore);
      c.hpTemp = event.payload.tempAfter;
      return state;
    }
    case "ResourceConsumed": {
      const p = getOwn(state.resourcePools, event.payload.resourcePoolId);
      if (!p) throw new ReplayDivergenceError(`Nepoznat resurs ${event.payload.resourcePoolId}`);
      expectEqual("pool.current", p.current, event.payload.before);
      p.current = event.payload.after;
      return state;
    }
    case "CurrencySpent": {
      const w = getOwn(state.wallets, event.payload.walletId);
      if (!w) throw new ReplayDivergenceError(`Nepoznat novčanik ${event.payload.walletId}`);
      expectEqual("wallet.amountMinor", w.amountMinor, event.payload.before);
      w.amountMinor = event.payload.after;
      return state;
    }
    case "JournalNoteAppended":
      return state;

    case "AbilityScoreSet": {
      const c = getOwn(state.characters, event.payload.characterId);
      if (!c) throw new ReplayDivergenceError(`Nepoznat lik ${event.payload.characterId}`);
      expectEqual(`ability ${event.payload.ability}`, c.abilities[event.payload.ability], event.payload.before);
      c.abilities[event.payload.ability] = event.payload.after;
      return state;
    }
    case "StatOverrideSet": {
      const p = event.payload;
      const cur = getOwn(state.modifiers, p.modifierId);
      expectEqual("override", cur ? { value: cur.value, reason: cur.reason } : null, p.before);
      if (p.after) {
        setOwn(state.modifiers, p.modifierId, { id: p.modifierId, characterId: p.characterId, target: p.target, kind: "override", value: p.after.value, source: "Ručni override", reason: p.after.reason });
      } else if (cur) {
        delete state.modifiers[p.modifierId];
      }
      return state;
    }
    case "SpellDetailsSet": {
      const sp = getOwn(state.spells, event.payload.spellSelectionId);
      if (!sp) throw new ReplayDivergenceError(`Nepoznata čarolija ${event.payload.spellSelectionId}`);
      expectEqual("spell details", { spellLevel: sp.spellLevel, concentration: sp.concentration }, event.payload.before);
      sp.spellLevel = event.payload.after.spellLevel;
      sp.concentration = event.payload.after.concentration;
      return state;
    }
    case "SpellPreparedSet": {
      const sp = getOwn(state.spells, event.payload.spellSelectionId);
      if (!sp) throw new ReplayDivergenceError(`Nepoznata čarolija ${event.payload.spellSelectionId}`);
      expectEqual("prepared", sp.prepared, event.payload.before);
      sp.prepared = event.payload.after;
      return state;
    }
    case "SpellCast": {
      const cost = event.payload.cost;
      if (cost.kind !== "none") {
        const p = getOwn(state.resourcePools, cost.resourcePoolId);
        if (!p) throw new ReplayDivergenceError(`Nepoznat resurs ${cost.resourcePoolId}`);
        expectEqual("pool.current", p.current, cost.before);
        p.current = cost.after;
      }
      return state;
    }
    case "ConcentrationStarted": {
      if (getOwn(state.concentration, event.payload.characterId)) throw new ReplayDivergenceError("Koncentracija već postoji.");
      setOwn(state.concentration, event.payload.characterId, { characterId: event.payload.characterId, spellSelectionId: event.payload.spellSelectionId });
      return state;
    }
    case "ConcentrationEnded": {
      const cur = getOwn(state.concentration, event.payload.characterId);
      expectEqual("concentration", cur?.spellSelectionId ?? null, event.payload.spellSelectionId);
      delete state.concentration[event.payload.characterId];
      return state;
    }
    case "RollRequested": {
      const p = event.payload;
      if (getOwn(state.rollRequests, p.rollRequestId)) throw new ReplayDivergenceError("Zahtjev već postoji.");
      setOwn(state.rollRequests, p.rollRequestId, { id: p.rollRequestId, characterId: p.characterId, kind: p.kind, dc: p.dc, reason: p.reason, status: "pending", total: null, outcome: null });
      return state;
    }
    case "RollRequestResolved": {
      const r = getOwn(state.rollRequests, event.payload.rollRequestId);
      if (!r) throw new ReplayDivergenceError("Nepoznat zahtjev za bacanje.");
      expectEqual("roll status", r.status, "pending");
      r.status = "resolved";
      r.total = event.payload.total;
      r.outcome = event.payload.outcome;
      return state;
    }
    case "ConditionApplied": {
      const p = event.payload;
      if (getOwn(state.conditions, p.conditionId)) throw new ReplayDivergenceError("Uvjet već postoji.");
      setOwn(state.conditions, p.conditionId, { id: p.conditionId, characterId: p.characterId, name: p.name, source: p.source, durationNote: p.durationNote });
      return state;
    }
    case "ConditionRemoved": {
      if (!getOwn(state.conditions, event.payload.conditionId)) throw new ReplayDivergenceError("Nepoznat uvjet.");
      delete state.conditions[event.payload.conditionId];
      return state;
    }
    case "ItemMoved": {
      const it = getOwn(state.items, event.payload.itemId);
      if (!it) throw new ReplayDivergenceError(`Nepoznat predmet ${event.payload.itemId}`);
      expectEqual("item placement", { holderRef: it.holderRef, containerItemId: it.containerItemId, location: it.location, equipped: it.equipped }, event.payload.before);
      Object.assign(it, event.payload.after);
      return state;
    }
    case "ItemEquippedSet": {
      const it = getOwn(state.items, event.payload.itemId);
      if (!it) throw new ReplayDivergenceError(`Nepoznat predmet ${event.payload.itemId}`);
      expectEqual("equipped", it.equipped, event.payload.before);
      it.equipped = event.payload.after;
      return state;
    }
    case "RestCompleted": {
      const c = getOwn(state.characters, event.payload.characterId);
      if (!c) throw new ReplayDivergenceError(`Nepoznat lik ${event.payload.characterId}`);
      if (event.payload.hp) {
        expectEqual("hpCurrent", c.hpCurrent, event.payload.hp.before);
        c.hpCurrent = event.payload.hp.after;
      }
      if (event.payload.temp) {
        expectEqual("hpTemp", c.hpTemp, event.payload.temp.before);
        c.hpTemp = event.payload.temp.after;
      }
      for (const ch of event.payload.pools) {
        const p = getOwn(state.resourcePools, ch.resourcePoolId);
        if (!p) throw new ReplayDivergenceError(`Nepoznat resurs ${ch.resourcePoolId}`);
        expectEqual("pool.current", p.current, ch.before);
        p.current = ch.after;
      }
      return state;
    }
  }
}
