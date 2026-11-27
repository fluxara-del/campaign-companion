import type { Visibility } from "@/domain/events";
import { DomainError } from "@/domain/errors";
import type { Actor } from "./batch-service";
import type { Db } from "./connection";
import { visibilityClause } from "./state-repo";

/**
 * Read model dnevnika i znanja (Faza 4). Vidljivost se primjenjuje u SQL-u PRIJE filtara i pretrage,
 * pa ni broj rezultata, ni ID-jevi, ni metapodaci DM sadržaja ne dolaze do igrača ili promatrača.
 */

export type JournalFilters = {
  sessionId?: string | null;
  /** Lik, NPC ili drugi subjekt koji se pojavljuje u povezanim događajima. */
  refId?: string | null;
  kind?: "manual" | "projection" | null;
  knowledgeKind?: "observed" | "reported" | "rumor" | "inferred" | "canon" | null;
  q?: string | null;
  /** Stranica: unosi iza ovog kursora u poretku prikaza (kursor iz prethodne stranice). */
  cursor?: JournalCursor | null;
  limit?: number;
};

export type JournalEventView = { id: string; seq: number; type: string; knowledgeKind: string | null; sessionId: string | null; refs: string[] };
export type JournalEntryView = {
  id: string;
  kind: "manual" | "projection" | "summary";
  title: string | null;
  text: string;
  visibility: Visibility;
  revision: number;
  createdAt: string;
  sessionId: string | null;
  lastSeq: number;
  events: JournalEventView[];
};
export type SessionView = { id: string; number: number; title: string | null; status: "open" | "closed"; startVersion: number; endVersion: number | null; startedAt: string; endedAt: string | null };
/** Složeni kursor koji prati poredak prikaza (lastSeq silazno, zatim id uzlazno): više unosa istog batcha dijeli lastSeq. */
export type JournalCursor = { lastSeq: number; id: string };
export type JournalPage = { campaignId: string; stateVersion: number; sessions: SessionView[]; entries: JournalEntryView[]; nextCursor: JournalCursor | null };

/** Poredak prikaza: najnovije prvo, pa po ID-u. */
const byDisplayOrder = (a: { lastSeq: number; id: string }, b: { lastSeq: number; id: string }) => b.lastSeq - a.lastSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const REF_KEYS = new Set(["characterId", "holderRef", "subjectId", "ownerRef"]);

/** ID-jevi likova/NPC-eva/subjekata koje događaj spominje (za filtar „po liku/NPC-u”). */
export function eventRefs(payload: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (REF_KEYS.has(k) && typeof x === "string") out.add(x);
        else walk(x);
      }
    }
  };
  walk(payload);
  return [...out].sort();
}

/** Pretraga bez obzira na velika/mala slova i dijakritike (č/ć/š/ž/đ). */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("hr").replace(/\s+/g, " ").trim();
}

export function memberRole(db: Db, actor: Actor, campaignId: string): string {
  const m = db.prepare(`SELECT role FROM "Member" WHERE campaignId = ? AND actorId = ?`).get(campaignId, actor.actorId) as { role: string } | undefined;
  if (!m) throw new DomainError("forbidden", "Nemate pristup ovoj kampanji.");
  return m.role;
}

export function getJournal(db: Db, actor: Actor, campaignId: string, filters: JournalFilters = {}): JournalPage {
  return db
    .transaction(() => {
      const role = memberRole(db, actor, campaignId);
      const vis = visibilityClause(role);
      const { stateVersion } = db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(campaignId) as { stateVersion: number };
      const sessions = db
        .prepare(`SELECT id, number, title, status, startVersion, endVersion, startedAt, endedAt FROM "Session" WHERE campaignId = ? ORDER BY number`)
        .all(campaignId) as SessionView[];

      const rows = db
        .prepare(`SELECT id, kind, title, text, visibility, revision, createdAt FROM "JournalEntry" WHERE campaignId = ? AND ${vis}`)
        .all(campaignId) as Omit<JournalEntryView, "events" | "sessionId" | "lastSeq">[];
      const evStmt = db.prepare(
        `SELECT e.id, e.seq, e.type, e.knowledgeKind, e.sessionId, e.payloadJson FROM "JournalEventLink" l
           JOIN "DomainEvent" e ON e.campaignId = l.campaignId AND e.id = l.eventId
          WHERE l.campaignId = ? AND l.journalEntryId = ? AND ${vis.replace(/visibility/g, "e.visibility")} ORDER BY e.seq`,
      );

      const q = filters.q ? normalizeSearch(filters.q) : "";
      const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
      const entries: JournalEntryView[] = [];
      for (const r of rows) {
        const events = (evStmt.all(campaignId, r.id) as { id: string; seq: number; type: string; knowledgeKind: string | null; sessionId: string | null; payloadJson: string }[]).map(
          ({ payloadJson, ...e }) => ({ ...e, refs: eventRefs(JSON.parse(payloadJson)) }),
        );
        if (events.length === 0) continue; // unos bez vidljivog izvornog događaja se ne prikazuje
        const lastSeq = events.at(-1)!.seq;
        const entry: JournalEntryView = { ...r, sessionId: events[0]!.sessionId, lastSeq, events };
        if (filters.kind && entry.kind !== filters.kind) continue;
        if (filters.sessionId && !events.some((e) => e.sessionId === filters.sessionId)) continue;
        if (filters.refId && !events.some((e) => e.refs.includes(filters.refId!))) continue;
        if (filters.knowledgeKind && !events.some((e) => e.knowledgeKind === filters.knowledgeKind)) continue;
        if (filters.cursor && byDisplayOrder(entry, filters.cursor) <= 0) continue;
        if (q && !normalizeSearch(`${entry.title ?? ""} ${entry.text}`).includes(q)) continue;
        entries.push(entry);
      }
      // Najnovije prvo; stabilno po zadnjem povezanom događaju.
      entries.sort(byDisplayOrder);
      const page = entries.slice(0, limit);
      return { campaignId, stateVersion, sessions, entries: page, nextCursor: entries.length > limit ? { lastSeq: page.at(-1)!.lastSeq, id: page.at(-1)!.id } : null };
    })
    .deferred();
}

