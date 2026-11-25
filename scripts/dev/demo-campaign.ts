import type { CampaignSetup } from "../../src/server/store/campaign-setup";

/** Sintetička demo kampanja (bez stvarnih podataka) za lokalni razvoj i e2e testove. */
export function demoCampaign(id: string, ownerActorId = "owner"): CampaignSetup {
  const pc = `${id}-PC`;
  return {
    id,
    name: `Demo ${id}`,
    members: [{ actorId: ownerActorId, role: "owner" }],
    characters: [
      {
        id: pc,
        name: "Demo Paladin",
        hpCurrent: 22,
        hpMax: 22,
        hpTemp: 0,
        level: 2,
        speedFt: 30,
        acBase: 19,
        spellcastingAbility: "CHA",
        abilities: { STR: 17, DEX: 10, CON: 13, INT: 8, WIS: 13, CHA: 14 },
        saveProficiencies: ["CHA", "WIS"],
        skillProficiencies: { Athletics: "proficient", Perception: "proficient", Persuasion: "proficient" },
      },
    ],
    resourcePools: [
      { id: `${pc}:spell-slot-1`, characterId: pc, resourceKey: "spell-slot-1", current: 2, max: 2, rechargePolicy: "long_rest" },
      { id: `${pc}:free-divine-smite`, characterId: pc, resourceKey: "free-divine-smite", current: 1, max: 1, rechargePolicy: "long_rest" },
      { id: `${pc}:lay-on-hands`, characterId: pc, resourceKey: "lay-on-hands", current: 10, max: 10, rechargePolicy: null },
      { id: `${pc}:heroic-inspiration`, characterId: pc, resourceKey: "heroic-inspiration", current: null, max: null, rechargePolicy: null },
    ],
    wallets: [
      { id: `${pc}:wallet:personal`, ownerCharacterId: pc, purpose: "personal", label: "Osobni novac", currency: "cp", amountMinor: 2100 },
      { id: `${id}:wallet:group-1`, ownerCharacterId: null, purpose: "group_dedicated", label: "Namjenski fond", currency: "cp", amountMinor: 500 },
    ],
    modifiers: [{ id: `${pc}:bonus:initiative`, characterId: pc, target: "initiative", kind: "bonus", value: 2, source: "Alert", reason: "Talent" }],
    spells: [
      { id: `${pc}:spell:bless`, characterId: pc, name: "Bless", spellLevel: 1, known: true, prepared: true, alwaysPrepared: false, concentration: true },
      { id: `${pc}:spell:cure-wounds`, characterId: pc, name: "Cure Wounds", spellLevel: 1, known: true, prepared: false, alwaysPrepared: false, concentration: false },
      { id: `${pc}:spell:divine-smite`, characterId: pc, name: "Divine Smite", spellLevel: 1, known: true, prepared: true, alwaysPrepared: true, concentration: false },
    ],
    features: [{ id: `${pc}:feature:lay-on-hands`, characterId: pc, name: "Lay on Hands", kind: "active", resourcePoolId: `${pc}:lay-on-hands`, note: null }],
    conditions: [],
    items: [
      { id: `${pc}:item:pack`, name: "Ruksak", quantity: 1, ownerRef: pc, holderRef: pc, location: null, containerItemId: null, equipped: null },
      { id: `${pc}:item:dagger`, name: "Bodež", quantity: 1, ownerRef: pc, holderRef: pc, location: null, containerItemId: `${pc}:item:pack`, equipped: false },
      { id: `${pc}:item:sword`, name: "Mač", quantity: 1, ownerRef: pc, holderRef: pc, location: null, containerItemId: null, equipped: true },
    ],
  };
}
