import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "@/server/db/sqlite-safety";
import { executeBatch } from "@/server/store/batch-service";
import { openDatabase } from "@/server/store/connection";
import { verifyReplay } from "@/server/store/replay";
import { loadState } from "@/server/store/state-repo";
import { batch, C1, C2, cmd, createTemplate, freshDb, OWNER, seed } from "./helpers";

let tpl: ReturnType<typeof createTemplate>;
beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => tpl.cleanup());

const PC = `${C1}-PC-001`;

function play(db: ReturnType<typeof openDatabase>, n: number): void {
  for (let v = 0; v < n; v++) {
    executeBatch(
      db,
      OWNER,
      batch(
        [
          cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: null }),
          cmd("ApplyHealing", { characterId: PC, amount: 1 }),
          cmd("AppendJournalNote", { title: null, text: `Potez ${v}`, visibility: "player" }),
        ],
        { expectedStateVersion: v },
      ),
    );
  }
}

describe("Baza odbija nevaljane veze i izmjene povijesti", () => {
  it("resurs ne može pripadati liku druge kampanje (složeni strani ključ)", () => {
    const { db } = freshDb(tpl);
    seed(db);
    expect(() =>
      db
        .prepare(`INSERT INTO "ResourcePool" (id, campaignId, characterId, resourceKey, current, max) VALUES ('x', ?, ?, 'k', 1, 1)`)
        .run(C1, `${C2}-PC-001`),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .prepare(`INSERT INTO "Wallet" (id, campaignId, ownerCharacterId, purpose, label, amountMinor) VALUES ('w', ?, ?, 'personal', 'x', 1)`)
        .run(C1, `${C2}-PC-001`),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("događaji, receipti i indeks naredbi su append-only", () => {
    const { db } = freshDb(tpl);
    seed(db);
    play(db, 1);
    for (const sql of [
      `UPDATE "DomainEvent" SET payloadJson = '{}'`,
      `DELETE FROM "DomainEvent"`,
      `UPDATE "BatchReceipt" SET requestHash = 'x'`,
      `DELETE FROM "BatchReceipt"`,
      `DELETE FROM "CommandIndex"`,
      `UPDATE "CampaignBaseline" SET snapshotHash = 'x'`,
    ]) {
      expect(() => db.exec(sql), sql).toThrow(/nepromjenjiv/);
    }
    expect(() => db.exec(`UPDATE "Character" SET campaignId = '${C2}'`)).toThrow(/nepromjenjiv/);
    expect(() => db.exec(`UPDATE "Campaign" SET stateVersion = 0 WHERE id = '${C1}'`)).toThrow(/ne smiju padati/);
    db.close();
  });

  it("CHECK ograničenja: negativni HP, prekoračen maksimum, osobni novčanik bez vlasnika", () => {
    const { db } = freshDb(tpl);
    seed(db);
    expect(() => db.exec(`UPDATE "Character" SET hpCurrent = -1`)).toThrow(/CHECK/);
    expect(() => db.exec(`UPDATE "Character" SET hpCurrent = 999`)).toThrow(/CHECK/);
    expect(() => db.exec(`UPDATE "ResourcePool" SET current = -1 WHERE id = '${C1}-slot-1'`)).toThrow(/CHECK/);
    expect(() =>
      db.exec(`INSERT INTO "Wallet" (id, campaignId, ownerCharacterId, purpose, label, amountMinor) VALUES ('w2', '${C1}', NULL, 'personal', 'x', 1)`),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe("Replay od baseline-a", () => {
  it("daje isti hash kanonskog snapshot-a i istu verziju", () => {
    const { db } = freshDb(tpl);
    seed(db);
    play(db, 5);
    const r = verifyReplay(db, C1);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.eventsReplayed).toBe(15);
    expect(r.liveStateVersion).toBe(5);
    expect(r.replayHash).toBe(r.liveHash);
    expect(verifyReplay(db, C2).ok).toBe(true);
    db.close();
  });

  it("otkriva promjenu stanja izvan domenskog servisa", () => {
    const { db } = freshDb(tpl);
    seed(db);
    play(db, 2);
    db.exec(`UPDATE "Character" SET hpTemp = 3 WHERE id = '${PC}'`);
    const r = verifyReplay(db, C1);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/Hash živog stanja/);
    db.close();
  });
});

describe("Restore sintetičke baze", () => {
  it("vraća isto stanje i verziju, a replay nakon restorea prolazi", async () => {
    const { db, file } = freshDb(tpl);
    seed(db);
    play(db, 3);
    const stateAtBackup = loadState(db, C1);
    db.pragma("wal_checkpoint(PASSIVE)");
    const backupDir = path.join(tpl.dir, "backups-f1");
    mkdirSync(backupDir, { recursive: true });
    const manifest = await createBackup(file, backupDir, "f1");

    play2(db);
    expect(loadState(db, C1)).not.toEqual(stateAtBackup);
    db.close();

    restoreBackup(path.join(backupDir, manifest.backupFile), file);
    const restored = openDatabase(file);
    expect(loadState(restored, C1)).toEqual(stateAtBackup);
    expect(verifyReplay(restored, C1).ok).toBe(true);
    expect((restored.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(C1) as { stateVersion: number }).stateVersion).toBe(3);
    restored.close();
  });
});

function play2(db: ReturnType<typeof openDatabase>): void {
  executeBatch(db, OWNER, batch([cmd("ApplyDamage", { characterId: PC, amount: 4, damageType: null })], { expectedStateVersion: 3 }));
}
