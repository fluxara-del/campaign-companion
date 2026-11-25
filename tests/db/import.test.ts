import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

/** Popis direktorija, datoteka i veza s hashovima sadržaja (veze se ne slijede). */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out[path.relative(dir, p)] = "link";
      else if (st.isDirectory()) {
        out[path.relative(dir, p) + "/"] = "dir";
        walk(p);
      } else out[path.relative(dir, p)] = sha256(readFileSync(p));
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

/** Je li tajni sadržaj igdje u generaciji (kopija, baza, izvještaj)? */
function secretInTree(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return Object.keys(hashTree(dir)).some((rel) => {
    const p = path.join(dir, rel);
    return !rel.endsWith("/") && lstatSync(p).isFile() && readFileSync(p).includes(Buffer.from(SECRET));
  });
}

/**
 * Stvara vezu na direktorij: na Windowsu NTFS junction (provjereno kroz `dir /AL` koji mora
 * prikazati <JUNCTION>), drugdje simboličku vezu. Test ne prolazi ako veza nije stvarno nastala.
 */
function junction(target: string, at: string): void {
  symlinkSync(target, at, "junction");
  expect(lstatSync(at).isSymbolicLink()).toBe(true);
  if (process.platform === "win32") {
    const listing = execFileSync("cmd.exe", ["/d", "/c", "dir", "/AL", path.dirname(at)], { encoding: "utf8" });
    const line = listing.split(/\r?\n/).find((l) => l.includes(path.basename(at)));
    expect(line, "dir /AL mora prikazati NTFS junction").toMatch(/<JUNCTION>/);
  }
}

function outsideNpcs(): string {
  const outside = path.join(tmp, `outside-${randomUUID()}`);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "npcs.json"), JSON.stringify({ npcs: [{ id: "NPC-X", name: SECRET }] }));
  return outside;
}

describe("Zamjena stabla između provjere i čitanja (TOCTOU) se otkriva", () => {
  it.each(["beforeOpen", "afterOpen"] as const)("direktorij zamijenjen junctionom u trenutku %s", (when) => {
    const source = makeSource();
    const outside = outsideNpcs();
    let swapError: NodeJS.ErrnoException | null = null;
    const swap = (rel: string) => {
      if (rel !== "npcs/npcs.json") return;
      try {
        renameSync(path.join(source, "npcs"), path.join(source, "npcs-orig"));
      } catch (e) {
        swapError = e as NodeJS.ErrnoException;
        return;
      }
      junction(outside, path.join(source, "npcs"));
    };
    const r = runTrialImport({
      sourceRoot: source,
      outRoot: path.join(tmp, "out"),
      ownerActorId: "owner",
      generation: randomUUID(),
      now: "2026-11-25T12:00:00.000Z",
      prismaCli,
      projectRoot: root,
      testHooks: { snapshot: { [when]: swap } },
    });
    if (when === "afterOpen" && process.platform === "win32") {
      // NTFS ne dopušta preimenovanje direktorija dok je datoteka u njemu otvorena:
      // zamjena nakon otvaranja nije ni moguća, a uvoz čita izvornu datoteku.
      expect(swapError).not.toBeNull();
      expect((swapError as NodeJS.ErrnoException | null)?.code).toMatch(/EPERM|EBUSY|EACCES/);
      expect(r.report.status).toBe("trial");
      expect(secretInTree(r.generationDir)).toBe(false);
      return;
    }
    expect(swapError).toBeNull();
    expect(r.report.status).toBe("blocked");
    expect(r.dbPath).toBeNull();
    expect(r.report.findings.some((f) => f.code === "source_changed_before_read" && f.source === "npcs/npcs.json")).toBe(true);
    expect(r.report.sourceManifest.files).toEqual([]);
    expect(secretInTree(r.generationDir)).toBe(false);
  }, 60_000);
});

