import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BatchCommand } from "@/domain/commands";
import { DomainError } from "@/domain/errors";
import { exportCampaign, readCurrentExport, verifyExportGeneration } from "@/server/export/export";
import { executeBatch, type Actor } from "@/server/store/batch-service";
import type { Db } from "@/server/store/connection";
import { C1, createTemplate, freshDb, OWNER, PLAYER, seed, VIEWER } from "./helpers";

const PC = `${C1}-PC-001`;
let tpl: ReturnType<typeof createTemplate>;
let db: Db;
let out: string;
let version = 0;
const roots: string[] = [];

beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => {
  tpl.cleanup();
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
beforeEach(() => {
  db = freshDb(tpl).db;
  seed(db);
  db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-MARA', ?, 'npc', 'Mara', NULL, 'player', '{}', 't')`).run(C1);
  db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(C1);
  out = mkdtempSync(path.join(os.tmpdir(), "kdz-export-"));
  roots.push(out);
  version = 0;
  play();
});

const intent = { kind: "player_choice", messageId: "m-1" } as const;
const cmd = (type: BatchCommand["type"], payload: unknown): BatchCommand => ({ commandId: randomUUID(), type, intentRef: intent, payload }) as BatchCommand;
function run(commands: BatchCommand[], actor: Actor = OWNER) {
  const r = executeBatch(db, actor, { schemaVersion: 1, batchId: randomUUID(), campaignId: C1, expectedStateVersion: version, commands });
  version = r.stateVersionAfter;
  return r;
}

/** Kratka sesija s ručnim DM unosom, bez AI-ja (gate Faze 4). */
function play() {
  run([cmd("StartSession", { title: "Zvonik" })]);
  run([cmd("ApplyDamage", { characterId: PC, amount: 4, damageType: "slashing" }), cmd("AppendJournalNote", { title: "Borba", text: "Napad na mostu.", visibility: "player" })]);
  run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-MARA" }, text: "Mara zna put.", knowledgeKind: "rumor", visibility: "player", sourceRef: null })], PLAYER);
  run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "DM-TAJNA: Tajni zlikovac vodi kult.", knowledgeKind: "canon", visibility: "dm", sourceRef: null })]);
  run([cmd("AppendJournalNote", { title: "DM-TAJNA plan", text: "Zasjeda u kripti.", visibility: "dm" })]);
}

const readAll = (dir: string) => Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
const SECRET = /DM-TAJNA|Tajni zlikovac|NPC-TAJNI|kripti/;

