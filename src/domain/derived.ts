import { getOwn } from "./records";
import { ABILITIES, type Ability, type CampaignState, type CharacterState, type StatModifierState } from "./state";

/** Vještine D&D 5e (2024) i pripadni atributi (mehanička činjenica, bez opisa pravila). */
export const SKILLS: Record<string, Ability> = {
  Acrobatics: "DEX",
  "Animal Handling": "WIS",
  Arcana: "INT",
  Athletics: "STR",
  Deception: "CHA",
  History: "INT",
  Insight: "WIS",
  Intimidation: "CHA",
  Investigation: "INT",
  Medicine: "WIS",
  Nature: "INT",
  Perception: "WIS",
  Performance: "CHA",
  Persuasion: "CHA",
  Religion: "INT",
  "Sleight of Hand": "DEX",
  Stealth: "DEX",
  Survival: "WIS",
};

export type Part = { label: string; value: number };

/** Izvedena vrijednost s objašnjenjem; `value = null` znači da ulaz nije poznat. */
export type Derived = {
  value: number | null;
  parts: Part[];
  override: { value: number; reason: string; source: string } | null;
  unknownBecause: string | null;
};

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** 2024: razina 1–4 → +2, 5–8 → +3, 9–12 → +4, 13–16 → +5, 17–20 → +6. */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function finalize(state: CampaignState, c: CharacterState, target: string, base: Derived): Derived {
  const mods = Object.values(state.modifiers)
    .filter((m): m is StatModifierState => m.characterId === c.id && m.target === target)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const bonuses = mods.filter((m) => m.kind === "bonus");
  const override = mods.find((m) => m.kind === "override") ?? null;
  const parts = [...base.parts, ...bonuses.map((b) => ({ label: `${b.source} (${b.reason})`, value: b.value }))];
  const computed = base.value === null ? null : base.value + bonuses.reduce((a, b) => a + b.value, 0);
  return {
    value: override ? override.value : computed,
    parts,
    override: override ? { value: override.value, reason: override.reason, source: override.source } : null,
    unknownBecause: override ? null : base.unknownBecause,
  };
}

const EXPLICIT_UNKNOWN = "Izvor izričito navodi da je vrijednost nepoznata.";
const unknown = (why: string): Derived => ({ value: null, parts: [], override: null, unknownBecause: why });

export type CharacterSheetDerived = {
  proficiencyBonus: Derived;
  abilities: Record<Ability, { score: number | null; modifier: Derived }>;
  saves: Record<Ability, Derived & { proficient: boolean }>;
  skills: Record<string, Derived & { ability: Ability; proficiency: "none" | "proficient" | "expertise" }>;
  passivePerception: Derived;
  passiveInsight: Derived;
  passiveInvestigation: Derived;
  initiative: Derived;
  armorClass: Derived;
  speed: Derived;
  spellSaveDc: Derived;
  spellAttack: Derived;
  notes: string[];
};

/**
 * Izračun izvedenih vrijednosti za podržani profil `dnd5e-2024`. Svaka vrijednost nosi
 * dijelove izračuna, bonuse s izvorom i eventualni override s razlogom. Ništa se ne
 * pretpostavlja: nepoznat atribut ili razina daju `null` uz razlog.
 */
