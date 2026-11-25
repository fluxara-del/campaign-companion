import { randomUUID } from "node:crypto";
import { canonicalHash, canonicalJson } from "@/domain/canonical";
import type { DomainEventBody } from "@/domain/events";
import { applyEvent, ReplayDivergenceError } from "@/domain/reducer";
import { SNAPSHOT_FORMAT, type CampaignState } from "@/domain/state";
import type { Db } from "./connection";
import { loadState } from "./state-repo";

export function snapshotHash(state: CampaignState): string {
  return canonicalHash(state);
}

type BaselineRow = { id: string; seq: number; stateVersion: number; snapshotJson: string; snapshotHash: string };

/**
 * Zapisuje provjereni baseline trenutačnog stanja. Mora se zvati unutar transakcije koja
 * drži write lock (npr. pri stvaranju ili uvozu kampanje).
 */
export function writeBaseline(
  db: Db,
  campaignId: string,
  source: "synthetic" | "import",
  now: string,
  id: string = randomUUID(),
): { id: string; snapshotHash: string } {
  const campaign = db
    .prepare(`SELECT stateVersion, lastEventSeq FROM "Campaign" WHERE id = ?`)
    .get(campaignId) as { stateVersion: number; lastEventSeq: number } | undefined;
  if (!campaign) throw new Error(`Kampanja ${campaignId} ne postoji.`);
  const state = loadState(db, campaignId);
  const hash = snapshotHash(state);
  db.prepare(
    `INSERT INTO "CampaignBaseline" (id, campaignId, seq, stateVersion, snapshotJson, snapshotHash, source, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, campaignId, campaign.lastEventSeq, campaign.stateVersion, canonicalJson(state), hash, source, now);
  return { id, snapshotHash: hash };
}

export type ReplayReport = {
  ok: boolean;
  baselineSeq: number;
  eventsReplayed: number;
  liveHash: string;
  replayHash: string;
  liveStateVersion: number;
  replayStateVersion: number;
  problems: string[];
};

/**
 * Replay od posljednjeg baseline-a: kanonski snapshot nakon primjene svih kasnijih događaja
 * mora imati isti hash kao živo stanje, sekvenca mora biti bez praznina, a broj potvrđenih
 * batcheva mora objasniti trenutačnu verziju.
 *
 * Sva čitanja izvršavaju se u jednoj read transakciji (jedna WAL snimka), pa valjan commit
 * drugog pisca tijekom provjere ne može izazvati lažno odstupanje.
 */
export function verifyReplay(
  db: Db,
  campaignId: string,
  opts: { /** Samo za testove: poziva se između čitanja. */ afterEventsRead?: () => void } = {},
): ReplayReport {
  return db.transaction(() => verifyReplayInSnapshot(db, campaignId, opts)).deferred();
}

function verifyReplayInSnapshot(db: Db, campaignId: string, opts: { afterEventsRead?: () => void }): ReplayReport {
  const problems: string[] = [];
  const baseline = db
    .prepare(
      `SELECT id, seq, stateVersion, snapshotJson, snapshotHash FROM "CampaignBaseline" WHERE campaignId = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(campaignId) as BaselineRow | undefined;
  if (!baseline) throw new Error(`Kampanja ${campaignId} nema baseline.`);

  const state = JSON.parse(baseline.snapshotJson) as CampaignState;
  if (state.format !== SNAPSHOT_FORMAT) {
    // Baseline stvoren prije Faze 3 ne sadrži nove dijelove stanja; ne nadograđuje se nagađanjem.
    problems.push(`Baseline je formata ${state.format ?? 1}, očekivan ${SNAPSHOT_FORMAT}; kampanju treba ponovno stvoriti ili uvesti.`);
  }
  if (snapshotHash(state) !== baseline.snapshotHash) problems.push("Hash baseline snapshot-a ne odgovara zapisu.");

  const events = db
    .prepare(`SELECT seq, type, payloadJson FROM "DomainEvent" WHERE campaignId = ? AND seq > ? ORDER BY seq`)
    .all(campaignId, baseline.seq) as { seq: number; type: DomainEventBody["type"]; payloadJson: string }[];

  opts.afterEventsRead?.();

  let expectedSeq = baseline.seq + 1;
  for (const e of events) {
    if (e.seq !== expectedSeq) problems.push(`Praznina u sekvenci: očekivano ${expectedSeq}, nađeno ${e.seq}.`);
    expectedSeq = e.seq + 1;
    try {
      applyEvent(state, { type: e.type, payload: JSON.parse(e.payloadJson) } as DomainEventBody);
    } catch (err) {
      if (err instanceof ReplayDivergenceError) problems.push(`seq ${e.seq}: ${err.message}`);
      else throw err;
    }
  }

  const campaign = db
    .prepare(`SELECT stateVersion, lastEventSeq FROM "Campaign" WHERE id = ?`)
    .get(campaignId) as { stateVersion: number; lastEventSeq: number };
  const batches = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM "BatchReceipt" WHERE campaignId = ? AND stateVersionAfter > ?`)
      .get(campaignId, baseline.stateVersion) as { n: number }
  ).n;
  const replayStateVersion = baseline.stateVersion + batches;
  if (replayStateVersion !== campaign.stateVersion) {
    problems.push(`Verzija: živo ${campaign.stateVersion}, iz replaya ${replayStateVersion}.`);
  }
  const lastSeq = events.at(-1)?.seq ?? baseline.seq;
  if (lastSeq !== campaign.lastEventSeq) problems.push(`lastEventSeq: živo ${campaign.lastEventSeq}, događaji ${lastSeq}.`);

  const liveHash = snapshotHash(loadState(db, campaignId));
  const replayHash = snapshotHash(state);
  if (liveHash !== replayHash) problems.push("Hash živog stanja razlikuje se od replaya.");

  return {
    ok: problems.length === 0,
    baselineSeq: baseline.seq,
    eventsReplayed: events.length,
    liveHash,
    replayHash,
    liveStateVersion: campaign.stateVersion,
    replayStateVersion,
    problems,
  };
}