describe("Verzionirani izvoz", () => {
  it("player izvoz: manifest s verzijom, cursorom i hashovima; bez DM sadržaja; nepoznato ostaje nepoznato", () => {
    const r = exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "player", now: () => "2026-11-28T10:00:00.000Z" });
    expect(r.manifest).toMatchObject({ stateVersion: 5, audience: "player", campaignId: C1 });
    expect(r.manifest.files.map((f) => f.path).sort()).toEqual(["entities.json", "events.jsonl", "handoff.md", "journal.json", "journal.md", "knowledge.json", "sessions.json", "state.json"]);
    expect(verifyExportGeneration(r.generationDir)).toMatchObject({ ok: true, problems: [] });
    const files = readAll(r.generationDir);
    for (const [name, text] of Object.entries(files)) expect(text, name).not.toMatch(SECRET);
    // Cursor je zadnji događaj vidljiv igraču; DM događaji nisu u izvozu.
    const events = files["events.jsonl"]!.trim().split("\n").map((l) => JSON.parse(l));
    expect(r.manifest.eventCursor).toBe(events.at(-1).seq);
    expect(events.every((e) => e.visibility !== "dm")).toBe(true);
    const state = JSON.parse(files["state.json"]!);
    expect(state.state.wallets[`${C1}-w-unknown`].amountMinor).toBeNull();
    expect(state.state.resourcePools[`${C1}-insp`].current).toBeNull();
    expect(files["journal.md"]).toMatch(/## Sesija 1: Zvonik/);
    expect(files["handoff.md"]).toMatch(/Verzija stanja: 5/);
    const cur = readCurrentExport(out, "player")!;
    expect(cur.check.ok).toBe(true);
    expect(cur.pointer).toMatchObject({ stateVersion: 5, generationSha256: r.manifest.generationSha256 });
  });

  it("DM izvoz uključuje DM sadržaj i smije ga napraviti samo vlasnik", () => {
    const r = exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "dm" });
    expect(readAll(r.generationDir)["knowledge.json"]).toMatch(/DM-TAJNA/);
    expect(r.manifest.eventCursor).toBe(6);
    for (const actor of [PLAYER, VIEWER]) {
      expect(() => exportCampaign(db, actor, { campaignId: C1, outRoot: out, audience: "dm" })).toThrow(DomainError);
    }
    expect(() => exportCampaign(db, { actorId: "stranac" }, { campaignId: C1, outRoot: out, audience: "player" })).toThrow(DomainError);
    // Igrač smije napraviti vlastiti player izvoz.
    expect(exportCampaign(db, PLAYER, { campaignId: C1, outRoot: out, audience: "player" }).manifest.audience).toBe("player");
  });

  it("izvoz ne mijenja bazu", () => {
    const counts = () =>
      ["DomainEvent", "JournalEntry", "KnowledgeAssertion", "Session", "BatchReceipt"].map((t) => (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n).concat(
        (db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(C1) as { stateVersion: number }).stateVersion,
      );
    const before = counts();
    exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "dm" });
    expect(counts()).toEqual(before);
  });

  it.each(["file:events.jsonl", "file:journal.md", "file:manifest.json", "verify", "publish"])(
    "prekid u koraku %s: nema nove generacije ni privremenih datoteka, pointer ostaje na prethodnoj ispravnoj",
    (failAt) => {
      const first = exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "player", now: () => "2026-11-28T10:00:00.000Z" });
      run([cmd("ApplyHealing", { characterId: PC, amount: 1 })]);
      expect(() =>
        exportCampaign(db, OWNER, {
          campaignId: C1,
          outRoot: out,
          audience: "player",
          now: () => "2026-11-28T11:00:00.000Z",
          onStep: (s) => {
            if (s === failAt) throw new Error(`prekid: ${s}`);
          },
        }),
      ).toThrow(/prekid/);
      expect(readdirSync(path.join(out, "generations"))).toEqual([path.basename(first.generationDir)]);
      expect(readdirSync(out).filter((f) => f.startsWith("."))).toEqual([]);
      const cur = readCurrentExport(out, "player")!;
      expect(cur.pointer.stateVersion).toBe(5);
      expect(cur.check.ok).toBe(true);
    },
  );

  it("prekid prije pointera: nova generacija je cjelovita i provjerljiva, ali nije objavljena", () => {
    exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "player", now: () => "2026-11-28T10:00:00.000Z" });
    run([cmd("ApplyHealing", { characterId: PC, amount: 1 })]);
    expect(() =>
      exportCampaign(db, OWNER, {
        campaignId: C1,
        outRoot: out,
        audience: "player",
        now: () => "2026-11-28T11:00:00.000Z",
        onStep: (s) => {
          if (s === "pointer") throw new Error("prekid");
        },
      }),
    ).toThrow();
    const gens = readdirSync(path.join(out, "generations")).sort();
    expect(gens).toHaveLength(2);
    for (const g of gens) expect(verifyExportGeneration(path.join(out, "generations", g)).ok).toBe(true);
    expect(readCurrentExport(out, "player")!.pointer.stateVersion).toBe(5);
  });

  it("izmijenjena, dodana ili uklonjena datoteka generacije otkriva se pri provjeri", () => {
    const r = exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "player" });
    writeFileSync(path.join(r.generationDir, "journal.md"), "krivotvoreno");
    expect(verifyExportGeneration(r.generationDir).problems.join(" ")).toMatch(/journal\.md/);
    expect(readCurrentExport(out, "player")!.check.ok).toBe(false);
    const r2 = exportCampaign(db, OWNER, { campaignId: C1, outRoot: out, audience: "player", now: () => "2026-11-29T00:00:00.000Z" });
    writeFileSync(path.join(r2.generationDir, "visak.txt"), "x");
    rmSync(path.join(r2.generationDir, "sessions.json"));
    const p = verifyExportGeneration(r2.generationDir).problems.join(" ");
    expect(p).toMatch(/visak\.txt/);
    expect(p).toMatch(/sessions\.json/);
    expect(existsSync(r2.pointerPath)).toBe(true);
  });
});
