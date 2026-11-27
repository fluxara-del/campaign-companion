import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BatchCommand } from "@/domain/commands";
import { DomainError } from "@/domain/errors";
import { executeBatch } from "@/server/store/batch-service";
import type { Db } from "@/server/store/connection";
import { createCampaign, type CampaignSetup } from "@/server/store/campaign-setup";
import { verifyReplay } from "@/server/store/replay";
import { getCharacterSheet } from "@/server/store/sheet";
import { loadState, loadVisibleJournal } from "@/server/store/state-repo";
import { createTemplate, freshDb } from "./helpers";

const CID = "SHEET-1";
const PC = "PC-1";
const OWNER = { actorId: "owner" };
const AI = { actorId: "ai" };
let tpl: ReturnType<typeof createTemplate>;
let db: Db;
let version: number;

function setup(): CampaignSetup {
  return {
    id: CID,
    name: "Sheet",
    members: [
      { actorId: OWNER.actorId, role: "owner" },
      { actorId: AI.actorId, role: "ai_service" },
      { actorId: "viewer", role: "viewer" },
    ],
    characters: [
      {
        id: PC,
        name: "Paladin",
        hpCurrent: 22,
        hpMax: 22,
        hpTemp: 0,
        level: 2,
        speedFt: 30,
        acBase: 19,
        spellcastingAbility: "CHA",
        abilities: { STR: 17, DEX: 10, CON: 13, INT: 8, WIS: 13, CHA: 14 },
        saveProficiencies: ["CHA", "WIS"],
        skillProficiencies: { Athletics: "proficient", Perception: "proficient" },
      },
    ],
    resourcePools: [
      { id: "slot1", characterId: PC, resourceKey: "spell-slot-1", current: 2, max: 2, rechargePolicy: "long_rest" },
      { id: "slot2", characterId: PC, resourceKey: "spell-slot-2", current: 1, max: 1, rechargePolicy: "long_rest" },
      { id: "smite", characterId: PC, resourceKey: "free-divine-smite", current: 1, max: 1, rechargePolicy: "long_rest" },
      { id: "short", characterId: PC, resourceKey: "channel", current: 0, max: 1, rechargePolicy: "short_rest" },
      { id: "loh", characterId: PC, resourceKey: "lay-on-hands", current: 3, max: 10, rechargePolicy: null },
      { id: "hd", characterId: PC, resourceKey: "hit-dice-d10", current: 0, max: 2, rechargePolicy: null },
    ],
    wallets: [],
    modifiers: [{ id: "init-bonus", characterId: PC, target: "initiative", kind: "bonus", value: 2, source: "Alert", reason: "Talent" }],
    spells: [
      { id: "bless", characterId: PC, name: "Bless", spellLevel: 1, known: true, prepared: true, alwaysPrepared: false, concentration: true },
      { id: "sof", characterId: PC, name: "Shield of Faith", spellLevel: 1, known: true, prepared: true, alwaysPrepared: false, concentration: true },
      { id: "cure", characterId: PC, name: "Cure Wounds", spellLevel: 1, known: true, prepared: false, alwaysPrepared: false, concentration: false },
      { id: "smite-spell", characterId: PC, name: "Divine Smite", spellLevel: 1, known: true, prepared: true, alwaysPrepared: true, concentration: false },
      { id: "mystery", characterId: PC, name: "Nepoznata", spellLevel: null, known: true, prepared: true, alwaysPrepared: false, concentration: null },
    ],
    features: [{ id: "f-loh", characterId: PC, name: "Lay on Hands", kind: "active", resourcePoolId: "loh", note: null }],
    conditions: [],
    items: [
      { id: "pack", name: "Ruksak", quantity: 1, ownerRef: PC, holderRef: PC, location: null, containerItemId: null, equipped: null },
      { id: "dagger", name: "Bodež", quantity: 1, ownerRef: PC, holderRef: PC, location: null, containerItemId: "pack", equipped: false },
      { id: "pouch", name: "Torbica", quantity: 1, ownerRef: PC, holderRef: PC, location: null, containerItemId: "pack", equipped: null },
      { id: "coin", name: "Novčić", quantity: 1, ownerRef: PC, holderRef: PC, location: null, containerItemId: "pouch", equipped: null },
      { id: "secret", name: "Tajni predmet", quantity: 1, ownerRef: "NPC-TAJNI", holderRef: "NPC-TAJNI", location: null, containerItemId: null, equipped: null },
      { id: "ring", name: "Marin prsten", quantity: 1, ownerRef: "NPC-1", holderRef: "NPC-1", location: null, containerItemId: null, equipped: null },
    ],
  };
}

beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => tpl.cleanup());
beforeEach(() => {
  db = freshDb(tpl).db;
  createCampaign(db, setup(), { now: "2026-11-25T00:00:00.000Z" });
  db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-1', ?, 'npc', 'Mara', NULL, 'player', '{}', 't')`).run(CID);
  version = 0;
});

function cmd(type: BatchCommand["type"], payload: unknown, intent: "player_choice" | "roll_result" | "dm_consequence" = "player_choice"): BatchCommand {
  const intentRef =
    intent === "player_choice" ? { kind: "player_choice", messageId: "m" } : intent === "roll_result" ? { kind: "roll_result", rollId: "r" } : { kind: "dm_consequence", turnId: "t", ruleRef: "r" };
  return { commandId: randomUUID(), type, intentRef, payload } as BatchCommand;
}

function run(commands: BatchCommand[], actor = OWNER) {
  const r = executeBatch(db, actor, { schemaVersion: 1, batchId: randomUUID(), campaignId: CID, expectedStateVersion: version, commands });
  version = r.stateVersionAfter;
  return r;
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "none";
}

const sheet = () => getCharacterSheet(db, OWNER, CID, PC);
const state = () => loadState(db, CID);

describe("Izvedene vrijednosti i trajne promjene", () => {
  it("prikazuje izvedene vrijednosti s izvorima", () => {
    const d = sheet().derived;
    expect(d.proficiencyBonus.value).toBe(2);
    expect(d.abilities.STR.modifier.value).toBe(3);
    expect(d.skills.Athletics!.value).toBe(5);
    expect(d.saves.WIS.value).toBe(3);
    expect(d.saves.STR.value).toBe(3);
    expect(d.passivePerception.value).toBe(13);
    expect(d.initiative.value).toBe(2);
    expect(d.initiative.parts.map((p) => p.value)).toEqual([0, 2]);
    expect(d.spellSaveDc.value).toBe(12);
    expect(d.spellAttack.value).toBe(4);
    expect(d.armorClass.value).toBe(19);
  });

  it("promjena atributa preračunava podržane izvedene vrijednosti (trajna promjena s razlogom)", () => {
    run([cmd("SetAbilityScore", { characterId: PC, ability: "CHA", value: 16, reason: "Ability Score Improvement" })]);
    const d = sheet().derived;
    expect(d.abilities.CHA.modifier.value).toBe(3);
    expect(d.saves.CHA.value).toBe(5);
    expect(d.spellSaveDc.value).toBe(13);
    expect(d.skills.Persuasion!.value).toBe(3);
  });

  it("override zamjenjuje izračun i nosi razlog; uklanjanje vraća izračun", () => {
    run([cmd("SetStatOverride", { characterId: PC, target: "ac", value: 21, reason: "Shield of Faith ručno" })]);
    expect(sheet().derived.armorClass).toMatchObject({ value: 21, override: { value: 21, reason: "Shield of Faith ručno" } });
    run([cmd("SetStatOverride", { characterId: PC, target: "ac", value: null, reason: "Kraj učinka" })]);
    expect(sheet().derived.armorClass).toMatchObject({ value: 19, override: null });
  });

  it("nevaljan unos se odbija bez promjene (atribut 31, nepodržana meta, decimalna šteta)", () => {
    expect(code(() => run([cmd("SetAbilityScore", { characterId: PC, ability: "STR", value: 31, reason: "x" })]))).toBe("validation");
    expect(code(() => run([cmd("SetStatOverride", { characterId: PC, target: "hp", value: 1, reason: "x" })]))).toBe("validation");
    expect(code(() => run([cmd("ApplyDamage", { characterId: PC, amount: 2.5, damageType: null })]))).toBe("validation");
    expect(sheet().stateVersion).toBe(0);
  });

  it("čitanje sheeta ne mijenja stanje ni verziju", () => {
    const events = () => (db.prepare(`SELECT COUNT(*) AS n FROM "DomainEvent"`).get() as { n: number }).n;
    const before = JSON.stringify(state());
    sheet();
    sheet();
    getCharacterSheet(db, { actorId: "viewer" }, CID, PC);
    expect(JSON.stringify(state())).toBe(before);
    expect(events()).toBe(0);
    expect(sheet().stateVersion).toBe(0);
  });
});

