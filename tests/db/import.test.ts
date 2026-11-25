import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeBatch } from "@/server/store/batch-service";
import { openDatabase } from "@/server/store/connection";
import { verifyReplay } from "@/server/store/replay";
import { runTrialImport, type TrialImportResult } from "@/server/import/run";
import { sha256 } from "@/server/import/source-snapshot";

const root = path.resolve(import.meta.dirname, "..", "..");
const fixture = path.join(root, "tests", "fixtures", "kampanja-uzorak");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const SECRET = "TAJNA-DM-SADRZAJ-7f3a";
let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "kdz-f2-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

/** Kopija uzorka u privremeni direktorij, s dm_private i backups koji se ne smiju čitati. */
function makeSource(mutate?: (dir: string) => void): string {
  const dir = path.join(tmp, `src-${randomUUID()}`);
  cpSync(fixture, dir, { recursive: true });
  mkdirSync(path.join(dir, "dm_private"));
  writeFileSync(path.join(dir, "dm_private", "tajna.md"), `# Tajna\n\n${SECRET}\n`);
  mkdirSync(path.join(dir, "backups"));
  writeFileSync(path.join(dir, "backups", "stara.txt"), SECRET);
  mutate?.(dir);
  return dir;
}

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = sha256(readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

function run(source: string, generation: string = randomUUID()): TrialImportResult {
  return runTrialImport({
    sourceRoot: source,
    outRoot: path.join(tmp, "out"),
    ownerActorId: "owner",
    generation,
    now: "2026-11-25T12:00:00.000Z",
    prismaCli,
    projectRoot: root,
  });
}

describe("Probni uvoz sintetičkog uzorka", () => {
  let source: string;
  let before: Record<string, string>;
  let result: TrialImportResult;

  beforeAll(() => {
    source = makeSource();
    before = hashTree(source);
    result = run(source, "g1");
  }, 120_000);

  it("izrađuje i provjerava probnu bazu bez pogrešaka", () => {
    expect(result.report.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.report.status).toBe("trial");
    expect(result.report.verification).toMatchObject({ replayOk: true, roundTripOk: true, integrityOk: true });
    expect(existsSync(path.join(result.generationDir, "report.md"))).toBe(true);
  });

  it("ne mijenja izvor i ne čita dm_private ni backups", () => {
    expect(hashTree(source)).toEqual(before);
    const copied = hashTree(path.join(result.generationDir, "source"));
    expect(Object.keys(copied).some((p) => p.startsWith("dm_private") || p.startsWith("backups"))).toBe(false);
    expect(result.report.sourceManifest.files.map((f) => f.path).some((p) => p.includes("dm_private"))).toBe(false);
    expect(result.report.sourceManifest.excluded).toEqual(expect.arrayContaining(["dm_private", "backups"]));
    expect(readFileSync(result.dbPath!).includes(Buffer.from(SECRET))).toBe(false);
    expect(readFileSync(path.join(result.generationDir, "report.md"), "utf8")).not.toContain(SECRET);
  });

  it("regresijski slučajevi: PC-001, slotovi 0/2, Divine Smite 0/1, Heroic Inspiration nepoznat, odvojen novac", () => {
    const db = openDatabase(result.dbPath!, { readonly: true });
    const pc = db.prepare(`SELECT * FROM "Character" WHERE id = 'PC-001'`).get() as Record<string, unknown>;
    expect(pc).toMatchObject({ campaignId: "UZR-001", hpCurrent: 18, hpMax: 22, hpTemp: 0 });
    const pool = (key: string) => db.prepare(`SELECT current, max, rechargePolicy FROM "ResourcePool" WHERE resourceKey = ?`).get(key);
    expect(pool("spell-slot-1")).toEqual({ current: 0, max: 2, rechargePolicy: null });
    expect(pool("free-divine-smite")).toEqual({ current: 0, max: 1, rechargePolicy: "long_rest" });
    expect(pool("heroic-inspiration")).toEqual({ current: null, max: null, rechargePolicy: null });
    expect(pool("lay-on-hands")).toEqual({ current: 10, max: 10, rechargePolicy: null });
    expect(pool("hit-dice-d10")).toEqual({ current: 2, max: 2, rechargePolicy: null });
    const wallets = db.prepare(`SELECT purpose, ownerCharacterId, amountMinor FROM "Wallet" ORDER BY purpose`).all();
    expect(wallets).toEqual([
      { purpose: "group_dedicated", ownerCharacterId: null, amountMinor: 500 },
      { purpose: "personal", ownerCharacterId: "PC-001", amountMinor: 2100 },
    ]);
    db.close();
  });

  it("potvrđen odmor ne postoji: nema domenskih događaja, legacy događaji su doslovni", () => {
    const db = openDatabase(result.dbPath!, { readonly: true });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "DomainEvent"`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT stateVersion FROM "Campaign"`).get() as { stateVersion: number }).stateVersion).toBe(0);
    const legacy = db.prepare(`SELECT legacyId, position, rawJson, rawSha256, sourceLine FROM "LegacyEvent" ORDER BY position`).all() as {
      legacyId: string;
      rawJson: string;
      rawSha256: string;
      sourceLine: number;
    }[];
    const lines = readFileSync(path.join(source, "events", "events.jsonl"), "utf8").split("\n");
    expect(legacy.map((l) => l.legacyId)).toEqual(["UZR-S000-E001", "UZR-S001-E001", "UZR-S001-E002"]);
    for (const l of legacy) {
      expect(l.rawJson).toBe(lines[l.sourceLine - 1]);
      expect(l.rawSha256).toBe(sha256(l.rawJson));
    }
    const batch = db.prepare(`SELECT status, legacyStateVersion, legacyLastEventId FROM "ImportBatch"`).get();
    expect(batch).toEqual({ status: "trial", legacyStateVersion: 2, legacyLastEventId: "UZR-S001-E002" });
    expect(result.report.findings.some((f) => f.code === "no_confirmed_rest")).toBe(true);
    db.close();
  });

  it("vlasništvo, držanje, lokacija i spremnici: nepoznato ostaje nepoznato", () => {
    const db = openDatabase(result.dbPath!, { readonly: true });
    const item = (name: string) =>
      db.prepare(`SELECT id, quantity, ownerRef, holderRef, location, containerItemId FROM "ItemInstance" WHERE name = ?`).get(name) as Record<string, unknown>;
    expect(item("Mač")).toMatchObject({ ownerRef: null, holderRef: "PC-001", quantity: 1 });
    expect(item("Pločica").containerItemId).toBe(item("Probni amulet").id);
    expect(item("Tuđi kolut")).toMatchObject({ ownerRef: "NPC-001", holderRef: null, quantity: null });
    expect(item("Klin")).toMatchObject({ ownerRef: null, holderRef: null, location: "Ležište ispod kule" });
    db.close();
  });

  it("odnosi dobivaju prirodni ključ, a svaka izvorna datoteka je sačuvana doslovno", () => {
    const db = openDatabase(result.dbPath!, { readonly: true });
    const rel = db.prepare(`SELECT id, name FROM "EntityRecord" WHERE kind = 'relationship'`).all();
    expect(rel).toEqual([{ id: "REL:NPC-001->PC-001", name: "NPC-001 → PC-001" }]);
    const docs = db.prepare(`SELECT path, sha256, content FROM "SourceDocument" ORDER BY path`).all() as { path: string; sha256: string; content: string }[];
    expect(docs.map((d) => d.path)).toEqual(result.report.sourceManifest.files.map((f) => f.path).sort());
    const npcs = docs.find((d) => d.path === "npcs/npcs.json")!;
    expect(npcs.content).toBe(readFileSync(path.join(source, "npcs", "npcs.json"), "utf8"));
    expect(npcs.content).toContain("idReconciliation");
    db.close();
  });

  it("prijavljuje nesklad Markdowna i strukturiranih polja bez mijenjanja vrijednosti", () => {
    const mismatch = result.report.findings.filter((f) => f.code === "markdown_mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.message).toMatch(/Markdown 2\/2, strukturirano 0\/2/);
    expect(result.report.findings.some((f) => f.code === "markdown_consistent")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "funds_total_ok")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "dm_private_excluded")).toBe(true);
  });

  it("je deterministički: druga proba daje isti hash sadržaja i isti baseline", () => {
    const again = run(source, "g2");
    expect(again.report.contentHash).toBe(result.report.contentHash);
    expect(again.report.verification!.baselineHash).toBe(result.report.verification!.baselineHash);
    expect(again.report.sourceManifestHash).toBe(result.report.sourceManifestHash);
  }, 120_000);

  it("uvezeno stanje radi s domenskim servisom; proba se odbacuje brisanjem generacije", () => {
    const db = openDatabase(result.dbPath!);
    const pool = db.prepare(`SELECT id FROM "ResourcePool" WHERE resourceKey = 'lay-on-hands'`).get() as { id: string };
    executeBatch(db, { actorId: "owner" }, {
      schemaVersion: 1,
      batchId: randomUUID(),
      campaignId: "UZR-001",
      expectedStateVersion: 0,
      commands: [{ commandId: randomUUID(), type: "ConsumeResource", intentRef: { kind: "player_choice", messageId: "m1" }, payload: { resourcePoolId: pool.id, amount: 5 } }],
    });
    expect(verifyReplay(db, "UZR-001").ok).toBe(true);
    db.close();
    rmSync(result.generationDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    expect(existsSync(result.generationDir)).toBe(false);
    expect(hashTree(source)).toEqual(before);
  });
});

