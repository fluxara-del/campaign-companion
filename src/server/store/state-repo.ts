import type { CampaignState, CharacterState, ResourcePoolState, WalletState } from "@/domain/state";
import { getOwn, setOwn } from "@/domain/records";
import type { Db } from "./connection";

type CharacterRow = { id: string; name: string; hpCurrent: number; hpMax: number | null; hpTemp: number };
type PoolRow = {
  id: string;
  characterId: string;
  resourceKey: string;
  current: number | null;
  max: number | null;
  rechargePolicy: ResourcePoolState["rechargePolicy"];
};
type WalletRow = {
  id: string;
  ownerCharacterId: string | null;
  purpose: WalletState["purpose"];
  label: string;
  currency: string;
  amountMinor: number | null;
};

/** Učitava kanonsko mehaničko stanje kampanje (sortirano po ID-u radi determinizma). */
export function loadState(db: Db, campaignId: string): CampaignState {
  const characters: Record<string, CharacterState> = {};
  for (const r of db
    .prepare(`SELECT id, name, hpCurrent, hpMax, hpTemp FROM "Character" WHERE campaignId = ? ORDER BY id`)
    .all(campaignId) as CharacterRow[]) {
    setOwn(characters, r.id, { id: r.id, name: r.name, hpCurrent: r.hpCurrent, hpMax: r.hpMax, hpTemp: r.hpTemp });
  }

  const resourcePools: Record<string, ResourcePoolState> = {};
  for (const r of db
    .prepare(
      `SELECT id, characterId, resourceKey, current, max, rechargePolicy FROM "ResourcePool" WHERE campaignId = ? ORDER BY id`,
    )
    .all(campaignId) as PoolRow[]) {
    setOwn(resourcePools, r.id, { ...r });
  }

  const wallets: Record<string, WalletState> = {};
  for (const r of db
    .prepare(
      `SELECT id, ownerCharacterId, purpose, label, currency, amountMinor FROM "Wallet" WHERE campaignId = ? ORDER BY id`,
    )
    .all(campaignId) as WalletRow[]) {
    setOwn(wallets, r.id, { ...r });
  }

  return { campaignId, characters, resourcePools, wallets };
}

/**
 * Zapisuje samo promijenjena mehanička polja. Domena u Fazi 1 ne stvara ni ne briše
 * entitete; svaki pokušaj toga je programska pogreška.
 */
export function persistChanges(db: Db, before: CampaignState, after: CampaignState): void {
  const sameKeys = (a: object, b: object) =>
    Object.keys(a).sort().join("|") === Object.keys(b).sort().join("|");
  if (
    !sameKeys(before.characters, after.characters) ||
    !sameKeys(before.resourcePools, after.resourcePools) ||
    !sameKeys(before.wallets, after.wallets)
  ) {
    throw new Error("Domena je pokušala dodati ili ukloniti entitet; nije podržano u Fazi 1.");
  }

  const updChar = db.prepare(
    `UPDATE "Character" SET hpCurrent = ?, hpTemp = ? WHERE campaignId = ? AND id = ?`,
  );
  for (const [id, c] of Object.entries(after.characters)) {
    const b = getOwn(before.characters, id)!;
    if (b.hpMax !== c.hpMax || b.name !== c.name) throw new Error("Neočekivana promjena polja lika.");
    if (b.hpCurrent !== c.hpCurrent || b.hpTemp !== c.hpTemp) {
      const res = updChar.run(c.hpCurrent, c.hpTemp, after.campaignId, id);
      if (res.changes !== 1) throw new Error(`Ažuriranje lika ${id} nije uspjelo.`);
    }
  }

  const updPool = db.prepare(`UPDATE "ResourcePool" SET current = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, p] of Object.entries(after.resourcePools)) {
    const b = getOwn(before.resourcePools, id)!;
    if (b.current !== p.current) {
      const res = updPool.run(p.current, after.campaignId, id);
      if (res.changes !== 1) throw new Error(`Ažuriranje resursa ${id} nije uspjelo.`);
    }
  }

  const updWallet = db.prepare(`UPDATE "Wallet" SET amountMinor = ? WHERE campaignId = ? AND id = ?`);
  for (const [id, w] of Object.entries(after.wallets)) {
    const b = getOwn(before.wallets, id)!;
    if (b.amountMinor !== w.amountMinor) {
      const res = updWallet.run(w.amountMinor, after.campaignId, id);
      if (res.changes !== 1) throw new Error(`Ažuriranje novčanika ${id} nije uspjelo.`);
    }
  }
}
