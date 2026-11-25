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
    case "AbilityScoreSet":
      return `Trajna promjena: ${e.payload.ability} ${e.payload.before ?? "?"} → ${e.payload.after} (${e.payload.reason}).`;
    case "StatOverrideSet":
      return e.payload.after
        ? `Override ${e.payload.target}: ${e.payload.after.value} (${e.payload.after.reason}).`
        : `Uklonjen override ${e.payload.target}.`;
    case "SpellDetailsSet":
      return `Podaci čarolije ${e.payload.spellSelectionId}: razina ${e.payload.after.spellLevel ?? "?"}, koncentracija ${e.payload.after.concentration === null ? "?" : e.payload.after.concentration ? "da" : "ne"}.`;
    case "SpellPreparedSet":
      return e.payload.after ? `Pripremljena čarolija ${e.payload.spellSelectionId}.` : `Čarolija ${e.payload.spellSelectionId} više nije pripremljena.`;
    case "SpellCast": {
      const c = e.payload.cost;
      const cost = c.kind === "none" ? "bez troška" : c.kind === "slot" ? `slot ${c.resourcePoolId}: ${c.before} → ${c.after}` : `besplatna uporaba ${c.resourcePoolId}: ${c.before} → ${c.after}`;
      return `Bačena čarolija ${e.payload.spellName} (razina ${e.payload.spellLevel}), ${cost}.`;
    }
    case "ConcentrationStarted":
      return `Započeta koncentracija (${e.payload.spellSelectionId}).`;
    case "ConcentrationEnded":
      return `Završena koncentracija (${e.payload.spellSelectionId}): ${e.payload.reason}`;
    case "RollRequested":
      return `Zahtjev za bacanje: ${e.payload.reason}, DC ${e.payload.dc}.`;
    case "RollRequestResolved":
      return `Bacanje ${e.payload.total} protiv DC ${e.payload.dc}: ${e.payload.outcome === "maintained" ? "koncentracija zadržana" : e.payload.outcome === "broken" ? "koncentracija prekinuta" : "bez učinka (nema koncentracije)"}.`;
    case "ConditionApplied":
      return `Uvjet ${e.payload.name} (${e.payload.source}).`;
    case "ConditionRemoved":
      return `Uklonjen uvjet ${e.payload.name}: ${e.payload.reason}`;
    case "ItemMoved": {
      const a = e.payload.after;
      const where = a.containerItemId ? `u spremnik ${a.containerItemId}` : a.holderRef ? `kod ${a.holderRef}` : `na lokaciju ${a.location}`;
      return `Predmet ${e.payload.name} premješten ${where}${e.payload.viaContainerOf ? " (sa spremnikom)" : ""}.`;
    }
    case "ItemEquippedSet":
      return e.payload.after ? `Opremljen predmet ${e.payload.name}.` : `Skinut predmet ${e.payload.name}.`;
    case "RestCompleted":
      return `${e.payload.kind === "long" ? "Dugi" : "Kratki"} odmor potvrđen: ${e.payload.pools.length} resursa obnovljeno${e.payload.hp ? `, HP ${e.payload.hp.before} → ${e.payload.hp.after}` : ""}.`;
  }
}
