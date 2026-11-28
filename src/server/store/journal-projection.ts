import type { DomainEventBody, Visibility } from "@/domain/events";
import { describeEvent } from "@/domain/journal";
import type { Db } from "./connection";

/**
 * Determinističko ponovno generiranje projekcija dnevnika, znanja i sesija iz događaja (Faza 4).
 * Ne piše ništa: rezultat se uspoređuje sa spremljenim tablicama (`verifyJournalProjections`).
 */

export type EventRow = {
  id: string;
  seq: number;
  batchId: string;
  type: DomainEventBody["type"];
  payload: DomainEventBody["payload"];
  visibility: Visibility;
  actorId: string;
  occurredAt: string;
  sessionId: string | null;
};

export type ProjectedEntry = { key: string; kind: "projection" | "manual"; title: string | null; text: string; visibility: Visibility; revision: number; eventIds: string[] };
export type ProjectedAssertion = {
  id: string;
  subjectKind: string;
  subjectId: string | null;
  text: string;
  knowledgeKind: string;
  visibility: Visibility;
  sourceRef: string | null;
  status: "active" | "superseded" | "retracted";
  sourceEventId: string;
  createdSeq: number;
  correctedByEventId: string | null;
  supersededById: string | null;
};
export type ProjectedSession = {
  id: string;
  number: number;
  title: string | null;
  status: "open" | "closed";
  startVersion: number;
  endVersion: number | null;
  startedSeq: number;
  endedSeq: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type Projections = { entries: Map<string, ProjectedEntry>; knowledge: Map<string, ProjectedAssertion>; sessions: Map<string, ProjectedSession> };

const isNote = (t: string) => t === "JournalNoteAppended";

/** Projekcije iz događaja redom `seq`. Ključ projekcijskog unosa je `batchId|visibility|sessionId`, bilješke `note:<id>`. */
export function buildProjections(events: EventRow[]): Projections {
  const entries = new Map<string, ProjectedEntry>();
  const knowledge = new Map<string, ProjectedAssertion>();
  const sessions = new Map<string, ProjectedSession>();
  for (const e of events) {
    const body = { type: e.type, payload: e.payload } as DomainEventBody;
    if (isNote(e.type)) {
      const p = (body as Extract<DomainEventBody, { type: "JournalNoteAppended" }>).payload;
      entries.set(`note:${p.journalEntryId}`, { key: `note:${p.journalEntryId}`, kind: "manual", title: p.title, text: p.text, visibility: e.visibility, revision: 1, eventIds: [e.id] });
      continue;
    }
    const key = `${e.batchId}|${e.visibility}|${e.sessionId ?? "-"}`;
    const entry = entries.get(key) ?? { key, kind: "projection" as const, title: null, text: "", visibility: e.visibility, revision: 1, eventIds: [] };
    entry.text = entry.text ? `${entry.text}\n${describeEvent(body)}` : describeEvent(body);
    entry.eventIds.push(e.id);
    entries.set(key, entry);

    switch (body.type) {
      case "JournalNoteRevised": {
        const n = entries.get(`note:${body.payload.journalEntryId}`);
        if (n) {
          n.title = body.payload.title;
          n.text = body.payload.text;
          n.revision = body.payload.revisionAfter;
          n.eventIds.push(e.id);
        }
        break;
      }
      case "WorldFactRecorded":
        knowledge.set(body.payload.assertionId, {
          id: body.payload.assertionId,
          subjectKind: body.payload.subjectKind,
          subjectId: body.payload.subjectId,
          text: body.payload.text,
          knowledgeKind: body.payload.knowledgeKind,
          visibility: e.visibility,
          sourceRef: body.payload.sourceRef,
          status: "active",
          sourceEventId: e.id,
          createdSeq: e.seq,
          correctedByEventId: null,
          supersededById: null,
        });
        break;
      case "FactCorrected": {
        const r = body.payload.replacement;
        const old = body.payload.assertionId ? knowledge.get(body.payload.assertionId) : undefined;
        if (old) {
          old.status = r ? "superseded" : "retracted";
          old.correctedByEventId = e.id;
          old.supersededById = r?.assertionId ?? null;
        }
        if (r) {
          knowledge.set(r.assertionId, {
            id: r.assertionId,
            subjectKind: r.subjectKind,
            subjectId: r.subjectId,
            text: r.text,
            knowledgeKind: r.knowledgeKind,
            visibility: r.visibility,
            sourceRef: null,
            status: "active",
            sourceEventId: e.id,
            createdSeq: e.seq,
            correctedByEventId: null,
            supersededById: null,
          });
        }
        break;
      }
      case "SessionStarted":
        sessions.set(body.payload.sessionId, {
          id: body.payload.sessionId,
          number: body.payload.number,
          title: body.payload.title,
          status: "open",
          startVersion: body.payload.startVersion,
          endVersion: null,
          startedSeq: e.seq,
          endedSeq: null,
          startedAt: e.occurredAt,
          endedAt: null,
        });
        break;
      case "SessionEnded": {
        const s = sessions.get(body.payload.sessionId);
        if (s) Object.assign(s, { status: "closed", endVersion: body.payload.endVersion, endedSeq: e.seq, endedAt: e.occurredAt });
        break;
      }
      default:
        break;
    }
  }
  return { entries, knowledge, sessions };
}

export function loadEventRows(db: Db, campaignId: string): EventRow[] {
  return (
    db
      .prepare(`SELECT id, seq, batchId, type, payloadJson, visibility, actorId, occurredAt, sessionId FROM "DomainEvent" WHERE campaignId = ? ORDER BY seq`)
      .all(campaignId) as (Omit<EventRow, "payload"> & { payloadJson: string })[]
  ).map(({ payloadJson, ...r }) => ({ ...r, payload: JSON.parse(payloadJson) }));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Ponovno generira projekcije iz događaja i uspoređuje ih sa spremljenima. */
export function verifyJournalProjections(db: Db, campaignId: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const p = buildProjections(loadEventRows(db, campaignId));

  const stored = db
    .prepare(`SELECT id, batchId, kind, title, text, visibility, revision FROM "JournalEntry" WHERE campaignId = ?`)
    .all(campaignId) as { id: string; batchId: string | null; kind: string; title: string | null; text: string; visibility: Visibility; revision: number }[];
  const linksStmt = db.prepare(`SELECT l.eventId, e.sessionId FROM "JournalEventLink" l JOIN "DomainEvent" e ON e.campaignId = l.campaignId AND e.id = l.eventId WHERE l.campaignId = ? AND l.journalEntryId = ? ORDER BY e.seq`);
  const seen = new Set<string>();
  for (const s of stored) {
    if (s.kind === "summary") continue;
    const linkRows = linksStmt.all(campaignId, s.id) as { eventId: string; sessionId: string | null }[];
    const key = s.kind === "manual" ? `note:${s.id}` : `${s.batchId}|${s.visibility}|${linkRows[0]?.sessionId ?? "-"}`;
    const exp = p.entries.get(key);
    if (!exp) {
      problems.push(`Dnevnik: unos ${s.id} nema izvorni događaj.`);
      continue;
    }
    seen.add(key);
    const links = linkRows.map((l) => l.eventId);
    const got = { kind: s.kind, title: s.title, text: s.text, visibility: s.visibility, revision: s.revision, eventIds: links };
    const want = { kind: exp.kind, title: exp.title, text: exp.text, visibility: exp.visibility, revision: exp.revision, eventIds: exp.eventIds };
    if (!same(got, want)) problems.push(`Dnevnik: unos ${s.id} ne odgovara ponovno generiranoj projekciji.`);
  }
  for (const k of p.entries.keys()) if (!seen.has(k)) problems.push(`Dnevnik: nedostaje unos za ${k}.`);

  const storedK = db
    .prepare(
      `SELECT id, subjectKind, subjectId, text, knowledgeKind, visibility, sourceRef, status, sourceEventId, createdSeq, correctedByEventId, supersededById FROM "KnowledgeAssertion" WHERE campaignId = ?`,
    )
    .all(campaignId) as ProjectedAssertion[];
  if (storedK.length !== p.knowledge.size) problems.push(`Znanje: ${storedK.length} spremljenih tvrdnji, očekivano ${p.knowledge.size}.`);
  for (const a of storedK) if (!same(a, p.knowledge.get(a.id))) problems.push(`Znanje: tvrdnja ${a.id} ne odgovara događajima.`);

  const storedS = db
    .prepare(`SELECT id, number, title, status, startVersion, endVersion, startedSeq, endedSeq, startedAt, endedAt FROM "Session" WHERE campaignId = ?`)
    .all(campaignId) as ProjectedSession[];
  if (storedS.length !== p.sessions.size) problems.push(`Sesije: ${storedS.length} spremljenih, očekivano ${p.sessions.size}.`);
  for (const s of storedS) if (!same(s, p.sessions.get(s.id))) problems.push(`Sesije: sesija ${s.id} ne odgovara događajima.`);

  // Sesija događaja: svaki događaj nosi sesiju otvorenu u tom trenutku.
  const evSessions = db.prepare(`SELECT seq, type, payloadJson, sessionId FROM "DomainEvent" WHERE campaignId = ? ORDER BY seq`).all(campaignId) as {
    seq: number;
    type: string;
    payloadJson: string;
    sessionId: string | null;
  }[];
  let current: string | null = null;
  for (const e of evSessions) {
    const payload = JSON.parse(e.payloadJson) as { sessionId?: string };
    if (e.type === "SessionStarted") {
      current = payload.sessionId ?? null;
    }
    if (e.sessionId !== current) problems.push(`Sesije: događaj #${e.seq} ima sesiju ${e.sessionId ?? "—"}, očekivano ${current ?? "—"}.`);
    if (e.type === "SessionEnded") current = null;
  }
  return { ok: problems.length === 0, problems };
}
