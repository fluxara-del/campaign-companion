import type { BatchCommand } from "./commands";
import { DomainError } from "./errors";
import { EVENT_SCHEMA_VERSION, type EventDraft, type ItemPlacement, type Visibility } from "./events";
import { getOwn } from "./records";
import { previewRest } from "./rest";
import type { CampaignState } from "./state";

export const RULESET = { id: "dnd5e-2024", version: "2024.1-companion.0" } as const;

export type DecideContext = {
  commandIndex: number;
  newId: () => string;
  /** ID-jevi likova i NPC-eva kampanje (dopušteni držatelji predmeta). */
  knownHolderRefs: ReadonlySet<string>;
  /** NPC-evi vidljivi samo DM-u (za svaku ulogu isti skup); transfer koji ih dotiče vidi samo DM. */
  hiddenHolderRefs: ReadonlySet<string>;
  /** Faza 4: dnevnik, znanje i sesije (projekcije iz spremišta, ažurirane tijekom batcha). */
  journal: JournalContext;
};

export type NoteInfo = { authorActorId: string | null; revision: number; visibility: Visibility };
export type AssertionInfo = {
  status: "active" | "superseded" | "retracted";
  visibility: Visibility;
  subjectKind: "npc" | "quest" | "location" | "world";
  subjectId: string | null;
};
export type EventInfo = { id: string; seq: number; type: string; visibility: Visibility; assertionId: string | null };

export type JournalContext = {
  actorId: string;
  /** Vlasnik kampanje (DM) vidi i mijenja sve; ostale uloge samo player/shared. */
  isOwner: boolean;
  /** Verzija kampanje koju će ovaj batch upisati. */
  stateVersionAfter: number;
  notes: Map<string, NoteInfo>;
  knowledge: Map<string, AssertionInfo>;
  openSession: { id: string; number: number } | null;
  lastSessionNumber: number;
  /** Potvrđeni događaj iz ranijeg batcha (null ako ne postoji). */
  findEvent: (eventId: string) => EventInfo | null;
  /** NPC/quest postoji i uloga ga smije vidjeti. */
  subjectVisible: (kind: "npc" | "quest", id: string) => boolean;
};

export function emptyJournalContext(over: Partial<JournalContext> = {}): JournalContext {
  return {
    actorId: "owner",
    isOwner: true,
    stateVersionAfter: 1,
    notes: new Map(),
    knowledge: new Map(),
    openSession: null,
    lastSessionNumber: 0,
    findEvent: () => null,
    subjectVisible: () => false,
    ...over,
  };
}

const visibleTo = (j: JournalContext, v: Visibility) => j.isOwner || v !== "dm";

/**
 * Ažurira kontekst dnevnika nakon događaja istog batcha, tako da sljedeća naredba vidi njegov učinak
 * (npr. dvije revizije iste bilješke, početak i kraj sesije). Ne dira mehaničko stanje.
 */
export function applyToJournalContext(j: JournalContext, draft: EventDraft): void {
  switch (draft.type) {
    case "JournalNoteAppended":
      j.notes.set(draft.payload.journalEntryId, { authorActorId: j.actorId, revision: 1, visibility: draft.visibility });
      return;
    case "JournalNoteRevised": {
      const n = j.notes.get(draft.payload.journalEntryId);
      if (n) n.revision = draft.payload.revisionAfter;
      return;
    }
    case "WorldFactRecorded":
      j.knowledge.set(draft.payload.assertionId, { status: "active", visibility: draft.visibility, subjectKind: draft.payload.subjectKind, subjectId: draft.payload.subjectId });
      return;
    case "FactCorrected": {
      const old = draft.payload.assertionId ? j.knowledge.get(draft.payload.assertionId) : undefined;
      const r = draft.payload.replacement;
      if (old) old.status = r ? "superseded" : "retracted";
      if (r) j.knowledge.set(r.assertionId, { status: "active", visibility: r.visibility, subjectKind: r.subjectKind, subjectId: r.subjectId });
      return;
    }
    case "SessionStarted":
      j.openSession = { id: draft.payload.sessionId, number: draft.payload.number };
      j.lastSessionNumber = draft.payload.number;
      return;
    case "SessionEnded":
      j.openSession = null;
      return;
    default:
      return;
  }
}

function violation(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("rule_violation", message, { commandIndex: ctx.commandIndex, ...details });
}