export function deriveSheet(state: CampaignState, characterId: string): CharacterSheetDerived | null {
  const c = getOwn(state.characters, characterId);
  if (!c) return null;

  const pb: Derived =
    c.level === null
      ? unknown("Razina lika nije poznata.")
      : { value: proficiencyBonusForLevel(c.level), parts: [{ label: `Razina ${c.level}`, value: proficiencyBonusForLevel(c.level) }], override: null, unknownBecause: null };
  const proficiencyBonus = finalize(state, c, "proficiencyBonus", pb);
  const pbValue = proficiencyBonus.value;

  const abilities = {} as CharacterSheetDerived["abilities"];
  const mod = (a: Ability): number | null => abilities[a].modifier.value;
  for (const a of ABILITIES) {
    const score = c.abilities[a];
    const base: Derived =
      score === null
        ? unknown(`${a} nije poznat.`)
        : { value: abilityModifier(score), parts: [{ label: `${a} ${score}: (${score} − 10) / 2, zaokruženo naniže`, value: abilityModifier(score) }], override: null, unknownBecause: null };
    abilities[a] = { score, modifier: finalize(state, c, `mod:${a}`, base) };
  }

  const withProficiency = (label: string, abilityMod: number | null, multiplier: 0 | 1 | 2, why: string): Derived => {
    if (abilityMod === null) return unknown(why);
    const parts: Part[] = [{ label, value: abilityMod }];
    if (multiplier > 0) {
      if (pbValue === null) return unknown("Proficiency bonus nije poznat.");
      parts.push({ label: multiplier === 2 ? `Expertise (2 × ${sign(pbValue)})` : `Proficiency ${sign(pbValue)}`, value: pbValue * multiplier });
    }
    return { value: parts.reduce((s, p) => s + p.value, 0), parts, override: null, unknownBecause: null };
  };

  const saves = {} as CharacterSheetDerived["saves"];
  for (const a of ABILITIES) {
    const proficient = c.saveProficiencies.includes(a);
    saves[a] = { ...finalize(state, c, `save:${a}`, c.unknownTotals.includes(`save:${a}`) ? unknown(EXPLICIT_UNKNOWN) : withProficiency(`${a} modifikator`, mod(a), proficient ? 1 : 0, `${a} nije poznat.`)), proficient };
  }

  const skills = {} as CharacterSheetDerived["skills"];
  for (const [skill, ability] of Object.entries(SKILLS)) {
    const p = c.skillProficiencies[skill];
    const mult = p === "expertise" ? 2 : p === "proficient" ? 1 : 0;
    skills[skill] = {
      ...finalize(state, c, `skill:${skill}`, c.unknownTotals.includes(`skill:${skill}`) ? unknown(EXPLICIT_UNKNOWN) : withProficiency(`${ability} modifikator`, mod(ability), mult, `${ability} nije poznat.`)),
      ability,
      proficiency: p ?? "none",
    };
  }

  const perception = skills.Perception!;
  const passivePerception = finalize(
    state,
    c,
    "passive:Perception",
    perception.value === null
      ? unknown("Perception nije poznat.")
      : { value: 10 + perception.value, parts: [{ label: "Osnova", value: 10 }, { label: "Perception", value: perception.value }], override: null, unknownBecause: null },
  );

  const passive = (skill: string): Derived => {
    const sk = skills[skill]!;
    return finalize(
      state,
      c,
      `passive:${skill}`,
      sk.value === null
        ? unknown(`${skill} nije poznat.`)
        : { value: 10 + sk.value, parts: [{ label: "Osnova", value: 10 }, { label: skill, value: sk.value }], override: null, unknownBecause: null },
    );
  };
  const passiveInsight = passive("Insight");
  const passiveInvestigation = passive("Investigation");

  const dex = mod("DEX");
  const initiative = finalize(
    state,
    c,
    "initiative",
    dex === null ? unknown("DEX nije poznat.") : { value: dex, parts: [{ label: "DEX modifikator", value: dex }], override: null, unknownBecause: null },
  );

  const armorClass = finalize(
    state,
    c,
    "ac",
    c.acBase === null
      ? unknown("Osnovni AC nije zabilježen; izračun iz opreme još nije podržan.")
      : { value: c.acBase, parts: [{ label: "Zabilježeni AC (oprema i značajke)", value: c.acBase }], override: null, unknownBecause: null },
  );

  const speed = finalize(
    state,
    c,
    "speed",
    c.speedFt === null ? unknown("Brzina nije zabilježena.") : { value: c.speedFt, parts: [{ label: "Zabilježena brzina (ft)", value: c.speedFt }], override: null, unknownBecause: null },
  );

  const castMod = c.spellcastingAbility ? mod(c.spellcastingAbility) : null;
  const castReady = c.spellcastingAbility !== null && castMod !== null && pbValue !== null;
  const spellSaveDc = finalize(
    state,
    c,
    "spellSaveDc",
    !castReady
      ? unknown(c.spellcastingAbility ? "Atribut čaranja ili proficiency nije poznat." : "Atribut čaranja nije zadan.")
      : { value: 8 + pbValue + castMod, parts: [{ label: "Osnova", value: 8 }, { label: "Proficiency", value: pbValue }, { label: `${c.spellcastingAbility} modifikator`, value: castMod }], override: null, unknownBecause: null },
  );
  const spellAttack = finalize(
    state,
    c,
    "spellAttack",
    !castReady
      ? unknown(c.spellcastingAbility ? "Atribut čaranja ili proficiency nije poznat." : "Atribut čaranja nije zadan.")
      : { value: pbValue + castMod, parts: [{ label: "Proficiency", value: pbValue }, { label: `${c.spellcastingAbility} modifikator`, value: castMod }], override: null, unknownBecause: null },
  );

  return {
    proficiencyBonus,
    abilities,
    saves,
    skills,
    passivePerception,
    passiveInsight,
    passiveInvestigation,
    initiative,
    armorClass,
    speed,
    spellSaveDc,
    spellAttack,
    notes: [
      "Maksimalni HP ne preračunava se automatski pri promjeni CON-a ili razine (zahtijeva odluku).",
      "AC se ne izvodi iz opreme dok ne postoji katalog predmeta; koristi se zabilježena vrijednost.",
    ],
  };
}
