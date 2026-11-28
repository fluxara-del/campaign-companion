import type { MemberRole } from "@/domain/authz";
import type { DomainEventBody, EventDraft, Visibility } from "@/domain/events";
import type { EventInfo, JournalContext } from "@/domain/rules";
import type { Db } from "./connection";
import { visibilityClause } from "./state-repo";

/**
 * Faza 4: projekcije dnevnika, znanja i sesija. Izvor istine su događaji (`DomainEvent`); ove tablice
 * su izvedene, pišu se u istoj transakciji batcha i mogu se ponovno izračunati (`journal-projection.ts`).
 */

type AssertionRow = { id: string; status: "active" | "superseded" | "retracted"; visibility: Visibility; subjectKind: "npc" | "quest" | "location" | "world"; subjectId: string | null };

/** Kontekst za `decide` na početku batcha (stanje projekcija u istoj transakciji). */
export function loadJournalContext(db: Db, campaignId: string, actorId: string, role: MemberRole, stateVersionAfter: number): JournalContext {
  const notes = new Map<string, { authorActorId: string | null; revision: number; visibility: Visibility }>();
  const noteRows = db
    .prepare(
      `SELECT j.id, j.revision, j.visibility,
              (SELECT e.actorId FROM "JournalEventLink" l JOIN "DomainEvent" e ON e.campaignId = l.campaignId AND e.id = l.eventId
                WHERE l.campaignId = j.campaignId AND l.journalEntryId = j.id AND e.type = 'JournalNoteAppended' LIMIT 1) AS author
         FROM "JournalEntry" j WHERE j.campaignId = ? AND j.kind = 'manual'`,
    )
    .all(campaignId) as { id: string; revision: number; visibility: Visibility; author: string | null }[];
  for (const n of noteRows) notes.set(n.id, { authorActorId: n.author, revision: n.revision, visibility: n.visibility });

  const knowledge = new Map<string, Omit<AssertionRow, "id">>();
  for (const a of db
    .prepare(`SELECT id, status, visibility, subjectKind, subjectId FROM "KnowledgeAssertion" WHERE campaignId = ?`)
    .all(campaignId) as AssertionRow[]) {
    knowledge.set(a.id, { status: a.status, visibility: a.visibility, subjectKind: a.subjectKind, subjectId: a.subjectId });
  }

  const open = db.prepare(`SELECT id, number FROM "Session" WHERE campaignId = ? AND status = 'open'`).get(campaignId) as { id: string; number: number } | undefined;
  const last = db.prepare(`SELECT COALESCE(MAX(number), 0) AS n FROM "Session" WHERE campaignId = ?`).get(campaignId) as { n: number };

  const findEventStmt = db.prepare(`SELECT id, seq, type, visibility, payloadJson FROM "DomainEvent" WHERE campaignId = ? AND id = ?`);
  const publicSubjectStmt = db.prepare(`SELECT 1 FROM "EntityRecord" WHERE campaignId = ? AND kind = ? AND id = ? AND ${visibilityClause("player")}`);
  const subjectStmt = db.prepare(`SELECT 1 FROM "EntityRecord" WHERE campaignId = ? AND kind = ? AND id = ? AND ${visibilityClause(role)}`);

  return {
    actorId,
    isOwner: role === "owner",
    stateVersionAfter,
    notes,
    knowledge,
    openSession: open ?? null,
    lastSessionNumber: last.n,
    findEvent: (eventId) => {
      const r = findEventStmt.get(campaignId, eventId) as { id: string; seq: number; type: string; visibility: Visibility; payloadJson: string } | undefined;
      if (!r) return null;
      return { id: r.id, seq: r.seq, type: r.type, visibility: r.visibility, assertionId: assertionOf({ type: r.type, payload: JSON.parse(r.payloadJson) } as DomainEventBody) } satisfies EventInfo;
    },
    subjectVisible: (kind, id) => subjectStmt.get(campaignId, kind, id) !== undefined,
    subjectPublic: (kind, id) => publicSubjectStmt.get(campaignId, kind, id) !== undefined,
  };
}