export type AssertionView = {
  id: string;
  subjectKind: string;
  subjectId: string | null;
  text: string;
  knowledgeKind: string;
  visibility: Visibility;
  sourceRef: string | null;
  status: "active" | "superseded" | "retracted";
  /** Za igrača null ako je izvorni događaj vidljiv samo DM-u (npr. javna zamjena nastala DM-only ispravkom). */
  sourceEventId: string | null;
  createdSeq: number | null;
  correctedByEventId: string | null;
  supersededById: string | null;
};

/**
 * Tvrdnje koje uloga smije vidjeti. Ispravka vidljiva samo DM-u ne mijenja ono što igrač zna:
 * za igrača tvrdnja ostaje aktivna i bez reference na skrivenu ispravku ili zamjenu.
 */
export type KnowledgeFilter = { subjectKind?: string; subjectId?: string; includeHistory?: boolean };

export function getKnowledge(db: Db, actor: Actor, campaignId: string, filter: KnowledgeFilter = {}): AssertionView[] {
  return db.transaction(() => getKnowledgeForRole(db, campaignId, memberRole(db, actor, campaignId), filter)).deferred();
}

/** Isto kao `getKnowledge`, za zadanu ulogu (npr. player izvoz koji pokreće vlasnik). Poziva se unutar transakcije. */
export function getKnowledgeForRole(db: Db, campaignId: string, role: string, filter: KnowledgeFilter = {}): AssertionView[] {
  const owner = role === "owner";
  const rows = db
    .prepare(
      `SELECT a.id, a.subjectKind, a.subjectId, a.text, a.knowledgeKind, a.visibility, a.sourceRef, a.status, a.sourceEventId, a.createdSeq, a.correctedByEventId, a.supersededById,
              (SELECT e.visibility FROM "DomainEvent" e WHERE e.campaignId = a.campaignId AND e.id = a.correctedByEventId) AS correctionVisibility,
              (SELECT e.visibility FROM "DomainEvent" e WHERE e.campaignId = a.campaignId AND e.id = a.sourceEventId) AS sourceVisibility,
              (SELECT r.visibility FROM "KnowledgeAssertion" r WHERE r.campaignId = a.campaignId AND r.id = a.supersededById) AS replacementVisibility
         FROM "KnowledgeAssertion" a WHERE a.campaignId = ? AND ${visibilityClause(role).replace(/visibility/g, "a.visibility")} ORDER BY a.createdSeq, a.id`,
    )
    .all(campaignId) as (AssertionView & { correctionVisibility: Visibility | null; sourceVisibility: Visibility | null; replacementVisibility: Visibility | null })[];
  return rows
    .map(({ correctionVisibility, sourceVisibility, replacementVisibility, ...a }) => {
      if (owner) return a;
      // Za ostale uloge nijedna referenca ne smije pokazivati na događaj ili tvrdnju vidljivu samo DM-u.
      const v: AssertionView = { ...a };
      if (sourceVisibility === "dm") {
        v.sourceEventId = null;
        v.createdSeq = null;
      }
      if (correctionVisibility === "dm") Object.assign(v, { status: "active", correctedByEventId: null, supersededById: null });
      else if (replacementVisibility === "dm") v.supersededById = null;
      return v;
    })
    .filter((a) => (filter.subjectKind ? a.subjectKind === filter.subjectKind : true))
    .filter((a) => (filter.subjectId ? a.subjectId === filter.subjectId : true))
    .filter((a) => filter.includeHistory || a.status === "active");
}