describe("Čarolije, trošak i koncentracija", () => {
  it("priprema čarolije; uvijek pripremljena ne može se odpripremiti", () => {
    run([cmd("SetSpellPrepared", { spellSelectionId: "cure", prepared: true })]);
    expect(sheet().spells.find((s) => s.id === "cure")!.prepared).toBe(true);
    expect(code(() => run([cmd("SetSpellPrepared", { spellSelectionId: "smite-spell", prepared: false })]))).toBe("rule_violation");
  });

  it("cast s odabranim slotom troši točno taj slot; besplatna uporaba ne troši slot", () => {
    run([cmd("ResolveCast", { spellSelectionId: "smite-spell", cost: { kind: "free_use", resourcePoolId: "smite" } })]);
    let s = state();
    expect(s.resourcePools.smite!.current).toBe(0);
    expect(s.resourcePools.slot1!.current).toBe(2);
    run([cmd("ResolveCast", { spellSelectionId: "smite-spell", cost: { kind: "slot", resourcePoolId: "slot2" } })]);
    s = state();
    expect(s.resourcePools.slot2!.current).toBe(0);
    expect(s.resourcePools.slot1!.current).toBe(2);
    const ev = db.prepare(`SELECT payloadJson FROM "DomainEvent" WHERE type = 'SpellCast' ORDER BY seq DESC LIMIT 1`).get() as { payloadJson: string };
    expect(JSON.parse(ev.payloadJson).spellLevel).toBe(2);
  });

  it("odbija: nepripremljenu čaroliju, prazan resurs, slot preniske razine, slot kao besplatnu uporabu; nepoznata razina traži odluku", () => {
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "cure", cost: { kind: "slot", resourcePoolId: "slot1" } })]))).toBe("rule_violation");
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "short" } })]))).toBe("rule_violation");
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "free_use", resourcePoolId: "slot1" } })]))).toBe("rule_violation");
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "none" } })]))).toBe("rule_violation");
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "mystery", cost: { kind: "slot", resourcePoolId: "slot1" } })]))).toBe("needs_ruling");
    expect(state().resourcePools.slot1!.current).toBe(2);
  });

  it("nova koncentracija završava prethodnu", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    expect(sheet().concentration?.spellName).toBe("Bless");
    run([cmd("ResolveCast", { spellSelectionId: "sof", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    expect(sheet().concentration?.spellName).toBe("Shield of Faith");
    const types = (db.prepare(`SELECT type FROM "DomainEvent" ORDER BY seq`).all() as { type: string }[]).map((r) => r.type);
    expect(types).toEqual(["SpellCast", "ConcentrationStarted", "SpellCast", "ConcentrationEnded", "ConcentrationStarted"]);
  });

  it("šteta tijekom koncentracije otvara zahtjev za concentration save (DC 10 ili pola štete); igrač unosi rezultat", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("SetTemporaryHp", { characterId: PC, amount: 10, mode: "replace" })]);
    // 22 štete: privremeni HP upija 10, HP 22 → 10; DC = max(10, 22/2) = 11.
    run([cmd("ApplyDamage", { characterId: PC, amount: 22, damageType: null }, "dm_consequence")], AI);
    let pending = sheet().pendingRolls;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "concentration_save", dc: 11, status: "pending" });
    // AI ne smije upisati rezultat bacanja; rezultat mora biti igračev (roll_result).
    expect(code(() => run([cmd("ResolveRollRequest", { rollRequestId: pending[0]!.id, total: 15 }, "roll_result")], AI))).toBe("forbidden");
    expect(code(() => run([cmd("ResolveRollRequest", { rollRequestId: pending[0]!.id, total: 15 })]))).toBe("validation");
    run([cmd("ResolveRollRequest", { rollRequestId: pending[0]!.id, total: 15 }, "roll_result")]);
    expect(sheet().concentration?.spellName).toBe("Bless");
    expect(sheet().pendingRolls).toHaveLength(0);
    // Druga šteta i neuspjeli save prekidaju koncentraciju.
    run([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null }, "dm_consequence")], AI);
    pending = sheet().pendingRolls;
    expect(pending[0]!.dc).toBe(10);
    run([cmd("ResolveRollRequest", { rollRequestId: pending[0]!.id, total: 9 }, "roll_result")]);
    expect(sheet().concentration).toBeNull();
    expect(code(() => run([cmd("ResolveRollRequest", { rollRequestId: pending[0]!.id, total: 20 }, "roll_result")]))).toBe("rule_violation");
  });

  it("pad na 0 HP završava koncentraciju bez zahtjeva za save", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 30, damageType: null })]);
    expect(sheet().concentration).toBeNull();
    expect(sheet().pendingRolls).toHaveLength(0);
  });
});

