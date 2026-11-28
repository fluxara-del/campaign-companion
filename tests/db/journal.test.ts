import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BatchCommand } from "@/domain/commands";
import { DomainError } from "@/domain/errors";
import { executeBatch, type Actor } from "@/server/store/batch-service";
import type { Db } from "@/server/store/connection";
import { getJournal, getKnowledge } from "@/server/store/journal-read";
import { verifyJournalProjections } from "@/server/store/journal-projection";
import { verifyReplay } from "@/server/store/replay";
import { C1, createTemplate, freshDb, OWNER, PLAYER, PLAYER2, seed, VIEWER } from "./helpers";

const PC = `${C1}-PC-001`;
let tpl: ReturnType<typeof createTemplate>;
let db: Db;
let version = 0;

beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => tpl.cleanup());
beforeEach(() => {
  db = freshDb(tpl).db;
  seed(db);
  db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-MARA', ?, 'npc', 'Mara', NULL, 'player', '{}', 't')`).run(C1);
  db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES ('NPC-TAJNI', ?, 'npc', 'Tajni zlikovac', NULL, 'dm', '{}', 't')`).run(C1);
  version = 0;
});

const intent = { kind: "player_choice", messageId: "m-1" } as const;
const cmd = (type: BatchCommand["type"], payload: unknown): BatchCommand => ({ commandId: randomUUID(), type, intentRef: intent, payload }) as BatchCommand;
function run(commands: BatchCommand[], actor: Actor = OWNER) {
  const r = executeBatch(db, actor, { schemaVersion: 1, batchId: randomUUID(), campaignId: C1, expectedStateVersion: version, commands });
  version = r.stateVersionAfter;
  return r;
}
function fail(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error("Očekivana pogreška domene.");
}
const eventId = (r: ReturnType<typeof run>, type: string) => r.events.find((e) => e.type === type)!.id;
const SECRET = /Tajni zlikovac|NPC-TAJNI|DM-TAJNA/;

describe("Sesije", () => {
  it("otvaranje i zatvaranje: događaji nose sesiju; najviše jedna otvorena; samo vlasnik", () => {
    run([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    const start = run([cmd("StartSession", { title: "Zvonik" })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: null })]);
    expect(fail(() => run([cmd("StartSession", { title: null })])).code).toBe("rule_violation");
    expect(fail(() => run([cmd("StartSession", { title: null })], PLAYER)).code).toBe("forbidden");
    const s = getJournal(db, OWNER, C1).sessions;
    expect(s).toEqual([expect.objectContaining({ number: 1, title: "Zvonik", status: "open", startVersion: 2 })]);
    run([cmd("EndSession", { sessionId: s[0]!.id })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    const rows = db.prepare(`SELECT seq, type, sessionId FROM "DomainEvent" WHERE campaignId = ? ORDER BY seq`).all(C1) as { seq: number; type: string; sessionId: string | null }[];
    expect(rows.map((r) => [r.type, r.sessionId])).toEqual([
      ["DamageApplied", null],
      ["SessionStarted", s[0]!.id],
      ["DamageApplied", s[0]!.id],
      ["SessionEnded", s[0]!.id],
      ["DamageApplied", null],
    ]);
    expect(getJournal(db, OWNER, C1).sessions[0]).toMatchObject({ status: "closed", endVersion: 4 });
    // Sljedeća sesija dobiva broj 2; filtar po sesiji vraća samo njezine zapise.
    run([cmd("StartSession", { title: null })]);
    expect(getJournal(db, OWNER, C1).sessions.map((x) => x.number)).toEqual([1, 2]);
    const inFirst = getJournal(db, OWNER, C1, { sessionId: s[0]!.id }).entries;
    expect(inFirst.length).toBe(3);
    expect(inFirst.every((e) => e.events.every((ev) => ev.sessionId === s[0]!.id))).toBe(true);
    expect(eventId(start, "SessionStarted")).toBeTruthy();
    // Zatvorena sesija je nepromjenjiva i u bazi.
    expect(() => db.prepare(`UPDATE "Session" SET title = 'x' WHERE id = ?`).run(s[0]!.id)).toThrow(/nepromjenjiv/);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("početak i kraj sesije u istom batchu", () => {
    run([cmd("StartSession", { title: null }), cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    const sid = getJournal(db, OWNER, C1).sessions[0]!.id;
    run([cmd("ApplyHealing", { characterId: PC, amount: 1 }), cmd("EndSession", { sessionId: sid }), cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    const rows = db.prepare(`SELECT type, sessionId FROM "DomainEvent" WHERE campaignId = ? ORDER BY seq`).all(C1) as { type: string; sessionId: string | null }[];
    expect(rows.map((r) => r.sessionId)).toEqual([sid, sid, sid, sid, null]);
    expect(verifyJournalProjections(db, C1).ok).toBe(true);

    // SUP-19-04: unos dnevnika ne miješa događaje različitih sesija, ni preko kraja ni preko početka sesije.
    run([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null }), cmd("StartSession", { title: "Druga" }), cmd("ApplyHealing", { characterId: PC, amount: 1 })]);
    const sid2 = getJournal(db, OWNER, C1).sessions[1]!.id;
    const entries = getJournal(db, OWNER, C1).entries;
    for (const e of entries) {
      expect(e.events.every((ev) => ev.sessionId === e.sessionId), e.text).toBe(true);
    }
    const bySession = (id: string | null) => entries.filter((e) => e.sessionId === id).flatMap((e) => e.events.map((ev) => ev.type));
    expect(bySession(sid).sort()).toEqual(["DamageApplied", "HealingApplied", "SessionEnded", "SessionStarted"].sort());
    expect(bySession(null).sort()).toEqual(["DamageApplied", "DamageApplied"]);
    expect(bySession(sid2).sort()).toEqual(["HealingApplied", "SessionStarted"]);
    expect(getJournal(db, OWNER, C1, { sessionId: sid }).entries.flatMap((e) => e.events).every((ev) => ev.sessionId === sid)).toBe(true);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });
});

describe("Osobne bilješke: revizije bez brisanja povijesti", () => {
  it("autor mijenja svoju bilješku uz očekivanu reviziju; povijest ostaje u događajima", () => {
    const r = run([cmd("AppendJournalNote", { title: "Sumnja", text: "Mara laže.", visibility: "player" })], PLAYER);
    const noteId = r.journalEntryIds.at(-1)!;
    run([cmd("ReviseJournalNote", { journalEntryId: noteId, expectedRevision: 1, title: "Sumnja", text: "Mara možda laže." })], PLAYER);
    // Zastarjela revizija i tuđa bilješka se odbijaju.
    expect(fail(() => run([cmd("ReviseJournalNote", { journalEntryId: noteId, expectedRevision: 1, title: null, text: "x" })], PLAYER)).details).toMatchObject({ reason: "revision_stale", currentRevision: 2 });
    expect(fail(() => run([cmd("ReviseJournalNote", { journalEntryId: noteId, expectedRevision: 2, title: null, text: "x" })], PLAYER2)).code).toBe("forbidden");
    // Vlasnik smije.
    run([cmd("ReviseJournalNote", { journalEntryId: noteId, expectedRevision: 2, title: "Sumnja", text: "Mara laže o zvonu." })]);
    const note = getJournal(db, PLAYER, C1, { kind: "manual" }).entries;
    expect(note).toEqual([expect.objectContaining({ id: noteId, revision: 3, text: "Mara laže o zvonu." })]);
    const history = (db.prepare(`SELECT type, payloadJson FROM "DomainEvent" WHERE campaignId = ? ORDER BY seq`).all(C1) as { type: string; payloadJson: string }[]).map(
      (e) => [e.type, JSON.parse(e.payloadJson).text],
    );
    expect(history).toEqual([
      ["JournalNoteAppended", "Mara laže."],
      ["JournalNoteRevised", "Mara možda laže."],
      ["JournalNoteRevised", "Mara laže o zvonu."],
    ]);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("DM bilješka je za igrača nepostojeća", () => {
    const r = run([cmd("AppendJournalNote", { title: null, text: "DM-TAJNA bilješka", visibility: "dm" })]);
    const err = fail(() => run([cmd("ReviseJournalNote", { journalEntryId: r.journalEntryIds.at(-1)!, expectedRevision: 1, title: null, text: "x" })], PLAYER));
    expect(err.code).toBe("rule_violation");
    expect(JSON.stringify(err)).not.toMatch(SECRET);
  });
});

describe("Znanje: glasina, kanon i ispravke", () => {
  it("glasina ostaje glasina; ispravka u kanon dodaje događaj i zamjenjuje tvrdnju bez brisanja", () => {
    const r1 = run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-MARA" }, text: "Mara je kći zvonara.", knowledgeKind: "rumor", visibility: "player", sourceRef: "sesija-3.md" })], PLAYER);
    const rumorEvent = eventId(r1, "WorldFactRecorded");
    expect(getKnowledge(db, PLAYER, C1)).toEqual([expect.objectContaining({ knowledgeKind: "rumor", status: "active", sourceRef: "sesija-3.md" })]);
    // Igrač ne upisuje kanon ni DM tvrdnje.
    expect(fail(() => run([cmd("RecordWorldFact", { subject: { kind: "world", id: null }, text: "x", knowledgeKind: "canon", visibility: "player", sourceRef: null })], PLAYER)).code).toBe("forbidden");
    expect(fail(() => run([cmd("CorrectConfirmedFact", { targetEventId: rumorEvent, reason: "x", replacement: null })], PLAYER)).code).toBe("forbidden");

    const r2 = run([cmd("CorrectConfirmedFact", { targetEventId: rumorEvent, reason: "Potvrđeno u dnevniku zvonara", replacement: { text: "Mara je kći zvonara.", knowledgeKind: "canon", visibility: "player" } })]);
    const all = getKnowledge(db, PLAYER, C1, { includeHistory: true });
    expect(all.map((a) => [a.knowledgeKind, a.status])).toEqual([
      ["rumor", "superseded"],
      ["canon", "active"],
    ]);
    expect(all[0]!.correctedByEventId).toBe(eventId(r2, "FactCorrected"));
    expect(all[0]!.supersededById).toBe(all[1]!.id);
    // Izvorni događaj je netaknut; ispravka ga referencira.
    const rumorRow = db.prepare(`SELECT payloadJson FROM "DomainEvent" WHERE id = ?`).get(rumorEvent) as { payloadJson: string };
    expect(JSON.parse(rumorRow.payloadJson)).toMatchObject({ knowledgeKind: "rumor", text: "Mara je kći zvonara." });
    const corr = db.prepare(`SELECT payloadJson FROM "DomainEvent" WHERE id = ?`).get(eventId(r2, "FactCorrected")) as { payloadJson: string };
    expect(JSON.parse(corr.payloadJson)).toMatchObject({ targetEventId: rumorEvent, targetSeq: 1 });
    // Filtar dnevnika po vrsti znanja i po NPC-u.
    expect(getJournal(db, PLAYER, C1, { knowledgeKind: "canon" }).entries).toHaveLength(1);
    expect(getJournal(db, PLAYER, C1, { knowledgeKind: "rumor" }).entries).toHaveLength(1);
    expect(getJournal(db, PLAYER, C1, { refId: "NPC-MARA" }).entries).toHaveLength(2);
    // Ispravljena tvrdnja se ne ispravlja ponovno (ispravlja se zamjena); tekst je nepromjenjiv u bazi.
    expect(fail(() => run([cmd("CorrectConfirmedFact", { targetEventId: rumorEvent, reason: "opet", replacement: null })])).code).toBe("rule_violation");
    expect(() => db.prepare(`UPDATE "KnowledgeAssertion" SET text = 'x' WHERE id = ?`).run(all[1]!.id)).toThrow(/ne prepisuje/);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("povlačenje tvrdnje i ispravka običnog događaja", () => {
    const r1 = run([cmd("RecordWorldFact", { subject: { kind: "location", id: "trg" }, text: "Trg je zatvoren.", knowledgeKind: "observed", visibility: "shared", sourceRef: null })]);
    run([cmd("CorrectConfirmedFact", { targetEventId: eventId(r1, "WorldFactRecorded"), reason: "Pogrešno zapisano", replacement: null })]);
    expect(getKnowledge(db, OWNER, C1, { includeHistory: true })).toEqual([expect.objectContaining({ status: "retracted", supersededById: null })]);
    expect(getKnowledge(db, OWNER, C1)).toEqual([]);
    const dmg = run([cmd("ApplyDamage", { characterId: PC, amount: 3, damageType: null })]);
    run([cmd("CorrectConfirmedFact", { targetEventId: eventId(dmg, "DamageApplied"), reason: "Šteta je trebala biti 2; ispravljeno liječenjem", replacement: null })]);
    // Zamjena moguća samo za tvrdnju; nepostojeći događaj se odbija.
    expect(fail(() => run([cmd("CorrectConfirmedFact", { targetEventId: eventId(dmg, "DamageApplied"), reason: "x", replacement: { text: "y", knowledgeKind: "canon", visibility: "player" } })])).code).toBe("rule_violation");
    expect(fail(() => run([cmd("CorrectConfirmedFact", { targetEventId: "nema", reason: "x", replacement: null })])).code).toBe("rule_violation");
    expect(getJournal(db, OWNER, C1, { q: "šteta je trebala" }).entries).toHaveLength(1);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("subjekt mora postojati i biti vidljiv autoru", () => {
    expect(fail(() => run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "Viđen je.", knowledgeKind: "observed", visibility: "player", sourceRef: null })], PLAYER)).code).toBe("rule_violation");
    expect(fail(() => run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NEMA" }, text: "x", knowledgeKind: "observed", visibility: "player", sourceRef: null })])).code).toBe("rule_violation");
    run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "DM-TAJNA: on je zvonar.", knowledgeKind: "canon", visibility: "dm", sourceRef: null })]);
  });
});

describe("Filtriranje tajni na serveru", () => {
  it("igrač i promatrač ne vide DM tvrdnje, DM ispravke ni DM bilješke — ni kroz pretragu, filtre ili broj rezultata", () => {
    const r1 = run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-MARA" }, text: "Mara čuva ključ.", knowledgeKind: "reported", visibility: "player", sourceRef: null })]);
    run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "DM-TAJNA: Tajni zlikovac je otac.", knowledgeKind: "canon", visibility: "dm", sourceRef: null })]);
    // DM ispravlja igračevu tvrdnju DM-only zamjenom: igrač i dalje „zna” staru verziju.
    run([cmd("CorrectConfirmedFact", { targetEventId: eventId(r1, "WorldFactRecorded"), reason: "DM-TAJNA istina", replacement: { text: "DM-TAJNA: ključ je kod Tajni zlikovac.", knowledgeKind: "canon", visibility: "dm" } })]);
    run([cmd("AppendJournalNote", { title: "DM-TAJNA", text: "Plan: zasjeda", visibility: "dm" })]);
    run([cmd("AppendJournalNote", { title: "Moje", text: "Pitati Maru o ključu.", visibility: "player" })], PLAYER);

    for (const actor of [PLAYER, VIEWER]) {
      const all = getJournal(db, actor, C1);
      expect(JSON.stringify(all)).not.toMatch(SECRET);
      expect(all.entries.every((e) => e.visibility !== "dm")).toBe(true);
      expect(getJournal(db, actor, C1, { q: "zasjeda" }).entries).toEqual([]);
      expect(getJournal(db, actor, C1, { q: "tajni" }).entries).toEqual([]);
      expect(getJournal(db, actor, C1, { refId: "NPC-TAJNI" }).entries).toEqual([]);
      const k = getKnowledge(db, actor, C1, { includeHistory: true });
      expect(JSON.stringify(k)).not.toMatch(SECRET);
      expect(k).toEqual([expect.objectContaining({ text: "Mara čuva ključ.", status: "active", correctedByEventId: null, supersededById: null })]);
    }
    const dm = getKnowledge(db, OWNER, C1, { includeHistory: true });
    expect(dm.map((a) => a.status)).toEqual(["superseded", "active", "active"]);
    expect(JSON.stringify(getJournal(db, OWNER, C1))).toMatch(/zasjeda/);
    // Pretraga je neosjetljiva na velika/mala slova i dijakritike.
    expect(getJournal(db, PLAYER, C1, { q: "KLJUC" }).entries.length).toBeGreaterThan(0);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("AI servis ne upisuje tvrdnje, ispravke, sesije ni revizije bilješki", () => {
    const AI = { actorId: "ai-1" };
    for (const c of [
      cmd("RecordWorldFact", { subject: { kind: "world", id: null }, text: "x", knowledgeKind: "rumor", visibility: "player", sourceRef: null }),
      cmd("CorrectConfirmedFact", { targetEventId: "x", reason: "x", replacement: null }),
      cmd("StartSession", { title: null }),
      cmd("ReviseJournalNote", { journalEntryId: "x", expectedRevision: 1, title: null, text: "x" }),
    ]) {
      expect(fail(() => run([c], AI)).code).toBe("forbidden");
    }
    for (const c of [cmd("StartSession", { title: null }), cmd("RecordWorldFact", { subject: { kind: "world", id: null }, text: "x", knowledgeKind: "rumor", visibility: "player", sourceRef: null })]) {
      expect(fail(() => run([c], VIEWER)).code).toBe("forbidden");
    }
  });

  it("SUP-19-02: javna zamjena DM-only tvrdnje ne otkriva ID ni seq skrivenih događaja", () => {
    const r1 = run([cmd("RecordWorldFact", { subject: { kind: "world", id: null }, text: "DM-TAJNA: zvonar je kultist.", knowledgeKind: "canon", visibility: "dm", sourceRef: null })]);
    const hiddenFact = eventId(r1, "WorldFactRecorded");
    const r2 = run([cmd("CorrectConfirmedFact", { targetEventId: hiddenFact, reason: "Otkriveno javno", replacement: { text: "Zvonar je nestao.", knowledgeKind: "observed", visibility: "player" } })]);
    const hiddenCorrection = eventId(r2, "FactCorrected");
    expect(db.prepare(`SELECT visibility FROM "DomainEvent" WHERE id = ?`).get(hiddenCorrection)).toEqual({ visibility: "dm" });
    for (const actor of [PLAYER, VIEWER]) {
      const k = getKnowledge(db, actor, C1, { includeHistory: true });
      expect(k).toEqual([expect.objectContaining({ text: "Zvonar je nestao.", status: "active", sourceEventId: null, createdSeq: null, correctedByEventId: null, supersededById: null })]);
      expect(JSON.stringify(k)).not.toContain(hiddenFact);
      expect(JSON.stringify(k)).not.toContain(hiddenCorrection);
    }
    // Vlasnik vidi puni trag.
    expect(getKnowledge(db, OWNER, C1, { includeHistory: true }).find((a) => a.text === "Zvonar je nestao.")).toMatchObject({ sourceEventId: hiddenCorrection, createdSeq: 2 });
  });

  it("SUP-19-03: tvrdnja vidljiva igraču ne smije otkriti skriveni subjekt (izravni upis i javna zamjena)", () => {
    // 1) Izravni upis vlasnika: player/shared tvrdnja o DM-only NPC-u se odbija.
    for (const visibility of ["player", "shared"] as const) {
      const e = fail(() => run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "Viđen na trgu.", knowledgeKind: "observed", visibility, sourceRef: null })]));
      expect(e.code).toBe("rule_violation");
      expect(e.details).toMatchObject({ reason: "hidden_subject" });
    }
    // 2) Javna zamjena DM-only tvrdnje o skrivenom NPC-u se odbija; DM zamjena je dopuštena.
    const r = run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-TAJNI" }, text: "DM-TAJNA: on je zvonar.", knowledgeKind: "canon", visibility: "dm", sourceRef: null })]);
    const target = eventId(r, "WorldFactRecorded");
    expect(fail(() => run([cmd("CorrectConfirmedFact", { targetEventId: target, reason: "javno", replacement: { text: "Zvonar je nestao.", knowledgeKind: "observed", visibility: "player" } })])).details).toMatchObject({ reason: "hidden_subject" });
    run([cmd("CorrectConfirmedFact", { targetEventId: target, reason: "DM-TAJNA precizno", replacement: { text: "DM-TAJNA: on je glavni zvonar.", knowledgeKind: "canon", visibility: "dm" } })]);
    // Tvrdnja o javnom NPC-u ostaje dopuštena.
    run([cmd("RecordWorldFact", { subject: { kind: "npc", id: "NPC-MARA" }, text: "Mara zna put.", knowledgeKind: "reported", visibility: "player", sourceRef: null })]);
    for (const actor of [PLAYER, VIEWER]) {
      expect(JSON.stringify(getKnowledge(db, actor, C1, { includeHistory: true }))).not.toMatch(SECRET);
      expect(JSON.stringify(getJournal(db, actor, C1))).not.toMatch(SECRET);
    }
    expect(getKnowledge(db, OWNER, C1, { includeHistory: true }).filter((a) => a.subjectId === "NPC-TAJNI")).toHaveLength(2);
    expect(verifyReplay(db, C1).ok).toBe(true);
  });

  it("stranac nema pristup dnevniku ni znanju", () => {
    expect(fail(() => getJournal(db, { actorId: "stranger" }, C1)).code).toBe("forbidden");
    expect(fail(() => getKnowledge(db, { actorId: "stranger" }, C1)).code).toBe("forbidden");
  });
});

describe("Straničenje dnevnika (SUP-19-01)", () => {
  it("unosi istog zadnjeg događaja ne ispadaju na granici stranice (limit 1)", () => {
    const n = run([cmd("AppendJournalNote", { title: "A", text: "prva", visibility: "player" })]);
    run([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    // Revizija veže isti događaj na bilješku i na projekcijski unos batcha: dva unosa dijele lastSeq.
    run([cmd("ReviseJournalNote", { journalEntryId: n.journalEntryIds.at(-1)!, expectedRevision: 1, title: "A", text: "druga" })]);
    const all = getJournal(db, OWNER, C1).entries;
    expect(all[0]!.lastSeq).toBe(all[1]!.lastSeq);
    const paged: string[] = [];
    let cursor = null as ReturnType<typeof getJournal>["nextCursor"];
    for (let i = 0; i < 10; i++) {
      const page = getJournal(db, OWNER, C1, { limit: 1, cursor });
      paged.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(paged).toEqual(all.map((e) => e.id));
    expect(new Set(paged).size).toBe(all.length);
  });
});

describe("Ponovno generiranje projekcija", () => {
  it("projekcije iz događaja jednake su spremljenima; neovlaštena izmjena se otkriva", () => {
    run([cmd("StartSession", { title: "Prva" })]);
    const n = run([cmd("AppendJournalNote", { title: "A", text: "prva", visibility: "player" }), cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]);
    run([cmd("ReviseJournalNote", { journalEntryId: n.journalEntryIds.at(-1)!, expectedRevision: 1, title: "A", text: "druga" })]);
    const f = run([cmd("RecordWorldFact", { subject: { kind: "world", id: null }, text: "Zvona šute.", knowledgeKind: "inferred", visibility: "player", sourceRef: null })]);
    run([cmd("CorrectConfirmedFact", { targetEventId: eventId(f, "WorldFactRecorded"), reason: "Zvona ipak zvone", replacement: { text: "Zvona zvone u ponoć.", knowledgeKind: "observed", visibility: "player" } })]);
    expect(verifyJournalProjections(db, C1)).toEqual({ ok: true, problems: [] });
    // Promjena teksta projekcije izvan domene otkriva se pri provjeri.
    db.prepare(`UPDATE "JournalEntry" SET text = 'krivotvoreno' WHERE campaignId = ? AND kind = 'projection' AND id = (SELECT id FROM "JournalEntry" WHERE kind = 'projection' LIMIT 1)`).run(C1);
    const v = verifyJournalProjections(db, C1);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/ne odgovara ponovno generiranoj projekciji/);
    expect(verifyReplay(db, C1).ok).toBe(false);
  });
});