/** Tvrdnja koju je događaj stvorio (izvorna ili zamjenska); null za ostale događaje. */
export function assertionOf(e: DomainEventBody): string | null {
  if (e.type === "WorldFactRecorded") return e.payload.assertionId;
  if (e.type === "FactCorrected") return e.payload.replacement?.assertionId ?? null;
  return null;
}

export type StoredEvent = { id: string; seq: number; draft: EventDraft };

/**
 * Sesija kojoj pripada svaki događaj batcha: otvorena na početku batcha, a nakon SessionStarted
 * nova; SessionEnded pripada sesiji koju zatvara, a događaji poslije njega nisu u sesiji.
 */
export function assignSessions(openAtStart: string | null, drafts: EventDraft[]): (string | null)[] {
  let current = openAtStart;
  return drafts.map((d) => {
    if (d.type === "SessionStarted") current = d.payload.sessionId;
    const s = current;
    if (d.type === "SessionEnded") current = null;
    return s;
  });
}

function mustChange(res: { changes: number }, what: string) {
  if (res.changes !== 1) throw new Error(`Projekcija (${what}) nije ažurirana.`);
}

/** Upis projekcija znanja, sesija i revizija bilješki za događaje batcha (u istoj transakciji). */
export function applyJournalProjections(db: Db, campaignId: string, events: StoredEvent[], committedAt: string): void {
  const insAssertion = db.prepare(
    `INSERT INTO "KnowledgeAssertion" (id, campaignId, subjectKind, subjectId, text, knowledgeKind, visibility, sourceRef, status, sourceEventId, createdSeq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  for (const e of events) {
    const d = e.draft;
    switch (d.type) {
      case "JournalNoteRevised":
        mustChange(
          db
            .prepare(`UPDATE "JournalEntry" SET title = ?, text = ?, revision = ? WHERE campaignId = ? AND id = ? AND kind = 'manual' AND revision = ?`)
            .run(d.payload.title, d.payload.text, d.payload.revisionAfter, campaignId, d.payload.journalEntryId, d.payload.revisionBefore),
          `bilješka ${d.payload.journalEntryId}`,
        );
        db.prepare(`INSERT INTO "JournalEventLink" (campaignId, journalEntryId, eventId) VALUES (?, ?, ?)`).run(campaignId, d.payload.journalEntryId, e.id);
        break;
      case "WorldFactRecorded":
        insAssertion.run(d.payload.assertionId, campaignId, d.payload.subjectKind, d.payload.subjectId, d.payload.text, d.payload.knowledgeKind, d.visibility, d.payload.sourceRef, e.id, e.seq);
        break;
      case "FactCorrected": {
        const r = d.payload.replacement;
        if (d.payload.assertionId) {
          mustChange(
            db
              .prepare(`UPDATE "KnowledgeAssertion" SET status = ?, correctedByEventId = ?, supersededById = ? WHERE campaignId = ? AND id = ? AND status = 'active'`)
              .run(r ? "superseded" : "retracted", e.id, r?.assertionId ?? null, campaignId, d.payload.assertionId),
            `tvrdnja ${d.payload.assertionId}`,
          );
        }
        if (r) insAssertion.run(r.assertionId, campaignId, r.subjectKind, r.subjectId, r.text, r.knowledgeKind, r.visibility, null, e.id, e.seq);
        break;
      }
      case "SessionStarted":
        db.prepare(
          `INSERT INTO "Session" (id, campaignId, number, title, status, startVersion, startedSeq, startedAt) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
        ).run(d.payload.sessionId, campaignId, d.payload.number, d.payload.title, d.payload.startVersion, e.seq, committedAt);
        break;
      case "SessionEnded":
        mustChange(
          db
            .prepare(`UPDATE "Session" SET status = 'closed', endVersion = ?, endedSeq = ?, endedAt = ? WHERE campaignId = ? AND id = ? AND status = 'open'`)
            .run(d.payload.endVersion, e.seq, committedAt, campaignId, d.payload.sessionId),
          `sesija ${d.payload.sessionId}`,
        );
        break;
      default:
        break;
    }
  }
}