describe("Predmeti: spremnici, transfer, oprema", () => {
  it("oprema iz spremnika: najprije izvaditi, zatim opremiti", () => {
    expect(code(() => run([cmd("SetEquipped", { itemId: "dagger", equipped: true })]))).toBe("rule_violation");
    run([cmd("TransferItem", { itemId: "dagger", to: { kind: "holder", holderRef: PC } }), cmd("SetEquipped", { itemId: "dagger", equipped: true })]);
    const dagger = state().items.dagger!;
    expect(dagger).toMatchObject({ containerItemId: null, holderRef: PC, equipped: true });
    expect(version).toBe(1);
  });

  it("transfer spremnika NPC-u premješta i sadržaj (rekurzivno); ciklus i nepoznat držatelj se odbijaju", () => {
    expect(code(() => run([cmd("TransferItem", { itemId: "pack", to: { kind: "container", containerItemId: "coin" } })]))).toBe("rule_violation");
    expect(code(() => run([cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: "NPC-NEPOZNAT" } })]))).toBe("rule_violation");
    run([cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: "NPC-1" } })]);
    const s = state();
    expect(s.items.pack!.holderRef).toBe("NPC-1");
    expect(s.items.coin).toMatchObject({ holderRef: "NPC-1", containerItemId: "pouch" });
    expect(s.items.pack!.ownerRef).toBe(PC);
    expect(sheet().inventory).toEqual([]);
    expect(code(() => run([cmd("SetEquipped", { itemId: "pack", equipped: true })]))).toBe("rule_violation");
  });
});