describe("Veze (symlink/junction) u izvoru se odbijaju prije čitanja", () => {
  it("Markdown direktorij preusmjeren na dm_private", () => {
    const source = makeSource((d) => {
      rmSync(path.join(d, "sessions"), { recursive: true });
      junction(path.join(d, "dm_private"), path.join(d, "sessions"));
    });
    const before = hashTree(source);
    const r = run(source);
    expect(r.report.status).toBe("blocked");
    expect(r.dbPath).toBeNull();
    expect(r.report.findings.some((f) => f.code === "source_link_rejected" && f.source === "sessions")).toBe(true);
    expect(r.report.sourceManifest.files).toEqual([]);
    expect(secretInTree(r.generationDir)).toBe(false);
    expect(hashTree(source)).toEqual(before);
  }, 60_000);

  it("JSON direktorij preusmjeren izvan izvora", () => {
    const outside = outsideNpcs();
    const source = makeSource((d) => {
      rmSync(path.join(d, "npcs"), { recursive: true });
      junction(outside, path.join(d, "npcs"));
    });
    const r = run(source);
    expect(r.report.status).toBe("blocked");
    expect(r.report.findings.some((f) => f.code === "source_link_rejected" && f.source === "npcs/npcs.json")).toBe(true);
    expect(secretInTree(r.generationDir)).toBe(false);
  }, 60_000);
});

describe("Izlaz preko veze ne smije pisati u izvor", () => {
  it.each(["link", "link/sandbox", "link/a/b"])("outRoot = %s", (sub) => {
    const source = makeSource();
    const link = path.join(tmp, `link-${randomUUID()}`);
    junction(source, link);
    const before = hashTree(source);
    const outRoot = path.join(link, ...sub.split("/").slice(1));
    expect(() =>
      runTrialImport({ sourceRoot: source, outRoot, ownerActorId: "o", generation: "g", now: "2026-11-25T00:00:00Z", prismaCli, projectRoot: root }),
    ).toThrow(/unutar izvornog/);
    expect(hashTree(source)).toEqual(before);
  });
});

describe("Doslovno čuvanje dokumenata (BOM)", () => {
  it("SHA-256 sadržaja iz baze odgovara manifestu za dokument s BOM-om i bez njega", () => {
    const source = makeSource((d) => {
      writeFileSync(path.join(d, "sessions", "S-BOM.md"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# S BOM-om\n\nčćž\n")]));
      writeFileSync(path.join(d, "sessions", "S-BEZ.md"), "# Bez BOM-a\n\nčćž\n");
      const npcs = path.join(d, "npcs", "npcs.json");
      writeFileSync(npcs, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(npcs)]));
    });
    const r = run(source);
    expect(r.report.status).toBe("trial");
    const db = openDatabase(r.dbPath!, { readonly: true });
    const docs = db.prepare(`SELECT path, sha256, content FROM "SourceDocument"`).all() as { path: string; sha256: string; content: string }[];
    db.close();
    const manifest = new Map(r.report.sourceManifest.files.map((f) => [f.path, f.sha256]));
    for (const p of ["sessions/S-BOM.md", "sessions/S-BEZ.md", "npcs/npcs.json"]) {
      const d = docs.find((x) => x.path === p)!;
      expect(sha256(Buffer.from(d.content, "utf8"))).toBe(manifest.get(p));
      expect(d.sha256).toBe(manifest.get(p));
    }
    expect(docs.find((x) => x.path === "sessions/S-BOM.md")!.content.charCodeAt(0)).toBe(0xfeff);
  }, 60_000);
});

