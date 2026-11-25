import { getOwn, setOwn } from "@/domain/records";
import {
  ABILITIES,
  SNAPSHOT_FORMAT,
  type Ability,
  type CampaignState,
  type CharacterState,
  type ConcentrationState,
  type ConditionState,
  type FeatureState,
  type ItemState,
  type ResourcePoolState,
  type RollRequestState,
  type SpellState,
  type StatModifierState,
  type WalletState,
} from "@/domain/state";
import type { Db } from "./connection";

const AB_COL: Record<Ability, string> = { STR: "abStr", DEX: "abDex", CON: "abCon", INT: "abInt", WIS: "abWis", CHA: "abCha" };

type CharacterRow = {
  id: string;
  name: string;
  hpCurrent: number;
  hpMax: number | null;
  hpTemp: number;
  level: number | null;
  speedFt: number | null;
  acBase: number | null;
  spellcastingAbility: Ability | null;
  abStr: number | null;
  abDex: number | null;
  abCon: number | null;
  abInt: number | null;
  abWis: number | null;
  abCha: number | null;
  saveProficienciesJson: string;
  skillProficienciesJson: string;
};

function rowsById<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) setOwn(out, r.id, r);
  return out;
}

const toBool = (v: number | null): boolean | null => (v === null ? null : v === 1);

/** Učitava kanonsko mehaničko stanje kampanje (sortirano po ID-u radi determinizma). */
export function loadState(db: Db, campaignId: string): CampaignState {
  const characters: Record<string, CharacterState> = {};
  for (const r of db.prepare(`SELECT * FROM "Character" WHERE campaignId = ? ORDER BY id`).all(campaignId) as CharacterRow[]) {
    const abilities = {} as Record<Ability, number | null>;
    for (const a of ABILITIES) abilities[a] = r[AB_COL[a] as keyof CharacterRow] as number | null;
    setOwn(characters, r.id, {
      id: r.id,
      name: r.name,
      hpCurrent: r.hpCurrent,
      hpMax: r.hpMax,
      hpTemp: r.hpTemp,
      level: r.level,
      speedFt: r.speedFt,
      acBase: r.acBase,
      spellcastingAbility: r.spellcastingAbility,
      abilities,
      saveProficiencies: [...new Set(JSON.parse(r.saveProficienciesJson) as Ability[])].sort(),
      skillProficiencies: JSON.parse(r.skillProficienciesJson) as CharacterState["skillProficiencies"],
    });
  }

  const resourcePools = rowsById(
    db.prepare(`SELECT id, characterId, resourceKey, current, max, rechargePolicy FROM "ResourcePool" WHERE campaignId = ? ORDER BY id`).all(campaignId) as ResourcePoolState[],
  );
  const wallets = rowsById(
    db.prepare(`SELECT id, ownerCharacterId, purpose, label, currency, amountMinor FROM "Wallet" WHERE campaignId = ? ORDER BY id`).all(campaignId) as WalletState[],
  );
  const modifiers = rowsById(
    db.prepare(`SELECT id, characterId, target, kind, value, source, reason FROM "StatModifier" WHERE campaignId = ? ORDER BY id`).all(campaignId) as StatModifierState[],
  );
  const spells = rowsById(
    (
      db
        .prepare(`SELECT id, characterId, name, spellLevel, known, prepared, alwaysPrepared, concentration FROM "SpellSelection" WHERE campaignId = ? ORDER BY id`)
        .all(campaignId) as (Omit<SpellState, "known" | "prepared" | "alwaysPrepared" | "concentration"> & Record<"known" | "prepared" | "alwaysPrepared" | "concentration", number | null>)[]
    ).map((r) => ({ ...r, known: r.known === 1, prepared: r.prepared === 1, alwaysPrepared: r.alwaysPrepared === 1, concentration: toBool(r.concentration) })),
  );
  const features = rowsById(
    db.prepare(`SELECT id, characterId, name, kind, resourcePoolId, note FROM "FeatureInstance" WHERE campaignId = ? ORDER BY id`).all(campaignId) as FeatureState[],
  );
  const conditions = rowsById(
    db.prepare(`SELECT id, characterId, name, source, durationNote FROM "ActiveCondition" WHERE campaignId = ? ORDER BY id`).all(campaignId) as ConditionState[],
  );
  const concentration: Record<string, ConcentrationState> = {};
  for (const r of db.prepare(`SELECT characterId, spellSelectionId, instanceId FROM "Concentration" WHERE campaignId = ? ORDER BY characterId`).all(campaignId) as ConcentrationState[]) {
    setOwn(concentration, r.characterId, r);
  }
  const rollRequests = rowsById(
    db.prepare(`SELECT id, characterId, kind, dc, reason, status, total, outcome, concentrationInstanceId FROM "RollRequest" WHERE campaignId = ? ORDER BY id`).all(campaignId) as RollRequestState[],
  );
  const items = rowsById(
    (
      db
        .prepare(`SELECT id, name, quantity, ownerRef, holderRef, location, containerItemId, equipped FROM "ItemInstance" WHERE campaignId = ? ORDER BY id`)
        .all(campaignId) as (Omit<ItemState, "equipped"> & { equipped: number | null })[]
    ).map((r) => ({ ...r, equipped: toBool(r.equipped) })),
  );

  return { format: SNAPSHOT_FORMAT, campaignId, characters, resourcePools, wallets, modifiers, spells, features, conditions, concentration, rollRequests, items };
}

