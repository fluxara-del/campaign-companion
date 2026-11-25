import type { DomainEventBody } from "./events";

/** Deterministički, kratki hrvatski opis događaja za minimalnu journal projekciju. */
export function describeEvent(e: DomainEventBody): string {
  switch (e.type) {
    case "DamageApplied": {
      const p = e.payload;
      const type = p.damageType ? ` (${p.damageType})` : "";
      const temp = p.tempBefore !== p.tempAfter ? `, privremeni HP ${p.tempBefore} → ${p.tempAfter}` : "";
      const zero = p.droppedToZero ? "; lik je na 0 HP, potrebna je DM odluka" : "";
      return `Šteta ${p.amount}${type}: HP ${p.hpBefore} → ${p.hpAfter}${temp}${zero}.`;
    }
    case "HealingApplied":
      return `Liječenje ${e.payload.amount}: HP ${e.payload.hpBefore} → ${e.payload.hpAfter} (najviše ${e.payload.hpMax}).`;
    case "TemporaryHpSet":
      return e.payload.mode === "replace"
        ? `Privremeni HP postavljen: ${e.payload.tempBefore} → ${e.payload.tempAfter}.`
        : `Ponuđeno ${e.payload.offered} privremenog HP-a; zadržano postojećih ${e.payload.tempAfter}.`;
    case "ResourceConsumed":
      return `Potrošen resurs ${e.payload.resourcePoolId}: ${e.payload.before} → ${e.payload.after}.`;
    case "CurrencySpent":
      return `Plaćeno ${e.payload.amountMinor} cp iz ${e.payload.walletId} (${e.payload.reason}): ${e.payload.before} → ${e.payload.after}.`;
    case "JournalNoteAppended":
      return e.payload.title ?? "Bilješka";
  }
}