/** Držatelj je DM-only NPC kojeg uloga autora ne vidi: predmet kod njega ponaša se kao nepostojeći. */
function hiddenFromActor(ctx: DecideContext, ref: string | null): boolean {
  return ref !== null && ctx.hiddenHolderRefs.has(ref) && !ctx.knownHolderRefs.has(ref);
}

function ruling(ctx: DecideContext, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("needs_ruling", message, { commandIndex: ctx.commandIndex, ...details });
}

const mechanical = { schemaVersion: EVENT_SCHEMA_VERSION, visibility: "player", knowledgeKind: null } as const;
/** Trajna promjena lika (ne potrošnja u igri); isti oblik događaja, zasebna semantika u dnevniku. */
const permanent = mechanical;

/**
 * Završetak koncentracije: događaj završetka i poništenje svih još otvorenih zahtjeva za save
 * vezanih uz tu instancu (stari rezultat nikad ne smije djelovati na novu koncentraciju).
 */
function endConcentration(state: CampaignState, characterId: string, reason: string, exceptRollId: string | null = null): EventDraft[] {
  const cur = getOwn(state.concentration, characterId);
  if (!cur) return [];
  const events: EventDraft[] = [
    { ...mechanical, type: "ConcentrationEnded", payload: { characterId, spellSelectionId: cur.spellSelectionId, instanceId: cur.instanceId, reason } },
  ];
  for (const r of Object.values(state.rollRequests)
    .filter((x) => x.status === "pending" && x.concentrationInstanceId === cur.instanceId && x.id !== exceptRollId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    events.push({ ...mechanical, type: "RollRequestCancelled", payload: { rollRequestId: r.id, characterId, reason: "Koncentracija na koju se zahtjev odnosi je završila." } });
  }
  return events;
}

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
          events.push(...endConcentration(state, characterId, "Lik je pao na 0 HP."));
        } else {
          // 2024: DC je 10 ili polovica štete (zaokruženo naniže), najviše 30. Rezultat unosi igrač.
          const dc = Math.min(30, Math.max(10, Math.floor(amount / 2)));
          events.push({
            ...mechanical,
            type: "RollRequested",
            payload: { rollRequestId: ctx.newId(), characterId, kind: "concentration_save", dc, reason: `Concentration save nakon ${amount} štete`, concentrationInstanceId: conc.instanceId },
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
        events.push(...endConcentration(state, sp.characterId, "Započeta nova koncentracija."));
        events.push({ ...mechanical, type: "ConcentrationStarted", payload: { characterId: sp.characterId, spellSelectionId, instanceId: ctx.newId() } });
      }
      return events;
    }

    case "EndConcentration": {
      const { characterId, reason } = command.payload;
      if (!getOwn(state.concentration, characterId)) violation(ctx, "Lik ne koncentrira.", { characterId });
      return endConcentration(state, characterId, reason);
    }

    case "ResolveRollRequest": {
      const { rollRequestId, total } = command.payload;
      const r = getOwn(state.rollRequests, rollRequestId);
      if (!r) violation(ctx, "Zahtjev za bacanje ne postoji.", { rollRequestId });
      if (r.status === "cancelled") violation(ctx, "Zahtjev je poništen jer je koncentracija završila.", { rollRequestId });
      if (r.status !== "pending") violation(ctx, "Zahtjev je već riješen.", { rollRequestId });
      const cur = getOwn(state.concentration, r.characterId);
      // Rezultat djeluje samo na instancu koncentracije koja je zahtjev otvorila.
      const applies = cur !== undefined && cur.instanceId === r.concentrationInstanceId;
      const outcome = !applies ? "moot" : total >= r.dc ? "maintained" : "broken";
      const events: EventDraft[] = [
        { ...mechanical, type: "RollRequestResolved", payload: { rollRequestId, characterId: r.characterId, dc: r.dc, total, outcome } },
      ];
      if (outcome === "broken") {
        events.push(...endConcentration(state, r.characterId, `Neuspješan concentration save (${total} < ${r.dc}).`, rollRequestId));
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
      // Predmet kod NPC-a skrivenog od ove uloge ponaša se kao nepostojeći (ne otkriva držatelja).
      if (!it || hiddenFromActor(ctx, it.holderRef)) violation(ctx, "Predmet ne postoji u ovoj kampanji.", { itemId });
      let after: ItemPlacement;
      if (to.kind === "holder") {
        if (!ctx.knownHolderRefs.has(to.holderRef)) violation(ctx, "Držatelj nije poznat lik ni NPC.", { holderRef: to.holderRef });
        after = { holderRef: to.holderRef, containerItemId: null, location: null, equipped: false };
      } else if (to.kind === "container") {
        const box = getOwn(state.items, to.containerItemId);
        if (!box || hiddenFromActor(ctx, box.holderRef)) violation(ctx, "Spremnik ne postoji.", { containerItemId: to.containerItemId });
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
      // Transfer od ili prema DM-only NPC-u vidi samo DM (događaj, dnevnik i sadržaj spremnika).
      const touchesHidden = [before.holderRef, after.holderRef].some((r) => r !== null && ctx.hiddenHolderRefs.has(r));
      const moved = { ...mechanical, visibility: touchesHidden ? ("dm" as const) : mechanical.visibility };
      const events: EventDraft[] = [{ ...moved, type: "ItemMoved", payload: { itemId, name: it.name, before, after, viaContainerOf: null } }];
      // Sadržaj spremnika putuje sa spremnikom (držatelj i lokacija), ostaje u istom spremniku.
      const descendants = (rootId: string): string[] =>
        Object.values(state.items)
          .filter((x) => x.containerItemId === rootId)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .flatMap((x) => [x.id, ...descendants(x.id)]);
      const contents = descendants(itemId).map((id) => getOwn(state.items, id)!);
      // Cijelo stablo provjerava se prije ikakve promjene: nedosljedan stari zapis (predmet skrivenog NPC-a u
      // vidljivom spremniku) uloga koja tog NPC-a ne vidi ne može premjestiti; pogreška ne imenuje sadržaj.
      if (contents.some((d) => hiddenFromActor(ctx, d.holderRef))) violation(ctx, "Premještanje ovog predmeta nije moguće.", { itemId });
      for (const d of contents) {
        const dBefore = { holderRef: d.holderRef, containerItemId: d.containerItemId, location: d.location, equipped: d.equipped };
        const dAfter = { holderRef: after.holderRef, containerItemId: d.containerItemId, location: after.location, equipped: false };
        if (JSON.stringify(dBefore) !== JSON.stringify(dAfter)) {
          // Vidljivost se određuje i za svaki predmet sadržaja prema njegovu vlastitom starom i novom držatelju.
          const dHidden = touchesHidden || [dBefore.holderRef, dAfter.holderRef].some((r) => r !== null && ctx.hiddenHolderRefs.has(r));
          events.push({ ...mechanical, visibility: dHidden ? "dm" : mechanical.visibility, type: "ItemMoved", payload: { itemId: d.id, name: d.name, before: dBefore, after: dAfter, viaContainerOf: itemId } });
        }
      }
      return events;
    }

    case "SetEquipped": {
      const { itemId, equipped } = command.payload;
      const it = getOwn(state.items, itemId);
      if (!it || hiddenFromActor(ctx, it.holderRef)) violation(ctx, "Predmet ne postoji u ovoj kampanji.", { itemId });
      if (equipped) {
        if (!it.holderRef || !getOwn(state.characters, it.holderRef)) violation(ctx, "Opremiti se može samo predmet koji drži lik.");
        if (it.containerItemId) violation(ctx, "Predmet je u spremniku; najprije ga izvadi.", { containerItemId: it.containerItemId });
      }
      if (it.equipped === equipped) violation(ctx, equipped ? "Predmet je već opremljen." : "Predmet nije opremljen.");
      // Predmet kod DM-only NPC-a: promjenu (dopuštenu samo vlasniku) vidi samo DM.
      const visibility = it.holderRef !== null && ctx.hiddenHolderRefs.has(it.holderRef) ? ("dm" as const) : mechanical.visibility;
      return [{ ...mechanical, visibility, type: "ItemEquippedSet", payload: { itemId, name: it.name, before: it.equipped, after: equipped } }];
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

    // --- Faza 4: dnevnik, znanje i sesije ---

    case "ReviseJournalNote": {
      const j = ctx.journal;
      const { journalEntryId, expectedRevision, title, text } = command.payload;
      const note = j.notes.get(journalEntryId);
      // Bilješka koju uloga ne smije vidjeti ponaša se kao nepostojeća.
      if (!note || !visibleTo(j, note.visibility)) violation(ctx, "Bilješka ne postoji.", { journalEntryId });
      if (!j.isOwner && note.authorActorId !== j.actorId) {
        throw new DomainError("forbidden", "Bilješku može mijenjati njezin autor ili vlasnik kampanje.", { commandIndex: ctx.commandIndex, journalEntryId });
      }
      if (note.revision !== expectedRevision) {
        violation(ctx, "Bilješka je u međuvremenu izmijenjena; učitaj novu reviziju.", { reason: "revision_stale", journalEntryId, currentRevision: note.revision });
      }
      return [
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          visibility: note.visibility,
          knowledgeKind: null,
          type: "JournalNoteRevised",
          payload: { journalEntryId, revisionBefore: note.revision, revisionAfter: note.revision + 1, title, text },
        },
      ];
    }

    case "RecordWorldFact": {
      const j = ctx.journal;
      const { subject, text, knowledgeKind, visibility, sourceRef } = command.payload;
      if (!j.isOwner && (visibility === "dm" || knowledgeKind === "canon")) {
        throw new DomainError("forbidden", "Kanon i DM tvrdnje upisuje samo vlasnik kampanje.", { commandIndex: ctx.commandIndex });
      }
      if ((subject.kind === "npc" || subject.kind === "quest") && (subject.id === null || !j.subjectVisible(subject.kind, subject.id))) {
        violation(ctx, "Subjekt tvrdnje ne postoji.", { subjectKind: subject.kind });
      }
      if (subject.kind === "world" && subject.id !== null) violation(ctx, "Tvrdnja o svijetu nema subjekt s ID-jem.");
      return [
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          visibility,
          knowledgeKind,
          type: "WorldFactRecorded",
          payload: { assertionId: ctx.newId(), subjectKind: subject.kind, subjectId: subject.id, text, knowledgeKind, sourceRef },
        },
      ];
    }

    case "CorrectConfirmedFact": {
      const j = ctx.journal;
      const { targetEventId, reason, replacement } = command.payload;
      if (!j.isOwner) throw new DomainError("forbidden", "Ispravke potvrđene prošlosti upisuje vlasnik kampanje.", { commandIndex: ctx.commandIndex });
      const target = j.findEvent(targetEventId);
      if (!target) violation(ctx, "Događaj ne postoji.", { targetEventId });
      const assertion = target.assertionId ? j.knowledge.get(target.assertionId) : undefined;
      if (target.assertionId && assertion && assertion.status !== "active") {
        violation(ctx, "Tvrdnja je već ispravljena; ispravi njezinu zamjenu.", { targetEventId, assertionId: target.assertionId });
      }
      if (replacement && !assertion) violation(ctx, "Zamjenska tvrdnja moguća je samo za događaj koji je zabilježio tvrdnju.", { targetEventId });
      const anyDm = target.visibility === "dm" || replacement?.visibility === "dm";
      const allShared = target.visibility === "shared" && (!replacement || replacement.visibility === "shared");
      return [
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          visibility: anyDm ? "dm" : allShared ? "shared" : "player",
          knowledgeKind: replacement?.knowledgeKind ?? null,
          type: "FactCorrected",
          payload: {
            targetEventId,
            targetSeq: target.seq,
            targetType: target.type,
            reason,
            assertionId: assertion ? target.assertionId : null,
            replacement:
              replacement && assertion
                ? { assertionId: ctx.newId(), subjectKind: assertion.subjectKind, subjectId: assertion.subjectId, text: replacement.text, knowledgeKind: replacement.knowledgeKind, visibility: replacement.visibility }
                : null,
          },
        },
      ];
    }

    case "StartSession": {
      const j = ctx.journal;
      if (!j.isOwner) throw new DomainError("forbidden", "Sesiju otvara vlasnik kampanje.", { commandIndex: ctx.commandIndex });
      if (j.openSession) violation(ctx, "Sesija je već otvorena; najprije je zatvori.", { sessionId: j.openSession.id });
      return [
        {
          ...mechanical,
          type: "SessionStarted",
          payload: { sessionId: ctx.newId(), number: j.lastSessionNumber + 1, title: command.payload.title, startVersion: j.stateVersionAfter },
        },
      ];
    }

    case "EndSession": {
      const j = ctx.journal;
      if (!j.isOwner) throw new DomainError("forbidden", "Sesiju zatvara vlasnik kampanje.", { commandIndex: ctx.commandIndex });
      if (!j.openSession || j.openSession.id !== command.payload.sessionId) violation(ctx, "Sesija nije otvorena.", { sessionId: command.payload.sessionId });
      return [{ ...mechanical, type: "SessionEnded", payload: { sessionId: j.openSession.id, number: j.openSession.number, endVersion: j.stateVersionAfter } }];
    }
  }
}