describe("Blokirajući nalazi: probna baza se ne izrađuje", () => {
  it.each([
    ["neispravan JSON", (d: string) => writeFileSync(path.join(d, "quests", "quests.json"), "{ nije json"), "json_invalid"],
    [
      "privremeni HP nije naveden",
      (d: string) => {
        const f = path.join(d, "state", "character.json");
        const c = JSON.parse(readFileSync(f, "utf8"));
        delete c.temporaryHp;
        writeFileSync(f, JSON.stringify(c));
      },
      "temp_hp_unknown",
    ],
    [
      "lastEventId nije posljednji događaj",
      (d: string) => {
        const f = path.join(d, "state", "current-state.json");
        const s = JSON.parse(readFileSync(f, "utf8"));
        s.lastEventId = "UZR-S001-E001";
        writeFileSync(f, JSON.stringify(s));
      },
      "last_event_mismatch",
    ],
  ])("%s", (_l, mutate, code) => {
    const r = run(makeSource(mutate));
    expect(r.report.status).toBe("blocked");
    expect(r.dbPath).toBeNull();
    expect(r.report.findings.some((f) => f.code === code && f.severity === "error")).toBe(true);
    expect(existsSync(path.join(r.generationDir, "report.md"))).toBe(true);
  }, 60_000);

  it("odbija sandbox unutar izvornog direktorija", () => {
    const source = makeSource();
    expect(() =>
      runTrialImport({ sourceRoot: source, outRoot: path.join(source, "sandbox"), ownerActorId: "o", generation: "x", now: "2026-11-25T00:00:00Z", prismaCli, projectRoot: root }),
    ).toThrow(/unutar izvornog/);
    expect(existsSync(path.join(source, "sandbox"))).toBe(false);
  });
});
