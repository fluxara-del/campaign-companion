import { deriveSheet, type CharacterSheetDerived } from "@/domain/derived";
import { DomainError } from "@/domain/errors";
import { getOwn } from "@/domain/records";
import { previewRest, type RestPreview } from "@/domain/rest";
import type {
  CharacterState,
  ConditionState,
  FeatureState,
  ItemState,
  ResourcePoolState,
  RollRequestState,
  SpellState,
  StatModifierState,
  WalletState,
} from "@/domain/state";
import type { Actor } from "./batch-service";
import type { Db } from "./connection";
import { loadHiddenHolderRefs, loadState, visibilityClause } from "./state-repo";

export type ItemNode = ItemState & { contents: ItemNode[] };

export type CharacterSheet = {
  campaignId: string;
  stateVersion: number;
  character: CharacterState;
  derived: CharacterSheetDerived;
  modifiers: StatModifierState[];
  resources: ResourcePoolState[];
  wallets: WalletState[];
  spells: SpellState[];
  features: FeatureState[];
  conditions: ConditionState[];
  concentration: { spellSelectionId: string; spellName: string } | null;
  pendingRolls: RollRequestState[];
  /** Predmeti koje lik drži (stablo spremnika). */
  inventory: ItemNode[];
  /** Mogući držatelji za transfer (likovi i NPC-evi), samo ID i naziv. */
  holders: { id: string; name: string }[];
  /** Spremnici koje lik drži (za premještanje u spremnik). */
  containers: { id: string; name: string }[];
  restPreview: { short: RestPreview; long: RestPreview };
};

const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name, "hr") || (a.id < b.id ? -1 : 1);

/**
 * Read model character sheeta. Samo čitanje, u jednoj read transakciji (jedna snimka);
 * ne sadrži DM bilješke ni dnevnik. Dostupno svakom članu kampanje (i vieweru).
 */
export function getCharacterSheet(db: Db, actor: Actor, campaignId: string, characterId: string): CharacterSheet {
  return db
    .transaction(() => {
      const member = db.prepare(`SELECT role FROM "Member" WHERE campaignId = ? AND actorId = ?`).get(campaignId, actor.actorId) as { role: string } | undefined;
      if (!member) throw new DomainError("forbidden", "Nemate pristup ovoj kampanji.");
      const state = loadState(db, campaignId);
      const character = getOwn(state.characters, characterId);
      const derived = deriveSheet(state, characterId);
      if (!character || !derived) throw new DomainError("not_found", "Lik ne postoji u ovoj kampanji.", { characterId });
      const { stateVersion } = db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(campaignId) as { stateVersion: number };

      // DM-only NPC-evi skrivaju se od ostalih uloga u odgovoru (baza ostaje nepromijenjena): predmet koji drži
      // takav NPC izostaje na svakoj razini stabla (i unutar vidljivog spremnika), a takav vlasnik postaje null.
      const hidden = member.role === "owner" ? new Set<string>() : loadHiddenHolderRefs(db, campaignId);
      const items = Object.values(state.items).filter((i) => i.holderRef === null || !hidden.has(i.holderRef));
      const visibleOwner = (ref: string | null) => (ref !== null && hidden.has(ref) ? null : ref);
      const tree = (parentId: string | null, holder: string | null): ItemNode[] =>
        items
          .filter((i) => (parentId ? i.containerItemId === parentId : i.containerItemId === null && i.holderRef === holder))
          .sort(byName)
          .map((i) => ({ ...i, ownerRef: visibleOwner(i.ownerRef), contents: tree(i.id, holder) }));
      const inventory = tree(null, characterId);
      const flatten = (nodes: ItemNode[]): ItemNode[] => nodes.flatMap((n) => [n, ...flatten(n.contents)]);
      const containers = flatten(inventory)
        .filter((i) => items.some((x) => x.containerItemId === i.id) || /backpack|ruksak|torb|pouch|kutij|amulet/i.test(i.name))
        .map((i) => ({ id: i.id, name: i.name }));

      // DM-only NPC-evi vidljivi su samo vlasniku (DM-u); ostalim članovima se ne vraćaju ni ID ni naziv.
      const npcs = db
        .prepare(`SELECT id, name FROM "EntityRecord" WHERE campaignId = ? AND kind = 'npc' AND ${visibilityClause(member.role)} ORDER BY name`)
        .all(campaignId) as { id: string; name: string }[];
      const conc = getOwn(state.concentration, characterId);

      return {
        campaignId,
        stateVersion,
        character,
        derived,
        modifiers: Object.values(state.modifiers).filter((m) => m.characterId === characterId),
        resources: Object.values(state.resourcePools).filter((p) => p.characterId === characterId).sort((a, b) => (a.resourceKey < b.resourceKey ? -1 : 1)),
        wallets: Object.values(state.wallets).filter((w) => w.ownerCharacterId === characterId || w.ownerCharacterId === null),
        spells: Object.values(state.spells).filter((s) => s.characterId === characterId).sort(byName),
        features: Object.values(state.features).filter((f) => f.characterId === characterId).sort(byName),
        conditions: Object.values(state.conditions).filter((c) => c.characterId === characterId).sort(byName),
        concentration: conc ? { spellSelectionId: conc.spellSelectionId, spellName: getOwn(state.spells, conc.spellSelectionId)?.name ?? conc.spellSelectionId } : null,
        pendingRolls: Object.values(state.rollRequests).filter((r) => r.characterId === characterId && r.status === "pending"),
        inventory,
        holders: [...Object.values(state.characters).map((c) => ({ id: c.id, name: c.name })), ...npcs],
        containers,
        restPreview: { short: previewRest(state, characterId, "short")!, long: previewRest(state, characterId, "long")! },
      };
    })
    .deferred();
}
