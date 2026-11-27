import { randomUUID } from "node:crypto";
import { actorKindFor, authorizeBatch, type MemberRole } from "@/domain/authz";
import { parseBatch, type CommandBatch } from "@/domain/commands";
import { DomainError } from "@/domain/errors";
import type { EventDraft } from "@/domain/events";
import { describeEvent } from "@/domain/journal";
import { applyEvent } from "@/domain/reducer";
import { applyToJournalContext, decide } from "@/domain/rules";
import { cloneState } from "@/domain/state";
import { isBusyError, isUniqueViolation, type Db } from "./connection";
import { applyJournalProjections, assignSessions, loadJournalContext } from "./journal-store";
import { loadHiddenHolderRefs, loadKnownHolderRefs, loadState, persistChanges } from "./state-repo";

export type Actor = { actorId: string };

export type BatchResponse = {
  batchId: string;
  campaignId: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  firstSeq: number;
  lastSeq: number;
  events: { id: string; seq: number; commandId: string; type: string }[];
  journalEntryIds: string[];
  committedAt: string;
};

export type BatchResult = BatchResponse & { replayed: boolean };

export type ExecuteOptions = {
  now?: () => string;
  newId?: () => string;
  /** Samo za testove: izvršava se unutar transakcije neposredno prije COMMIT-a. */
  beforeCommit?: () => void;
  /** Samo za testove: izvršava se nakon COMMIT-a, prije vraćanja odgovora (simulacija prekida). */
  afterCommit?: (result: BatchResult) => void;
};

type CampaignRow = { id: string; stateVersion: number; lastEventSeq: number };
type ReceiptRow = { requestHash: string; responseJson: string; actorId: string };

function requireMember(db: Db, campaignId: string, actor: Actor): MemberRole {
  const member = db
    .prepare(`SELECT role FROM "Member" WHERE campaignId = ? AND actorId = ?`)
    .get(campaignId, actor.actorId) as { role: MemberRole } | undefined;
  // Nepostojeća i tuđa kampanja daju isti odgovor: ne otkrivamo postoji li kampanja.
  if (!member) throw new DomainError("forbidden", "Nemate pristup ovoj kampanji.");
  return member.role;
}

/**
 * Pravilo pristupa potvrdi batcha (isto za `GET …/batches/:batchId` i za ponavljanje batcha):
 * potvrdu smije vidjeti samo akter koji je batch poslao ili vlasnik kampanje. Ostali članovi
 * (player, ai_service, viewer) ne dobivaju ni metapodatke (ID-jeve događaja, ID-jeve bilješki).
 */
function canReadReceipt(role: MemberRole, actor: Actor, row: ReceiptRow): boolean {
  return row.actorId === actor.actorId || role === "owner";
}

function replayOrConflict(row: ReceiptRow, requestHash: string, batchId: string, role: MemberRole, actor: Actor): BatchResult {
  // Tuđi batch: ID je zauzet, ali se ne otkriva ništa o njegovu sadržaju ni ishodu.
  if (!canReadReceipt(role, actor, row) || row.requestHash !== requestHash) {
    throw new DomainError("batch_id_reused", "Isti batchId već je potvrđen s drugačijim sadržajem.", { batchId });
  }
  return { ...(JSON.parse(row.responseJson) as BatchResponse), replayed: true };
}