/** SQL uvjet vidljivosti zapisa registra za ulogu: vlasnik (DM) vidi sve, ostali samo player/shared. */
export function visibilityClause(role: string): string {
  return role === "owner" ? "1 = 1" : "visibility IN ('player', 'shared')";
}

/**
 * ID-jevi dopuštenih držatelja predmeta: likovi i NPC-evi kampanje koje uloga smije vidjeti
 * (NPC vidljiv samo DM-u ne može biti cilj transfera igrača ni se otkriti kroz pogrešku).
 */
export function loadKnownHolderRefs(db: Db, campaignId: string, role: string): Set<string> {
  const ids = db
    .prepare(
      `SELECT id FROM "Character" WHERE campaignId = ? UNION SELECT id FROM "EntityRecord" WHERE campaignId = ? AND kind = 'npc' AND ${visibilityClause(role)}`,
    )
    .all(campaignId, campaignId) as { id: string }[];
  return new Set(ids.map((r) => r.id));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysEqual = (a: object, b: object) => Object.keys(a).sort().join("|") === Object.keys(b).sort().join("|");

function mustUpdate(res: { changes: number }, what: string) {
  if (res.changes !== 1) throw new Error(`Ažuriranje (${what}) nije uspjelo.`);
}

/**
 * Zapisuje razliku između stanja prije i poslije pravila. Domena smije mijenjati samo
 * dopuštena polja; dodavanje ili brisanje entiteta dopušteno je samo za overrideove,
 * uvjete, koncentraciju i zahtjeve za bacanje. Sve ostalo je programska pogreška.
 */
export function persistChanges(db: Db, before: CampaignState, after: CampaignState): void {
  const cid = after.campaignId;
  for (const name of ["characters", "resourcePools", "wallets", "spells", "features", "items"] as const) {
    if (!keysEqual(before[name], after[name])) throw new Error(`Domena ne smije dodavati ni uklanjati: ${name}.`);
  }

  // Likovi
  const updChar = db.prepare(
    `UPDATE "Character" SET hpCurrent = ?, hpTemp = ?, abStr = ?, abDex = ?, abCon = ?, abInt = ?, abWis = ?, abCha = ? WHERE campaignId = ? AND id = ?`,
  );
  for (const [id, c] of Object.entries(after.characters)) {
    const b = getOwn(before.characters, id)!;
    const fixed = (x: CharacterState) => [x.name, x.hpMax, x.level, x.speedFt, x.acBase, x.spellcastingAbility, x.saveProficiencies, x.skillProficiencies];
    if (!same(fixed(b), fixed(c))) throw new Error("Neočekivana promjena polja lika.");
    if (b.hpCurrent !== c.hpCurrent || b.hpTemp !== c.hpTemp || !same(b.abilities, c.abilities)) {
      mustUpdate(updChar.run(c.hpCurrent, c.hpTemp, ...ABILITIES.map((a) => c.abilities[a]), cid, id), `lik ${id}`);
    }
  }

  const updPool = db.prepare(`UPDATE "ResourcePool" SET current = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, p] of Object.entries(after.resourcePools)) {
    const b = getOwn(before.resourcePools, id)!;
    if (!same({ ...b, current: 0 }, { ...p, current: 0 })) throw new Error("Neočekivana promjena resursa.");
    if (b.current !== p.current) mustUpdate(updPool.run(p.current, cid, id), `resurs ${id}`);
  }

  const updWallet = db.prepare(`UPDATE "Wallet" SET amountMinor = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, w] of Object.entries(after.wallets)) {
    const b = getOwn(before.wallets, id)!;
    if (b.amountMinor !== w.amountMinor) mustUpdate(updWallet.run(w.amountMinor, cid, id), `novčanik ${id}`);
  }

  const updSpell = db.prepare(`UPDATE "SpellSelection" SET spellLevel = ?, prepared = ?, concentration = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, sp] of Object.entries(after.spells)) {
    const b = getOwn(before.spells, id)!;
    if (!same(b, sp)) {
      if (b.name !== sp.name || b.known !== sp.known || b.alwaysPrepared !== sp.alwaysPrepared) throw new Error("Neočekivana promjena čarolije.");
      mustUpdate(updSpell.run(sp.spellLevel, sp.prepared ? 1 : 0, sp.concentration === null ? null : sp.concentration ? 1 : 0, cid, id), `čarolija ${id}`);
    }
  }

  for (const [id, f] of Object.entries(after.features)) {
    if (!same(getOwn(before.features, id), f)) throw new Error("Neočekivana promjena značajke.");
  }

  const updItem = db.prepare(`UPDATE "ItemInstance" SET holderRef = ?, containerItemId = ?, location = ?, equipped = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, it] of Object.entries(after.items)) {
    const b = getOwn(before.items, id)!;
    if (!same(b, it)) {
      if (b.name !== it.name || b.quantity !== it.quantity || b.ownerRef !== it.ownerRef) throw new Error("Neočekivana promjena predmeta.");
      mustUpdate(updItem.run(it.holderRef, it.containerItemId, it.location, it.equipped === null ? null : it.equipped ? 1 : 0, cid, id), `predmet ${id}`);
    }
  }

  // Overrideovi (dodavanje, izmjena, uklanjanje)
  for (const [id, b] of Object.entries(before.modifiers)) {
    if (!getOwn(after.modifiers, id)) mustUpdate(db.prepare(`DELETE FROM "StatModifier" WHERE campaignId = ? AND id = ?`).run(cid, id), `brisanje ${b.target}`);
  }
  for (const [id, m] of Object.entries(after.modifiers)) {
    const b = getOwn(before.modifiers, id);
    if (!b) {
      db.prepare(`INSERT INTO "StatModifier" (id, campaignId, characterId, target, kind, value, source, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, cid, m.characterId, m.target, m.kind, m.value, m.source, m.reason,
      );
    } else if (!same(b, m)) {
      mustUpdate(db.prepare(`UPDATE "StatModifier" SET value = ?, reason = ?, source = ? WHERE campaignId = ? AND id = ?`).run(m.value, m.reason, m.source, cid, id), `override ${id}`);
    }
  }

  // Uvjeti
  for (const id of Object.keys(before.conditions)) {
    if (!getOwn(after.conditions, id)) mustUpdate(db.prepare(`DELETE FROM "ActiveCondition" WHERE campaignId = ? AND id = ?`).run(cid, id), `uvjet ${id}`);
  }
  for (const [id, c] of Object.entries(after.conditions)) {
    if (!getOwn(before.conditions, id)) {
      db.prepare(`INSERT INTO "ActiveCondition" (id, campaignId, characterId, name, source, durationNote) VALUES (?, ?, ?, ?, ?, ?)`).run(id, cid, c.characterId, c.name, c.source, c.durationNote);
    } else if (!same(getOwn(before.conditions, id), c)) throw new Error("Neočekivana promjena uvjeta.");
  }

  // Koncentracija (nikad UPDATE: završetak i nova koncentracija)
  for (const [charId, b] of Object.entries(before.concentration)) {
    const a = getOwn(after.concentration, charId);
    if (!a || a.instanceId !== b.instanceId) {
      mustUpdate(db.prepare(`DELETE FROM "Concentration" WHERE campaignId = ? AND characterId = ?`).run(cid, charId), `koncentracija ${charId}`);
    }
  }
  for (const [charId, a] of Object.entries(after.concentration)) {
    const b = getOwn(before.concentration, charId);
    if (!b || b.instanceId !== a.instanceId) {
      db.prepare(`INSERT INTO "Concentration" (campaignId, characterId, spellSelectionId, instanceId) VALUES (?, ?, ?, ?)`).run(cid, charId, a.spellSelectionId, a.instanceId);
    }
  }

  // Zahtjevi za bacanje (dodavanje i rješavanje)
  for (const [id, r] of Object.entries(after.rollRequests)) {
    const b = getOwn(before.rollRequests, id);
    if (!b) {
      db.prepare(`INSERT INTO "RollRequest" (id, campaignId, characterId, kind, dc, reason, status, total, outcome, concentrationInstanceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, cid, r.characterId, r.kind, r.dc, r.reason, r.status, r.total, r.outcome, r.concentrationInstanceId,
      );
    } else if (!same(b, r)) {
      mustUpdate(db.prepare(`UPDATE "RollRequest" SET status = ?, total = ?, outcome = ? WHERE campaignId = ? AND id = ?`).run(r.status, r.total, r.outcome, cid, id), `zahtjev ${id}`);
    }
  }
  for (const id of Object.keys(before.rollRequests)) {
    if (!getOwn(after.rollRequests, id)) throw new Error("Zahtjevi za bacanje se ne brišu.");
  }
}