describe("Odmor: pregled i potvrda", () => {
  it("dugi odmor: pregled navodi promjene i nepoznato; potvrda s istim hashom obnavlja", () => {
    run([cmd("ApplyDamage", { characterId: PC, amount: 5, damageType: null }), cmd("ConsumeResource", { resourcePoolId: "slot1", amount: 2 })]);
    const preview = sheet().restPreview.long;
    expect(preview.hp).toEqual({ before: 17, after: 22 });
    expect(preview.pools.map((p) => p.resourceKey).sort()).toEqual(["channel", "free-divine-smite", "hit-dice-d10", "spell-slot-1"].filter((k) => k !== "free-divine-smite"));
    expect(preview.unchanged.some((u) => u.what === "lay-on-hands")).toBe(true);
    run([cmd("CompleteRest", { characterId: PC, kind: "long", previewHash: preview.hash })]);
    const s = state();
    expect(s.characters[PC]!.hpCurrent).toBe(22);
    expect(s.resourcePools.slot1!.current).toBe(2);
    expect(s.resourcePools.hd!.current).toBe(2);
    expect(s.resourcePools.loh!.current).toBe(3);
  });

  it("zastarjeli pregled se odbija; kratki odmor obnavlja samo short_rest resurse", () => {
    const stale = sheet().restPreview.long.hash;
    run([cmd("ConsumeResource", { resourcePoolId: "slot1", amount: 1 })]);
    expect(code(() => run([cmd("CompleteRest", { characterId: PC, kind: "long", previewHash: stale })]))).toBe("rule_violation");
    const short = sheet().restPreview.short;
    run([cmd("CompleteRest", { characterId: PC, kind: "short", previewHash: short.hash })]);
    const s = state();
    expect(s.resourcePools.short!.current).toBe(1);
    expect(s.resourcePools.slot1!.current).toBe(1);
  });

  it("AI ne smije potvrditi odmor ni baciti čaroliju umjesto igrača", () => {
    const preview = sheet().restPreview.long;
    expect(code(() => run([cmd("CompleteRest", { characterId: PC, kind: "long", previewHash: preview.hash }, "dm_consequence")], AI))).toBe("forbidden");
    expect(code(() => run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } }, "dm_consequence")], AI))).toBe("forbidden");
    expect(code(() => run([cmd("CompleteRest", { characterId: PC, kind: "long", previewHash: preview.hash }, "dm_consequence")]))).toBe("validation");
  });
});

describe("Uvjeti i replay", () => {
  it("uvjeti se primjenjuju i uklanjaju; cijela sesija prolazi replay", () => {
    run([cmd("ApplyCondition", { characterId: PC, name: "Poisoned", source: "Otrovna strelica", durationNote: "1 sat" }, "dm_consequence")], AI);
    const condId = sheet().conditions[0]!.id;
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 4, damageType: "poison" })]);
    run([cmd("ResolveRollRequest", { rollRequestId: sheet().pendingRolls[0]!.id, total: 12 }, "roll_result")]);
    run([cmd("TransferItem", { itemId: "pouch", to: { kind: "location", location: "Svratište" } })]);
    run([cmd("RemoveCondition", { conditionId: condId, reason: "Antidot" })]);
    run([cmd("CompleteRest", { characterId: PC, kind: "long", previewHash: sheet().restPreview.long.hash })]);
    const r = verifyReplay(db, CID);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.liveStateVersion).toBe(7);
  });
});