function runInTransaction(
  db: Db,
  actor: Actor,
  batch: CommandBatch,
  requestHash: string,
  opts: Required<Pick<ExecuteOptions, "now" | "newId">> & ExecuteOptions,
): BatchResult {
  const { campaignId, batchId } = batch;

  // 1) Pristup kampanji i ovlasti (prije bilo kakvog otkrivanja receipt-a).
  const role = requireMember(db, campaignId, actor);
  authorizeBatch(role, batch.commands);

  // 2) Idempotentnost: isti batch → spremljeni odgovor bez upisa, neovisno o trenutačnoj verziji.
  const receipt = db
    .prepare(`SELECT requestHash, responseJson, actorId FROM "BatchReceipt" WHERE campaignId = ? AND batchId = ?`)
    .get(campaignId, batchId) as ReceiptRow | undefined;
  if (receipt) return replayOrConflict(receipt, requestHash, batchId, role, actor);

  // 3) Zabrana ponovne uporabe naredbe iz drugog batcha.
  const findCommand = db.prepare(`SELECT batchId FROM "CommandIndex" WHERE campaignId = ? AND commandId = ?`);
  batch.commands.forEach((c, commandIndex) => {
    const used = findCommand.get(campaignId, c.commandId) as { batchId: string } | undefined;
    if (used) {
      throw new DomainError("command_id_reused", "Naredba je već potvrđena u drugom batchu.", {
        commandIndex,
        commandId: c.commandId,
      });
    }
  });

  // 4) Optimistična konkurentnost.
  const campaign = db
    .prepare(`SELECT id, stateVersion, lastEventSeq FROM "Campaign" WHERE id = ?`)
    .get(campaignId) as CampaignRow;
  if (campaign.stateVersion !== batch.expectedStateVersion) {
    throw new DomainError("stale_version", "Stanje se promijenilo od učitavanja.", {
      expectedStateVersion: batch.expectedStateVersion,
      currentStateVersion: campaign.stateVersion,
    });
  }

  // 5) Pravila redom naredbi; svaka naredba vidi stanje nakon prethodnih.
  const before = loadState(db, campaignId);
  const knownHolderRefs = loadKnownHolderRefs(db, campaignId, role);
  const hiddenHolderRefs = loadHiddenHolderRefs(db, campaignId);
  const journal = loadJournalContext(db, campaignId, actor.actorId, role, campaign.stateVersion + 1);
  const openSessionAtStart = journal.openSession?.id ?? null;
  const working = cloneState(before);
  const drafts: { commandId: string; draft: EventDraft }[] = [];
  batch.commands.forEach((command, commandIndex) => {
    for (const draft of decide(working, command, { commandIndex, newId: opts.newId, knownHolderRefs, hiddenHolderRefs, journal })) {
      applyEvent(working, draft);
      applyToJournalContext(journal, draft);
      drafts.push({ commandId: command.commandId, draft });
    }
  });
  if (drafts.length === 0) throw new Error("Batch nije proizveo nijedan događaj.");

  // 6) Atomski upis: stanje, receipt, indeks naredbi, događaji, journal, verzija.
  const committedAt = opts.now();
  const actorKind = actorKindFor(role);
  const stateVersionAfter = campaign.stateVersion + 1;
  const firstSeq = campaign.lastEventSeq + 1;
  const sessions = assignSessions(openSessionAtStart, drafts.map((d) => d.draft));
  const events = drafts.map((d, i) => ({ ...d, id: opts.newId(), seq: firstSeq + i, sessionId: sessions[i]! }));
  const lastSeq = events.at(-1)!.seq;

  persistChanges(db, before, working);

  const journalEntryIds: string[] = [];
  const mechanical = events.filter((e) => e.draft.type !== "JournalNoteAppended");
  // Jedna projekcija po vidljivosti: DM-only događaji (npr. transfer skrivenom NPC-u) ne ulaze u unos koji vide igrači.
  const projections: { id: string; visibility: EventDraft["visibility"]; events: typeof mechanical }[] = [];
  for (const e of mechanical) {
    let p = projections.find((x) => x.visibility === e.draft.visibility);
    if (!p) {
      p = { id: opts.newId(), visibility: e.draft.visibility, events: [] };
      projections.push(p);
      journalEntryIds.push(p.id);
    }
    p.events.push(e);
  }
  for (const e of events) {
    if (e.draft.type === "JournalNoteAppended") journalEntryIds.push(e.draft.payload.journalEntryId);
  }

  const response: BatchResponse = {
    batchId,
    campaignId,
    stateVersionBefore: campaign.stateVersion,
    stateVersionAfter,
    firstSeq,
    lastSeq,
    events: events.map((e) => ({ id: e.id, seq: e.seq, commandId: e.commandId, type: e.draft.type })),
    journalEntryIds,
    committedAt,
  };

  db.prepare(
    `INSERT INTO "BatchReceipt" (campaignId, batchId, requestHash, actorId, stateVersionBefore, stateVersionAfter, firstSeq, lastSeq, responseJson, committedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    campaignId,
    batchId,
    requestHash,
    actor.actorId,
    campaign.stateVersion,
    stateVersionAfter,
    firstSeq,
    lastSeq,
    JSON.stringify(response),
    committedAt,
  );

  const insCommand = db.prepare(
    `INSERT INTO "CommandIndex" (campaignId, commandId, batchId, position) VALUES (?, ?, ?, ?)`,
  );
  batch.commands.forEach((c, position) => insCommand.run(campaignId, c.commandId, batchId, position));

  const insEvent = db.prepare(
    `INSERT INTO "DomainEvent" (id, campaignId, seq, batchId, commandId, type, schemaVersion, payloadJson, actorKind, actorId, sourceRef, occurredAt, worldTime, visibility, knowledgeKind, sessionId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
  );
  for (const e of events) {
    insEvent.run(
      e.id,
      campaignId,
      e.seq,
      batchId,
      e.commandId,
      e.draft.type,
      e.draft.schemaVersion,
      JSON.stringify(e.draft.payload),
      actorKind,
      actor.actorId,
      committedAt,
      e.draft.visibility,
      e.draft.knowledgeKind,
      e.sessionId,
    );
  }

  const insJournal = db.prepare(
    `INSERT INTO "JournalEntry" (id, campaignId, batchId, kind, title, text, visibility, revision, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const insLink = db.prepare(`INSERT INTO "JournalEventLink" (campaignId, journalEntryId, eventId) VALUES (?, ?, ?)`);
  for (const p of projections) {
    insJournal.run(p.id, campaignId, batchId, "projection", null, p.events.map((e) => describeEvent(e.draft)).join("\n"), p.visibility, committedAt);
    for (const e of p.events) insLink.run(campaignId, p.id, e.id);
  }
  for (const e of events) {
    if (e.draft.type !== "JournalNoteAppended") continue;
    insJournal.run(
      e.draft.payload.journalEntryId,
      campaignId,
      batchId,
      "manual",
      e.draft.payload.title,
      e.draft.payload.text,
      e.draft.visibility,
      committedAt,
    );
    insLink.run(campaignId, e.draft.payload.journalEntryId, e.id);
  }

  applyJournalProjections(db, campaignId, events, committedAt);

  const upd = db
    .prepare(`UPDATE "Campaign" SET stateVersion = ?, lastEventSeq = ? WHERE id = ? AND stateVersion = ?`)
    .run(stateVersionAfter, lastSeq, campaignId, campaign.stateVersion);
  if (upd.changes !== 1) throw new Error("Povećanje verzije kampanje nije uspjelo.");

  opts.beforeCommit?.();
  return { ...response, replayed: false };
}

/**
 * Jedini put za potvrđene promjene stanja kampanje (ADR-0004, ADR-0006).
 * Cijeli postupak teče u jednoj `BEGIN IMMEDIATE` transakciji: provjere i upis
 * vide stanje pod istim write lockom. AI/HTTP pozivi se ovdje nikad ne izvršavaju.
 */
export function executeBatch(db: Db, actor: Actor, input: unknown, options: ExecuteOptions = {}): BatchResult {
  const { batch, requestHash } = parseBatch(input);
  const opts = { now: () => new Date().toISOString(), newId: () => randomUUID(), ...options };
  const tx = db.transaction(() => runInTransaction(db, actor, batch, requestHash, opts));

  let result: BatchResult;
  try {
    result = tx.immediate();
  } catch (err) {
    if (isBusyError(err)) {
      throw new DomainError("busy", "Baza je zauzeta; pokušajte ponovno s istim batchem.", { batchId: batch.batchId });
    }
    if (isUniqueViolation(err)) {
      // Posljednja zaštita: konkurentni upis istog batcha. Ponovno pročitati pod lockom.
      result = tx.immediate();
    } else {
      throw err;
    }
  }
  options.afterCommit?.(result);
  return result;
}

/** Oporavak ishoda nakon timeouta: `GET …/batches/:batchId`. */
export function getBatchReceipt(db: Db, actor: Actor, campaignId: string, batchId: string): BatchResult {
  const role = requireMember(db, campaignId, actor);
  const row = db
    .prepare(`SELECT requestHash, responseJson, actorId FROM "BatchReceipt" WHERE campaignId = ? AND batchId = ?`)
    .get(campaignId, batchId) as ReceiptRow | undefined;
  // Nepostojeći i tuđi batch daju isti odgovor.
  if (!row || !canReadReceipt(role, actor, row)) throw new DomainError("not_found", "Batch nije potvrđen.", { batchId });
  return { ...(JSON.parse(row.responseJson) as BatchResponse), replayed: true };
}
