import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "@/domain/canonical";
import { batchRequestHash, parseBatch, type BatchCommand } from "@/domain/commands";
import { DomainError } from "@/domain/errors";
import { applyEvent, ReplayDivergenceError } from "@/domain/reducer";
import { decide, emptyJournalContext } from "@/domain/rules";
import type { CampaignState } from "@/domain/state";

const ctx = { commandIndex: 0, newId: () => "id-1", knownHolderRefs: new Set(["PC"]), hiddenHolderRefs: new Set<string>(), journal: emptyJournalContext() };
const intentRef = { kind: "player_choice", messageId: "m1" } as const;

function state(): CampaignState {
  return {
    campaignId: "C",
    format: 2,
    characters: {
      PC: {
        id: "PC",
        name: "Lik",
        hpCurrent: 10,
        hpMax: 12,
        hpTemp: 3,
        level: 2,
        speedFt: 30,
        acBase: 18,
        spellcastingAbility: "CHA",
        abilities: { STR: 16, DEX: 10, CON: 14, INT: 8, WIS: 12, CHA: 14 },
        saveProficiencies: ["CHA", "WIS"],
        skillProficiencies: { Athletics: "proficient" },
        unknownTotals: [],
      },
    },
    resourcePools: {
      slot: { id: "slot", characterId: "PC", resourceKey: "slot", current: 1, max: 2, rechargePolicy: "long_rest" },
      unk: { id: "unk", characterId: "PC", resourceKey: "unk", current: null, max: null, rechargePolicy: null },
    },
    wallets: {
      w: { id: "w", ownerCharacterId: "PC", purpose: "personal", label: "O", currency: "cp", amountMinor: 50 },
    },
    modifiers: {},
    spells: {},
    features: {},
    conditions: {},
    concentration: {},
    rollRequests: {},
    items: {},
  };
}