describe("Codex nalazi na PR-u #16", () => {
  it("P1: NPC vidljiv samo DM-u nije u player sheetu ni dopušten kao cilj transfera", () => {
    db.prepare(`INSERT INTO "Member" (campaignId, actorId, role, createdAt) VALUES (?, 'player', 'player', '2026-11-25T00:00:00Z')`).run(CID);
    db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(CID);
    const forPlayer = getCharacterSheet(db, { actorId: "player" }, CID, PC).holders.map((h) => h.id);
    const forViewer = getCharacterSheet(db, { actorId: "viewer" }, CID, PC).holders.map((h) => h.id);
    const forOwner = sheet().holders.map((h) => h.id);
    expect(forPlayer).toContain("NPC-1");
    expect(forPlayer).not.toContain("NPC-TAJNI");
    expect(forViewer).not.toContain("NPC-TAJNI");
    expect(forOwner).toContain("NPC-TAJNI");
    let err: DomainError | null = null;
    try {
      run([cmd("TransferItem", { itemId: "dagger", to: { kind: "holder", holderRef: "NPC-TAJNI" } })], { actorId: "player" });
    } catch (e) {
      err = e as DomainError;
    }
    expect(err?.code).toBe("rule_violation");
    expect(JSON.stringify({ m: err?.message, d: err?.details })).not.toContain("Tajni zlikovac");
    // Vlasnik (DM) smije predmet dati DM-only NPC-u.
    run([cmd("TransferItem", { itemId: "dagger", to: { kind: "holder", holderRef: "NPC-TAJNI" } })]);
    expect(state().items.dagger!.holderRef).toBe("NPC-TAJNI");
  });

  it("P1 (20e7c6a): transfer od i prema DM-only NPC-u vidi samo DM; javni transfer ostaje vidljiv", () => {
    db.prepare(`INSERT INTO "Member" (campaignId, actorId, role, createdAt) VALUES (?, 'player', 'player', '2026-11-25T00:00:00Z')`).run(CID);
    db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(CID);
    const leaks = (role: string) => JSON.stringify(loadVisibleJournal(db, CID, role)).match(/NPC-TAJNI|Tajni zlikovac/g) ?? [];
    const hiddenEvents = () =>
      db.prepare(`SELECT visibility, payloadJson FROM "DomainEvent" WHERE campaignId = ? AND type = 'ItemMoved' AND payloadJson LIKE '%NPC-TAJNI%'`).all(CID) as { visibility: string }[];

    // Torbica (s novčićem) ostaje liku; ruksak s bodežom ide skrivenom NPC-u, uz javnu promjenu u istom batchu.
    run([cmd("TransferItem", { itemId: "pouch", to: { kind: "holder", holderRef: PC } })]);
    run([
      cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: "NPC-TAJNI" } }),
      cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null }),
    ]);
    expect(state().items.dagger!.holderRef).toBe("NPC-TAJNI");
    expect(hiddenEvents()).toHaveLength(2);
    // Javni dio istog batcha igrač i dalje vidi.
    expect(loadVisibleJournal(db, CID, "player").some((j) => /HP|štet/i.test(j.text))).toBe(true);
    expect(hiddenEvents().every((e) => e.visibility === "dm")).toBe(true);
    expect(leaks("player")).toEqual([]);
    expect(leaks("viewer")).toEqual([]);

    // Igrač ne smije dirati predmet ni spremnik skrivenog NPC-a, a pogreška ga ne otkriva.
    for (const to of [{ kind: "holder", holderRef: PC }, { kind: "location", location: "Pod" }]) {
      let err: DomainError | null = null;
      try {
        run([cmd("TransferItem", { itemId: "dagger", to })], { actorId: "player" });
      } catch (e) {
        err = e as DomainError;
      }
      expect(err?.code).toBe("rule_violation");
      expect(JSON.stringify({ m: err?.message, d: err?.details })).not.toMatch(/NPC-TAJNI|Tajni zlikovac/);
    }
    expect(code(() => run([cmd("TransferItem", { itemId: "pouch", to: { kind: "container", containerItemId: "pack" } })], { actorId: "player" }))).toBe("rule_violation");

    // Od skrivenog NPC-a natrag liku: i dalje samo DM.
    run([cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: PC } })]);
    expect(state().items.dagger!.holderRef).toBe(PC);
    expect(hiddenEvents()).toHaveLength(4);
    expect(hiddenEvents().every((e) => e.visibility === "dm")).toBe(true);
    expect(leaks("player")).toEqual([]);
    expect(leaks("viewer")).toEqual([]);

    // Vlasnik zadržava puni trag: oba DM-only unosa s četiri pomaka.
    const dmEntries = loadVisibleJournal(db, CID, "owner").filter((j) => j.visibility === "dm");
    expect(dmEntries).toHaveLength(2);
    expect(dmEntries.flatMap((j) => j.text.split("\n")).filter((l) => l.startsWith("Predmet"))).toHaveLength(4);

    // Javni transfer (vidljivom NPC-u) igrač i promatrač vide.
    run([cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: "NPC-1" } })]);
    for (const role of ["player", "viewer"]) {
      expect(loadVisibleJournal(db, CID, role).filter((j) => j.text.includes("NPC-1"))).toHaveLength(1);
      expect(leaks(role)).toEqual([]);
    }
    expect(verifyReplay(db, CID).ok).toBe(true);
  });

  it("P2 (4649fbd): SetEquipped za predmet skrivenog NPC-a — igrač dobiva isti odgovor kao za nepostojeći; vlasnikova promjena samo DM-u", () => {
    db.prepare(`INSERT INTO "Member" (campaignId, actorId, role, createdAt) VALUES (?, 'player', 'player', '2026-11-25T00:00:00Z')`).run(CID);
    db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(CID);
    const snapshot = () => ({
      version: (db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(CID) as { stateVersion: number }).stateVersion,
      events: (db.prepare(`SELECT count(*) AS n FROM "DomainEvent" WHERE campaignId = ?`).get(CID) as { n: number }).n,
      journal: (db.prepare(`SELECT count(*) AS n FROM "JournalEntry" WHERE campaignId = ?`).get(CID) as { n: number }).n,
      item: state().items.secret,
    });
    const attempt = (itemId: string) => {
      try {
        run([cmd("SetEquipped", { itemId, equipped: false })], { actorId: "player" });
      } catch (e) {
        const err = e as DomainError;
        return { code: err.code, message: err.message, details: { ...err.details, itemId: "X" } };
      }
      return null;
    };
    const before = snapshot();
    const hidden = attempt("secret");
    const missing = attempt("ne-postoji");
    expect(hidden).not.toBeNull();
    expect(hidden).toEqual(missing);
    expect(JSON.stringify(hidden)).not.toMatch(/NPC-TAJNI|Tajni/);
    expect(snapshot()).toEqual(before);
    expect(before.item!.equipped).toBeNull();

    // Vlasnik smije; događaj i zapis vidi samo DM.
    run([cmd("SetEquipped", { itemId: "secret", equipped: false })]);
    expect(state().items.secret!.equipped).toBe(false);
    const ev = db.prepare(`SELECT visibility FROM "DomainEvent" WHERE campaignId = ? AND type = 'ItemEquippedSet'`).all(CID) as { visibility: string }[];
    expect(ev).toEqual([{ visibility: "dm" }]);
    for (const role of ["player", "viewer"]) expect(JSON.stringify(loadVisibleJournal(db, CID, role))).not.toMatch(/Tajni/);
    expect(loadVisibleJournal(db, CID, "owner").some((j) => j.visibility === "dm" && j.text.includes("Tajni predmet"))).toBe(true);
    expect(verifyReplay(db, CID).ok).toBe(true);
  });

  it("SR-01: ponovljeni batch s javnim i DM zapisom vraća iste ID-jeve bez novih događaja, zapisa i verzije", () => {
    db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(CID);
    const batch = {
      schemaVersion: 1 as const,
      batchId: randomUUID(),
      campaignId: CID,
      expectedStateVersion: version,
      commands: [
        cmd("TransferItem", { itemId: "pack", to: { kind: "holder", holderRef: "NPC-TAJNI" } }),
        cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null }),
      ],
    };
    const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM "${t}" WHERE campaignId = ?`).get(CID) as { n: number }).n;
    const first = executeBatch(db, OWNER, batch);
    expect(first.replayed).toBe(false);
    expect(first.journalEntryIds).toHaveLength(2);
    const vis = db.prepare(`SELECT id, visibility FROM "JournalEntry" WHERE batchId = ? ORDER BY id`).all(batch.batchId) as { id: string; visibility: string }[];
    expect(vis.map((v) => v.visibility).sort()).toEqual(["dm", "player"]);
    const after = { events: count("DomainEvent"), journal: count("JournalEntry"), links: count("JournalEventLink"), version: first.stateVersionAfter };
    const again = executeBatch(db, OWNER, batch);
    expect(again.replayed).toBe(true);
    expect({ ...again, replayed: false }).toEqual(first);
    expect({ events: count("DomainEvent"), journal: count("JournalEntry"), links: count("JournalEventLink"), version: (db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(CID) as { stateVersion: number }).stateVersion }).toEqual(after);
    expect(verifyReplay(db, CID).ok).toBe(true);
  });

  it("P1 (dd09670): inventar ne otkriva skrivenog vlasnika predmeta ni izravno ni u spremniku", () => {
    db.prepare(`INSERT INTO "Member" (campaignId, actorId, role, createdAt) VALUES (?, 'player', 'player', '2026-11-25T00:00:00Z')`).run(CID);
    db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(CID);
    const flat = (nodes: { id: string; ownerRef: string | null; contents: unknown[] }[]): { id: string; ownerRef: string | null }[] =>
      nodes.flatMap((n) => [n, ...flat(n.contents as typeof nodes)]);
    const check = () => {
      for (const actorId of ["player", "viewer"]) {
        const sh = getCharacterSheet(db, { actorId }, CID, PC);
        expect(JSON.stringify(sh)).not.toMatch(/NPC-TAJNI|Tajni zlikovac/);
        const inv = flat(sh.inventory);
        expect(inv.find((i) => i.id === "secret")!.ownerRef).toBeNull();
        // Vidljive reference ostaju: vlasnik lik i vidljivi NPC.
        expect(inv.find((i) => i.id === "pack")!.ownerRef).toBe(PC);
        expect(inv.find((i) => i.id === "ring")!.ownerRef).toBe("NPC-1");
      }
      const dm = flat(sheet().inventory);
      expect(dm.find((i) => i.id === "secret")!.ownerRef).toBe("NPC-TAJNI");
      expect(dm.find((i) => i.id === "ring")!.ownerRef).toBe("NPC-1");
      // Čitanje lista ne mijenja vlasništvo u bazi.
      expect(state().items.secret!.ownerRef).toBe("NPC-TAJNI");
    };
    run([
      cmd("TransferItem", { itemId: "secret", to: { kind: "holder", holderRef: PC } }),
      cmd("TransferItem", { itemId: "ring", to: { kind: "holder", holderRef: PC } }),
    ]);
    check();
    const v = version;
    // U spremniku lika.
    run([cmd("TransferItem", { itemId: "secret", to: { kind: "container", containerItemId: "pack" } })]);
    expect(state().items.secret).toMatchObject({ containerItemId: "pack", holderRef: PC });
    check();
    expect(version).toBe(v + 1);
    expect(verifyReplay(db, CID).ok).toBe(true);
  });

  it("P2: stari concentration save ne djeluje na novu koncentraciju (druga čarolija)", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 4, damageType: null })]);
    const oldReq = sheet().pendingRolls[0]!;
    run([cmd("ResolveCast", { spellSelectionId: "sof", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    expect(sheet().pendingRolls).toEqual([]);
    expect(state().rollRequests[oldReq.id]!.status).toBe("cancelled");
    expect(code(() => run([cmd("ResolveRollRequest", { rollRequestId: oldReq.id, total: 1 }, "roll_result")]))).toBe("rule_violation");
    expect(sheet().concentration?.spellName).toBe("Shield of Faith");
  });

  it("P2: ni nakon prekida i ponovnog bacanja iste čarolije", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 4, damageType: null })]);
    const oldReq = sheet().pendingRolls[0]!;
    run([cmd("EndConcentration", { characterId: PC, reason: "Igrač prekida" })]);
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    expect(code(() => run([cmd("ResolveRollRequest", { rollRequestId: oldReq.id, total: 1 }, "roll_result")]))).toBe("rule_violation");
    expect(sheet().concentration?.spellName).toBe("Bless");
    expect(verifyReplay(db, CID).ok).toBe(true);
  });

  it("P2: dva otvorena zahtjeva iste koncentracije — neuspjeh jednog poništava drugi", () => {
    run([cmd("ResolveCast", { spellSelectionId: "bless", cost: { kind: "slot", resourcePoolId: "slot1" } })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: null })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: null })]);
    const [a, b] = sheet().pendingRolls;
    run([cmd("ResolveRollRequest", { rollRequestId: a!.id, total: 3 }, "roll_result")]);
    expect(sheet().concentration).toBeNull();
    expect(state().rollRequests[b!.id]!.status).toBe("cancelled");
    expect(state().rollRequests[a!.id]).toMatchObject({ status: "resolved", outcome: "broken" });
  });
});
