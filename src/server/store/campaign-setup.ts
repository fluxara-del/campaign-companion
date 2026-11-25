import type { MemberRole } from "@/domain/authz";
import { RULESET } from "@/domain/rules";
import type { CharacterState, ResourcePoolState, WalletState } from "@/domain/state";
import type { Db } from "./connection";
import { writeBaseline } from "./replay";

export type CampaignSetup = {
  id: string;
  name: string;
  members: { actorId: string; role: MemberRole }[];
  characters: CharacterState[];
  resourcePools: ResourcePoolState[];
  wallets: WalletState[];
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
        `INSERT INTO "Character" (id, campaignId, name, hpCurrent, hpMax, hpTemp) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const c of setup.characters) insChar.run(c.id, setup.id, c.name, c.hpCurrent, c.hpMax, c.hpTemp);

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

      opts.extra?.(db);

      const { snapshotHash } = writeBaseline(db, setup.id, opts.source ?? "synthetic", now);
      return { baselineHash: snapshotHash };
    })
    .immediate();
}