function c(type: BatchCommand["type"], payload: unknown): BatchCommand {
  return { commandId: randomUUID(), type, intentRef, payload } as BatchCommand;
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

describe("kanonski JSON", () => {
  it("sortira ključeve, čuva redoslijed nizova i ne ovisi o redoslijedu unosa", () => {
    expect(canonicalJson({ b: 1, a: [2, 1], c: null })).toBe('{"a":[2,1],"b":1,"c":null}');
    expect(canonicalHash({ x: 1, y: 2 })).toBe(canonicalHash({ y: 2, x: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it("način \"any\" (uvoz) dopušta konačne decimalne brojeve kao u RFC 8785", () => {
    expect(canonicalJson({ m: 3.5, n: 1e21, z: -0 }, { numbers: "any" })).toBe('{"m":3.5,"n":1e+21,"z":0}');
    expect(() => canonicalJson(Number.NaN, { numbers: "any" })).toThrow();
  });

  it("odbija decimalne brojeve i nepodržane tipove", () => {
    expect(() => canonicalJson(1.5)).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
  });
});

describe("ugovor batcha", () => {
  const base = () => ({
    schemaVersion: 1,
    batchId: randomUUID(),
    campaignId: "KDZ-001",
    expectedStateVersion: 0,
    commands: [c("ApplyHealing", { characterId: "PC-001", amount: 1 }), c("ApplyDamage", { characterId: "PC-001", amount: 2, damageType: null })],
  });

  it("hash ovisi o redoslijedu naredbi i o payloadu", () => {
    const b = base();
    const h = parseBatch(b).requestHash;
    expect(parseBatch(structuredClone(b)).requestHash).toBe(h);
    const reversed = { ...structuredClone(b), commands: [...b.commands].reverse() };
    expect(batchRequestHash(parseBatch(reversed).batch)).not.toBe(h);
  });

  it("odbija nepoznata polja, prazan batch i previše naredbi", () => {
    expect(code(() => parseBatch({ ...base(), extra: true }))).toBe("validation");
    expect(code(() => parseBatch({ ...base(), commands: [] }))).toBe("validation");
    const many = base();
    many.commands = Array.from({ length: 51 }, () => c("ApplyHealing", { characterId: "PC", amount: 1 }));
    expect(code(() => parseBatch(many))).toBe("validation");
  });
});

describe("pravila: HP (5e 2024)", () => {
  it("šteta najprije troši privremeni HP", () => {
    const [e] = decide(state(), c("ApplyDamage", { characterId: "PC", amount: 5, damageType: "fire" }), ctx);
    expect(e!.payload).toMatchObject({ tempBefore: 3, tempAfter: 0, hpBefore: 10, hpAfter: 8, excessDamage: 0, droppedToZero: false });
  });

  it("šteta ne spušta HP ispod 0 i bilježi višak; šteta na 0 HP traži odluku", () => {
    const s = state();
    const [e] = decide(s, c("ApplyDamage", { characterId: "PC", amount: 20, damageType: null }), ctx);
    expect(e!.payload).toMatchObject({ hpAfter: 0, excessDamage: 7, droppedToZero: true });
    applyEvent(s, e!);
    expect(code(() => decide(s, c("ApplyDamage", { characterId: "PC", amount: 1, damageType: null }), ctx))).toBe("needs_ruling");
  });

  it("liječenje ima granicu maksimuma; nepoznat maksimum traži odluku", () => {
    const [e] = decide(state(), c("ApplyHealing", { characterId: "PC", amount: 50 }), ctx);
    expect(e!.payload).toMatchObject({ hpBefore: 10, hpAfter: 12 });
    const s = state();
    s.characters.PC!.hpMax = null;
    expect(code(() => decide(s, c("ApplyHealing", { characterId: "PC", amount: 1 }), ctx))).toBe("needs_ruling");
  });

  it("privremeni HP se ne zbraja: replace ili keep_current", () => {
    const [r] = decide(state(), c("SetTemporaryHp", { characterId: "PC", amount: 5, mode: "replace" }), ctx);
    expect(r!.payload).toMatchObject({ tempBefore: 3, tempAfter: 5 });
    const [k] = decide(state(), c("SetTemporaryHp", { characterId: "PC", amount: 5, mode: "keep_current" }), ctx);
    expect(k!.payload).toMatchObject({ tempBefore: 3, tempAfter: 3 });
  });
});

describe("pravila: resursi i novac", () => {
  it("potrošnja zadnje uporabe dopuštena, preko toga nije; nepoznato traži odluku", () => {
    const s = state();
    const [e] = decide(s, c("ConsumeResource", { resourcePoolId: "slot", amount: 1 }), ctx);
    applyEvent(s, e!);
    expect(s.resourcePools.slot!.current).toBe(0);
    expect(code(() => decide(s, c("ConsumeResource", { resourcePoolId: "slot", amount: 1 }), ctx))).toBe("rule_violation");
    expect(code(() => decide(s, c("ConsumeResource", { resourcePoolId: "unk", amount: 1 }), ctx))).toBe("needs_ruling");
    expect(s.resourcePools.unk!.current).toBeNull();
  });

  it("nedovoljno novca je povreda pravila; nepostojeći entitet također", () => {
    expect(code(() => decide(state(), c("SpendCurrency", { walletId: "w", amountMinor: 51, reason: "x" }), ctx))).toBe("rule_violation");
    expect(code(() => decide(state(), c("ApplyHealing", { characterId: "NEMA", amount: 1 }), ctx))).toBe("rule_violation");
  });
});

describe("vlastiti ključevi kolekcija", () => {
  it("pravila i reducer ne vide naslijeđena svojstva", () => {
    expect(code(() => decide(state(), c("ApplyHealing", { characterId: "toString", amount: 1 }), ctx))).toBe("rule_violation");
    expect(() =>
      applyEvent(state(), { type: "TemporaryHpSet", payload: { characterId: "constructor", offered: 1, mode: "replace", tempBefore: 0, tempAfter: 1 } }),
    ).toThrow(ReplayDivergenceError);
    expect(({} as Record<string, unknown>).hpTemp).toBeUndefined();
  });
});

describe("reducer", () => {
  it("otkriva odstupanje vrijednosti „prije” umjesto da ga prepiše", () => {
    const s = state();
    expect(() =>
      applyEvent(s, { type: "ResourceConsumed", payload: { resourcePoolId: "slot", characterId: "PC", amount: 1, before: 2, after: 1 } }),
    ).toThrow(ReplayDivergenceError);
  });
});

describe("izvedene vrijednosti (2024)", () => {
  it("proficiency po razini i modifikator atributa", async () => {
    const { proficiencyBonusForLevel, abilityModifier } = await import("@/domain/derived");
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonusForLevel)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect([1, 8, 9, 10, 11, 20, 30].map(abilityModifier)).toEqual([-5, -1, -1, 0, 0, 5, 10]);
  });

  it("expertise udvostručuje PB; nepoznat atribut daje null s razlogom, ne 0", async () => {
    const { deriveSheet } = await import("@/domain/derived");
    const s = state();
    s.characters.PC!.skillProficiencies = { Persuasion: "expertise" };
    s.characters.PC!.abilities.WIS = null;
    const d = deriveSheet(s, "PC")!;
    expect(d.skills.Persuasion!.value).toBe(2 + 4);
    expect(d.skills.Perception!.value).toBeNull();
    expect(d.skills.Perception!.unknownBecause).toMatch(/WIS/);
    expect(d.passivePerception.value).toBeNull();
    s.characters.PC!.level = null;
    expect(deriveSheet(s, "PC")!.spellSaveDc.value).toBeNull();
  });
});
