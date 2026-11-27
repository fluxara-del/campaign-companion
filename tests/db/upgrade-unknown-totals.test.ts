import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveSheet } from "@/domain/derived";
import { assertTestDatabasePath } from "@/server/db/sqlite-safety";
import { executeBatch } from "@/server/store/batch-service";
import { openDatabase, type Db } from "@/server/store/connection";
import { snapshotHash, verifyReplay } from "@/server/store/replay";
import { loadState } from "@/server/store/state-repo";
import { batch, C1, cmd, createTemplate, freshDb, OWNER, seed, syntheticSetup } from "./helpers";

/**
 * SR-02 za migraciju 20261127170000_character_unknown_totals: sintetička baza prethodne verzije
 * (migracije do Faze 3, bez stupca unknownTotalsJson) s likovima, događajima i baselineom
 * nadograđuje se novom migracijom. Sve se radi u os.tmpdir(); stvarne baze se ne diraju.
 */
const root = path.resolve(import.meta.dirname, "..", "..");
const migrationsDir = path.join(root, "prisma", "migrations");
const NEW_MIGRATION = "20261127170000_character_unknown_totals";
const PC = syntheticSetup().characters[0]!.id;

let tpl: ReturnType<typeof createTemplate>;
let tmp: string;
const opened: Db[] = [];

beforeAll(() => {
  tpl = createTemplate();
  tmp = mkdtempSync(path.join(os.tmpdir(), "kdz-upg-"));
});
afterAll(() => {
  for (const db of opened) if (db.open) db.close();
  tpl.cleanup();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Baza prethodne verzije: sve migracije prije nove, izvedene redom. */
function oldSchemaDb(file: string): Db {
  assertTestDatabasePath(file, os.tmpdir());
  writeFileSync(file, "");
  const db = openDatabase(file);
  opened.push(db);
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < NEW_MIGRATION)
    .map((d) => d.name)
    .sort();
  expect(dirs).toHaveLength(4);
  for (const d of dirs) db.exec(readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"));
  return db;
}

const columns = (db: Db, table: string, schema = "main") =>
  (db.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

describe("SR-02: nadogradnja baze prethodne verzije (unknownTotalsJson)", () => {
  it("postojeći likovi, vrijednosti, događaji i baseline ostaju; replay prolazi; stupac dobiva []", () => {
    // 1) Izvor podataka: kampanja s nekoliko batcheva (u punoj shemi).
    const { db: src, file: srcFile } = freshDb(tpl);
    seed(src);
    let v = 0;
    for (let i = 0; i < 3; i++) {
      v = executeBatch(
        src,
        OWNER,
        batch([cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: null }), cmd("ApplyHealing", { characterId: PC, amount: 1 })], { expectedStateVersion: v }),
      ).stateVersionAfter;
    }
    // List lika prije nadogradnje (prazan popis nepoznatih = default novog stupca).
    const sheetBefore = deriveSheet(loadState(src, C1), PC);
    src.close();

    // 2) Ista kampanja u shemi prethodne verzije: zajednički stupci, baseline bez novog polja (kao da ga je zapisao stari kod).
    const old = oldSchemaDb(path.join(tmp, "old.db"));
    expect(columns(old, "Character")).not.toContain("unknownTotalsJson");
    const srcDb = openDatabase(srcFile, { readonly: true });
    opened.push(srcDb);
    old.pragma("foreign_keys = OFF");
    const tables = (old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`).all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) {
      const srcCols = columns(srcDb, t);
      const cols = columns(old, t).filter((c) => srcCols.includes(c));
      const ins = old.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      for (const row of srcDb.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]) {
        const vals = cols.map((c) => row[c]);
        if (t === "CampaignBaseline") {
          // Baseline kakav je zapisao stari kod: snapshot bez polja unknownTotals, s pripadajućim hashom.
          const snap = JSON.parse(row.snapshotJson as string);
          for (const c of Object.values(snap.characters) as Record<string, unknown>[]) delete c.unknownTotals;
          vals[cols.indexOf("snapshotJson")] = JSON.stringify(snap);
          vals[cols.indexOf("snapshotHash")] = snapshotHash(snap);
        }
        ins.run(...vals);
      }
    }
    srcDb.close();
    old.pragma("foreign_keys = ON");
    expect(old.pragma("foreign_key_check")).toEqual([]);

    const characterRows = () => old.prepare(`SELECT * FROM "Character" ORDER BY id`).all() as Record<string, unknown>[];
    const before = {
      characters: characterRows(),
      events: old.prepare(`SELECT id, seq, payloadJson FROM "DomainEvent" ORDER BY seq`).all(),
      baselines: old.prepare(`SELECT id, snapshotJson, snapshotHash FROM "CampaignBaseline" ORDER BY id`).all(),
      versions: old.prepare(`SELECT id, stateVersion, lastEventSeq FROM "Campaign" ORDER BY id`).all(),
    };
    expect(before.characters.length).toBeGreaterThan(0);
    expect(before.events.length).toBe(6);

    // 3) Nadogradnja: točno SQL nove migracije.
    old.exec(readFileSync(path.join(migrationsDir, NEW_MIGRATION, "migration.sql"), "utf8"));

    // 4) Ništa postojeće nije promijenjeno; novi stupac je [] za sve likove.
    const after = characterRows();
    expect(after.map(({ unknownTotalsJson, ...rest }) => ({ rest, unknownTotalsJson }))).toEqual(
      before.characters.map((rest) => ({ rest, unknownTotalsJson: "[]" })),
    );
    expect(old.prepare(`SELECT id, seq, payloadJson FROM "DomainEvent" ORDER BY seq`).all()).toEqual(before.events);
    expect(old.prepare(`SELECT id, snapshotJson, snapshotHash FROM "CampaignBaseline" ORDER BY id`).all()).toEqual(before.baselines);
    expect(old.prepare(`SELECT id, stateVersion, lastEventSeq FROM "Campaign" ORDER BY id`).all()).toEqual(before.versions);
    expect(old.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(old.pragma("foreign_key_check")).toEqual([]);
    expect(sha(JSON.stringify(before.baselines))).toBe(sha(JSON.stringify(old.prepare(`SELECT id, snapshotJson, snapshotHash FROM "CampaignBaseline" ORDER BY id`).all())));

    // 5) Replay i izračun lista jednaki su kao prije nadogradnje; novi batch radi.
    for (const c of [C1, "KDZ-T2"]) expect(verifyReplay(old, c).ok).toBe(true);
    const st = loadState(old, C1);
    expect(st.characters[PC]!.unknownTotals).toEqual([]);
    expect(deriveSheet(st, PC)).toEqual(sheetBefore);
    const r = executeBatch(old, OWNER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })], { expectedStateVersion: v }));
    expect(r.stateVersionAfter).toBe(v + 1);
    expect(verifyReplay(old, C1).ok).toBe(true);
  });
});

