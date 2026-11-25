import type { DomainEventBody } from "./events";
import { getOwn } from "./records";
import type { CampaignState } from "./state";

export class ReplayDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayDivergenceError";
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
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
  }
}
