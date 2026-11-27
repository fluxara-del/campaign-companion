import type { MemberRole } from "@/domain/authz";
import { RULESET } from "@/domain/rules";
import { ABILITIES, type CharacterState, type ConditionState, type FeatureState, type ItemState, type ResourcePoolState, type SpellState, type StatModifierState, type WalletState } from "@/domain/state";
import type { Db } from "./connection";
import { writeBaseline } from "./replay";

export type CampaignSetup = {
  id: string;
  name: string;
  members: { actorId: string; role: MemberRole }[];
  characters: CharacterState[];
  resourcePools: ResourcePoolState[];
  wallets: WalletState[];
  modifiers?: StatModifierState[];
  spells?: SpellState[];
  features?: FeatureState[];
  conditions?: ConditionState[];
  /** Predmeti za sintetičke kampanje; uvoz upisuje predmete s izvornim atributima kroz `extra`. */
  items?: ItemState[];
};

/**
 * Stvara kampanju s početnim stanjem i baseline-om u jednoj transakciji.
 * Koristi se za sintetičke kampanje (testovi) i, u Fazi 2, za provjereni uvoz.
 * Nije domenska naredba: početno stanje nije promjena, nego polazište replaya.
 */
export function createCampaign(
  db: Db,
  setup: CampaignSetup,
  opts: {
    now?: string;
    source?: "synthetic" | "import";
    /** Dodatni upisi (npr. uvezeni predmeti, legacy događaji) u istoj transakciji, prije baseline-a. */
    extra?: (db: Db) => void;
  } = {},
): { baselineHash: string } {
  const now = opts.now ?? new Date().toISOString();
  return db
    .transaction(() => {
      db.prepare(
        `INSERT INTO "Campaign" (id, name, rulesetId, rulesetVersion, stateVersion, lastEventSeq, createdAt) VALUES (?, ?, ?, ?, 0, 0, ?)`,
      ).run(setup.id, setup.name, RULESET.id, RULESET.version, now);

      const insMember = db.prepare(`INSERT INTO "Member" (campaignId, actorId, role, createdAt) VALUES (?, ?, ?, ?)`);
      for (const m of setup.members) insMember.run(setup.id, m.actorId, m.role, now);

      const insChar = db.prepare(
        `INSERT INTO "Character" (id, campaignId, name, hpCurrent, hpMax, hpTemp, level, speedFt, acBase, spellcastingAbility, abStr, abDex, abCon, abInt, abWis, abCha, saveProficienciesJson, skillProficienciesJson, unknownTotalsJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of setup.characters) {
        insChar.run(
          c.id, setup.id, c.name, c.hpCurrent, c.hpMax, c.hpTemp, c.level, c.speedFt, c.acBase, c.spellcastingAbility,
          ...ABILITIES.map((a) => c.abilities[a]),
          JSON.stringify([...new Set(c.saveProficiencies)].sort()),
          JSON.stringify(c.skillProficiencies),
          JSON.stringify([...new Set(c.unknownTotals)].sort()),
        );
      }

      const insPool = db.prepare(
        `INSERT INTO "ResourcePool" (id, campaignId, characterId, resourceKey, current, max, rechargePolicy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of setup.resourcePools) {
        insPool.run(p.id, setup.id, p.characterId, p.resourceKey, p.current, p.max, p.rechargePolicy);
      }

      const insWallet = db.prepare(
        `INSERT INTO "Wallet" (id, campaignId, ownerCharacterId, purpose, label, currency, amountMinor) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const w of setup.wallets) {
        insWallet.run(w.id, setup.id, w.ownerCharacterId, w.purpose, w.label, w.currency, w.amountMinor);
      }

      const b = (v: boolean | null) => (v === null ? null : v ? 1 : 0);
      for (const m of setup.modifiers ?? []) {
        db.prepare(`INSERT INTO "StatModifier" (id, campaignId, characterId, target, kind, value, source, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(m.id, setup.id, m.characterId, m.target, m.kind, m.value, m.source, m.reason);
      }
      for (const sp of setup.spells ?? []) {
        db.prepare(`INSERT INTO "SpellSelection" (id, campaignId, characterId, name, spellLevel, known, prepared, alwaysPrepared, concentration, sourceRef) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
          sp.id, setup.id, sp.characterId, sp.name, sp.spellLevel, b(sp.known), b(sp.prepared), b(sp.alwaysPrepared), b(sp.concentration),
        );
      }
      for (const f of setup.features ?? []) {
        db.prepare(`INSERT INTO "FeatureInstance" (id, campaignId, characterId, name, kind, resourcePoolId, note, sourceRef) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).run(f.id, setup.id, f.characterId, f.name, f.kind, f.resourcePoolId, f.note);
      }
      for (const c of setup.conditions ?? []) {
        db.prepare(`INSERT INTO "ActiveCondition" (id, campaignId, characterId, name, source, durationNote) VALUES (?, ?, ?, ?, ?, ?)`).run(c.id, setup.id, c.characterId, c.name, c.source, c.durationNote);
      }
      const insItem = db.prepare(
        `INSERT INTO "ItemInstance" (id, campaignId, name, quantity, ownerRef, holderRef, location, containerItemId, equipped, attuned, massLbTenths, stateNote, attributesJson, sourceRef) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, '{}', 'synthetic')`,
      );
      for (const it of setup.items ?? []) insItem.run(it.id, setup.id, it.name, it.quantity, it.ownerRef, it.holderRef, it.location, b(it.equipped));
      for (const it of setup.items ?? []) {
        if (it.containerItemId) db.prepare(`UPDATE "ItemInstance" SET containerItemId = ? WHERE campaignId = ? AND id = ?`).run(it.containerItemId, setup.id, it.id);
      }

      opts.extra?.(db);

      const { snapshotHash } = writeBaseline(db, setup.id, opts.source ?? "synthetic", now);
      return { baselineHash: snapshotHash };
    })
    .immediate();
}
