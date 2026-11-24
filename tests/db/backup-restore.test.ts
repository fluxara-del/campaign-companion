import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeMigrations,
  assertTestDatabasePath,
  checkIntegrity,
  createBackup,
  getAppliedMigrations,
  listBundledMigrations,
  restoreBackup,
  verifyBackup,
} from "@/server/db/sqlite-safety";

const root = path.resolve(import.meta.dirname, "..", "..");
const migrationsDir = path.join(root, "prisma", "migrations");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
let tmp: string;

/** Primjenjuje stvarne migracije iz repozitorija na novu privremenu bazu. */
function migrateFresh(dbPath: string): void {
  assertTestDatabasePath(dbPath, os.tmpdir());
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "kdz-db-test-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("migracije nad praznom bazom", () => {
  it("sve migracije se primjenjuju, baza je cjelovita i nema pending migracija", () => {
    const dbPath = path.join(tmp, "fresh.db");
    migrateFresh(dbPath);
    expect(checkIntegrity(dbPath).ok).toBe(true);
    const analysis = analyzeMigrations(dbPath, migrationsDir);
    expect(analysis.pending).toEqual([]);
    expect(analysis.applied).toEqual(listBundledMigrations(migrationsDir));
    expect(analysis.safeToApply).toBe(true);
  });
});

describe("sigurnosna kopija i restore", () => {
  it("kopija uključuje podatke iz WAL-a koji još nisu checkpointani", async () => {
    const dbPath = path.join(tmp, "wal.db");
    migrateFresh(dbPath);
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.prepare("INSERT INTO AppMeta(key, value, updatedAt) VALUES (?, ?, ?)").run("probni", "iz-wal-a", new Date().toISOString());
    expect(existsSync(dbPath + "-wal")).toBe(true);

    const manifest = await createBackup(dbPath, path.join(tmp, "backups"), "wal-test");
    db.close();

    const backupPath = path.join(tmp, "backups", manifest.backupFile);
    const copy = new Database(backupPath, { readonly: true });
    const row = copy.prepare("SELECT value FROM AppMeta WHERE key = 'probni'").get() as { value: string };
    copy.close();
    expect(row.value).toBe("iz-wal-a");
    expect(manifest.appliedMigrations).toEqual(listBundledMigrations(migrationsDir));
    expect(verifyBackup(backupPath).integrity.ok).toBe(true);
  });

  it("otkriva izmijenjenu (oštećenu) kopiju preko hasha iz manifesta", async () => {
    const dbPath = path.join(tmp, "tamper.db");
    migrateFresh(dbPath);
    const manifest = await createBackup(dbPath, path.join(tmp, "backups-t"), "tamper");
    const backupPath = path.join(tmp, "backups-t", manifest.backupFile);
    const bytes = readFileSync(backupPath);
    bytes[bytes.length - 10] = (bytes[bytes.length - 10]! + 1) % 256;
    writeFileSync(backupPath, bytes);
    expect(() => verifyBackup(backupPath)).toThrow(/Hash/);
  });

  it("restore vraća stanje i čuva prethodnu bazu umjesto brisanja", async () => {
    const dbPath = path.join(tmp, "live.db");
    migrateFresh(dbPath);
    const db = new Database(dbPath);
    db.prepare("INSERT INTO AppMeta(key, value, updatedAt) VALUES ('stanje', 'prije', ?)").run(new Date().toISOString());
    db.close();

    const manifest = await createBackup(dbPath, path.join(tmp, "backups-r"), "pre-change");
    const after = new Database(dbPath);
    after.prepare("UPDATE AppMeta SET value = 'poslije' WHERE key = 'stanje'").run();
    after.close();

    const result = restoreBackup(path.join(tmp, "backups-r", manifest.backupFile), dbPath);
    expect(result.previousMovedTo).not.toBeNull();
    expect(existsSync(result.previousMovedTo!)).toBe(true);

    const restored = new Database(dbPath, { readonly: true });
    expect((restored.prepare("SELECT value FROM AppMeta WHERE key='stanje'").get() as { value: string }).value).toBe("prije");
    restored.close();
    const previous = new Database(result.previousMovedTo!, { readonly: true });
    expect((previous.prepare("SELECT value FROM AppMeta WHERE key='stanje'").get() as { value: string }).value).toBe("poslije");
    previous.close();
  });

  it("odbija prepisati postojeću kopiju", async () => {
    const dbPath = path.join(tmp, "nooverwrite.db");
    migrateFresh(dbPath);
    const dir = path.join(tmp, "backups-n");
    const m = await createBackup(dbPath, dir, "x");
    expect(existsSync(path.join(dir, m.backupFile))).toBe(true);
    expect(m.integrity).toBe("ok");
  });
});

describe("procjena kompatibilnosti migracija", () => {
  function migrationsCopy(name: string): string {
    const dir = path.join(tmp, name);
    cpSync(migrationsDir, dir, { recursive: true });
    return dir;
  }

  it("pending aditivna migracija je sigurna za primjenu", () => {
    const dbPath = path.join(tmp, "pending.db");
    migrateFresh(dbPath);
    const dir = migrationsCopy("mig-additive");
    mkdirSync(path.join(dir, "29991231000000_add_table"));
    writeFileSync(path.join(dir, "29991231000000_add_table", "migration.sql"), 'CREATE TABLE "Novo" ("id" TEXT NOT NULL PRIMARY KEY);');
    const a = analyzeMigrations(dbPath, dir);
    expect(a.pending).toEqual(["29991231000000_add_table"]);
    expect(a.safeToApply).toBe(true);
  });

  it("neodobrena destruktivna migracija blokira primjenu", () => {
    const dbPath = path.join(tmp, "destructive.db");
    migrateFresh(dbPath);
    const dir = migrationsCopy("mig-destructive");
    mkdirSync(path.join(dir, "29991231000000_drop_meta"));
    writeFileSync(path.join(dir, "29991231000000_drop_meta", "migration.sql"), 'DROP TABLE "AppMeta";');
    const a = analyzeMigrations(dbPath, dir);
    expect(a.safeToApply).toBe(false);
    expect(a.destructivePending).toHaveLength(1);
  });

  it("starija verzija aplikacije je nekompatibilna s novije migriranom bazom (blokira rollback)", () => {
    const dbPath = path.join(tmp, "newer.db");
    migrateFresh(dbPath);
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('x', 'y', '29991231000000_future', datetime('now'), datetime('now'), 1)",
    ).run();
    db.close();
    const a = analyzeMigrations(dbPath, migrationsDir);
    expect(a.compatible).toBe(false);
    expect(a.unknownApplied).toEqual(["29991231000000_future"]);
    expect(getAppliedMigrations(dbPath).applied).toContain("29991231000000_future");
  });
});