describe("Završna provjera izvora koristi zaštićeno čitanje", () => {
  it.each(["beforeOpen", "afterOpen"] as const)("zamjena putanje tijekom završnog hashiranja (%s) se ne čita i blokira", (when) => {
    const source = makeSource();
    // Zamjenska datoteka ima IDENTIČNE bajtove kao original: kad bi je provjera pročitala,
    // hash bi se poklopio i promjena se ne bi prijavila. Prijava dokazuje da nije pročitana.
    const outside = path.join(tmp, `outside-same-${randomUUID()}`);
    mkdirSync(outside);
    writeFileSync(path.join(outside, "npcs.json"), readFileSync(path.join(source, "npcs", "npcs.json")));
    let swapError: NodeJS.ErrnoException | null = null;
    const swap = (rel: string) => {
      if (rel !== "npcs/npcs.json") return;
      try {
        renameSync(path.join(source, "npcs"), path.join(source, "npcs-orig"));
      } catch (e) {
        swapError = e as NodeJS.ErrnoException;
        return;
      }
      junction(outside, path.join(source, "npcs"));
    };
    const r = runTrialImport({
      sourceRoot: source,
      outRoot: path.join(tmp, "out"),
      ownerActorId: "owner",
      generation: randomUUID(),
      now: "2026-11-25T12:00:00.000Z",
      prismaCli,
      projectRoot: root,
      testHooks: { final: { [when]: swap } },
    });
    if (when === "afterOpen" && process.platform === "win32") {
      expect((swapError as NodeJS.ErrnoException | null)?.code).toMatch(/EPERM|EBUSY|EACCES/);
      expect(r.report.status).toBe("trial");
      return;
    }
    expect(swapError).toBeNull();
    expect(r.report.status).toBe("blocked");
    expect(r.report.findings.some((f) => f.code === "source_changed_during_import" && f.source === "npcs/npcs.json")).toBe(true);
  }, 60_000);

  it("nestanak izvorne datoteke tijekom završne provjere blokira uvoz", () => {
    const source = makeSource();
    const r = runTrialImport({
      sourceRoot: source,
      outRoot: path.join(tmp, "out"),
      ownerActorId: "owner",
      generation: randomUUID(),
      now: "2026-11-25T12:00:00.000Z",
      prismaCli,
      projectRoot: root,
      testHooks: { final: { beforeOpen: (rel) => rel === "quests/quests.json" && rmSync(path.join(source, "quests", "quests.json")) } },
    });
    expect(r.report.status).toBe("blocked");
    expect(r.report.findings.some((f) => f.code === "source_changed_during_import" && f.source === "quests/quests.json")).toBe(true);
  }, 60_000);
});

describe("Količina predmeta", () => {
  const setQty = (index: number, value: unknown, key: "equipment" | "externalItems" = "equipment") => (d: string) => {
    const f = path.join(d, "state", "character.json");
    const c = JSON.parse(readFileSync(f, "utf8"));
    c[key][index].quantity = value;
    writeFileSync(f, JSON.stringify(c));
  };

  it("izričito null (nepoznato) se čuva i ne blokira uvoz", () => {
    const r = run(makeSource(setQty(0, null)));
    expect(r.report.status).toBe("trial");
    const db = openDatabase(r.dbPath!, { readonly: true });
    expect((db.prepare(`SELECT quantity FROM "ItemInstance" WHERE name = 'Mač'`).get() as { quantity: number | null }).quantity).toBeNull();
    db.close();
  }, 60_000);

  it("decimalni brojevi u izvornim podacima (npr. masa) ne ruše uvoz i čuvaju se doslovno", () => {
    const r = run(
      makeSource((d) => {
        const f = path.join(d, "state", "character.json");
        const c = JSON.parse(readFileSync(f, "utf8"));
        c.equipment[0].massLb = 3.5;
        c.heightM = 1.82;
        writeFileSync(f, JSON.stringify(c));
      }),
    );
    expect(r.report.status).toBe("trial");
    const db = openDatabase(r.dbPath!, { readonly: true });
    const attrs = JSON.parse((db.prepare(`SELECT attributesJson FROM "ItemInstance" WHERE name = 'Mač'`).get() as { attributesJson: string }).attributesJson);
    expect(attrs.massLb).toBe(3.5);
    db.close();
  }, 60_000);

  it.each([
    ["tekst u inventaru", setQty(0, "dva")],
    ["negativna u inventaru", setQty(0, -1)],
    ["decimalna izvan inventara", setQty(0, 1.5, "externalItems")],
  ])("%s blokira uvoz", (_l, mutate) => {
    const r = run(makeSource(mutate));
    expect(r.report.status).toBe("blocked");
    expect(r.report.findings.some((f) => f.code === "item_quantity")).toBe(true);
  }, 60_000);
});
