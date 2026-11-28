import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "@/domain/canonical";
import { DomainError } from "@/domain/errors";
import type { DomainEventBody, Visibility } from "@/domain/events";
import { describeEvent, KNOWLEDGE_HR } from "@/domain/journal";
import type { CampaignState } from "@/domain/state";
import type { Actor } from "@/server/store/batch-service";
import type { Db } from "@/server/store/connection";
import { getKnowledgeForRole, memberRole, type AssertionView, type SessionView } from "@/server/store/journal-read";
import { loadHiddenHolderRefs, loadState, visibilityClause } from "@/server/store/state-repo";

/**
 * Verzionirani izvoz (spec §10, Faza 4). Svaki izvoz je nova generacija direktorija s manifestom
 * (`stateVersion`, event cursor, SHA-256 svake datoteke). Datoteke se pišu u privremeni direktorij,
 * ponovno čitaju i provjeravaju, pa se generacija atomski premješta i tek tada se objavljuje pointer
 * `CURRENT.<publika>.json`. Prekid u bilo kojem koraku ne ostavlja „dovršenu” miješanu generaciju.
 * Izvoz samo čita bazu (jedna read transakcija); ne mijenja stanje kampanje.
 */

export const EXPORT_FORMAT = 1 as const;
export type Audience = "player" | "dm";

export type ExportFile = { path: string; bytes: number; sha256: string };
export type ExportManifest = {
  format: typeof EXPORT_FORMAT;
  campaignId: string;
  campaignName: string;
  audience: Audience;
  stateVersion: number;
  /** Zadnji događaj uključen u izvoz (vidljiv publici). */
  eventCursor: number;
  eventCount: number;
  createdAt: string;
  appVersion: string;
  files: ExportFile[];
  /** SHA-256 kanonskog popisa datoteka: jedan otisak cijele generacije. */
  generationSha256: string;
};
export type ExportPointer = { generation: string; manifestSha256: string; generationSha256: string; stateVersion: number; eventCursor: number; audience: Audience; createdAt: string };

export type ExportOptions = {
  campaignId: string;
  outRoot: string;
  audience: Audience;
  now?: () => string;
  appVersion?: string;
  /** Samo za testove: poziva se prije svakog koraka (`file:<ime>`, `verify`, `publish`, `pointer`). */
  onStep?: (step: string) => void;
};

export type ExportResult = { generationDir: string; pointerPath: string; manifest: ExportManifest };

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function writeDurable(file: string, data: string) {
  const fd = openSync(file, "wx");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

type Snapshot = {
  campaign: { id: string; name: string; stateVersion: number; rulesetId: string; rulesetVersion: string };
  state: CampaignState;
  entities: { id: string; kind: string; name: string; status: string | null; visibility: Visibility; data: unknown }[];
  events: { id: string; seq: number; type: DomainEventBody["type"]; schemaVersion: number; payload: DomainEventBody["payload"]; occurredAt: string; sessionId: string | null; visibility: Visibility; knowledgeKind: string | null }[];
  journal: { id: string; kind: string; title: string | null; text: string; visibility: Visibility; revision: number; createdAt: string; eventSeqs: number[] }[];
  knowledge: AssertionView[];
  sessions: SessionView[];
};

/** Sve što publika smije vidjeti, iz jedne read transakcije (konzistentna snimka). */
function readSnapshot(db: Db, actor: Actor, campaignId: string, audience: Audience): Snapshot {
  return db
    .transaction(() => {
      const role = memberRole(db, actor, campaignId);
      if (audience === "dm" && role !== "owner") throw new DomainError("forbidden", "DM izvoz smije napraviti samo vlasnik kampanje.");
      // Player izvoz uvijek se filtrira kao za igrača, i kad ga pokreće vlasnik.
      const viewRole = audience === "dm" ? "owner" : "player";
      const vis = visibilityClause(viewRole);
      const campaign = db.prepare(`SELECT id, name, stateVersion, rulesetId, rulesetVersion FROM "Campaign" WHERE id = ?`).get(campaignId) as Snapshot["campaign"];

      const state = loadState(db, campaignId);
      if (audience === "player") {
        const hidden = loadHiddenHolderRefs(db, campaignId);
        for (const [id, it] of Object.entries(state.items)) {
          if (it.holderRef !== null && hidden.has(it.holderRef)) delete state.items[id];
          else if (it.ownerRef !== null && hidden.has(it.ownerRef)) it.ownerRef = null;
        }
      }
      const entities = (
        db.prepare(`SELECT id, kind, name, status, visibility, dataJson FROM "EntityRecord" WHERE campaignId = ? AND ${vis} ORDER BY kind, id`).all(campaignId) as {
          id: string;
          kind: string;
          name: string;
          status: string | null;
          visibility: Visibility;
          dataJson: string;
        }[]
      ).map(({ dataJson, ...e }) => ({ ...e, data: JSON.parse(dataJson) }));
      const events = (
        db
          .prepare(`SELECT id, seq, type, schemaVersion, payloadJson, occurredAt, sessionId, visibility, knowledgeKind FROM "DomainEvent" WHERE campaignId = ? AND ${vis} ORDER BY seq`)
          .all(campaignId) as (Omit<Snapshot["events"][number], "payload"> & { payloadJson: string })[]
      ).map(({ payloadJson, ...e }) => ({ ...e, payload: JSON.parse(payloadJson) }));
      const seqStmt = db.prepare(
        `SELECT e.seq FROM "JournalEventLink" l JOIN "DomainEvent" e ON e.campaignId = l.campaignId AND e.id = l.eventId WHERE l.campaignId = ? AND l.journalEntryId = ? AND ${vis.replace(/visibility/g, "e.visibility")} ORDER BY e.seq`,
      );
      const journal = (
        db.prepare(`SELECT id, kind, title, text, visibility, revision, createdAt FROM "JournalEntry" WHERE campaignId = ? AND ${vis}`).all(campaignId) as Omit<Snapshot["journal"][number], "eventSeqs">[]
      )
        .map((j) => ({ ...j, eventSeqs: (seqStmt.all(campaignId, j.id) as { seq: number }[]).map((r) => r.seq) }))
        .filter((j) => j.eventSeqs.length > 0)
        .sort((a, b) => a.eventSeqs.at(-1)! - b.eventSeqs.at(-1)! || (a.id < b.id ? -1 : 1));
      const knowledge = getKnowledgeForRole(db, campaignId, viewRole, { includeHistory: true });
      const sessions = db
        .prepare(`SELECT id, number, title, status, startVersion, endVersion, startedAt, endedAt FROM "Session" WHERE campaignId = ? ORDER BY number`)
        .all(campaignId) as SessionView[];
      return { campaign, state, entities, events, journal, knowledge, sessions };
    })
    .deferred();
}

const line = (v: unknown) => canonicalJson(v, { numbers: "any" });

function journalMarkdown(s: Snapshot, audience: Audience): string {
  const out: string[] = [`# Dnevnik — ${s.campaign.name}`, "", `Verzija stanja ${s.campaign.stateVersion} · izvoz za ${audience === "dm" ? "DM-a (uključuje skriveni sadržaj)" : "igrača"}`, ""];
  const bySession = new Map<string | null, Snapshot["journal"]>();
  const sessionOfSeq = new Map(s.events.map((e) => [e.seq, e.sessionId]));
  for (const j of s.journal) {
    const sid = sessionOfSeq.get(j.eventSeqs[0]!) ?? null;
    bySession.set(sid, [...(bySession.get(sid) ?? []), j]);
  }
  const order: (string | null)[] = [null, ...s.sessions.map((x) => x.id)];
  for (const sid of order) {
    const items = bySession.get(sid);
    if (!items?.length) continue;
    const sess = s.sessions.find((x) => x.id === sid);
    out.push(sess ? `## Sesija ${sess.number}${sess.title ? `: ${sess.title}` : ""}` : "## Izvan sesije", "");
    for (const j of items) {
      const tag = j.kind === "manual" ? "Bilješka" : "Zapis";
      out.push(`### ${tag} · događaji #${j.eventSeqs.join(", #")}${j.title ? ` · ${j.title}` : ""}${j.visibility === "dm" ? " · [DM]" : ""}`, "", j.text, "");
    }
  }
  const active = s.knowledge.filter((k) => k.status === "active");
  if (active.length) {
    out.push("## Znanje (aktivne tvrdnje)", "");
    for (const k of active) out.push(`- **${KNOWLEDGE_HR[k.knowledgeKind as keyof typeof KNOWLEDGE_HR]}** (${k.subjectKind}${k.subjectId ? `: ${k.subjectId}` : ""}): ${k.text}${k.visibility === "dm" ? " [DM]" : ""}`);
    out.push("");
  }
  return out.join("\n");
}

function handoffMarkdown(s: Snapshot): string {
  const last = s.events.at(-1);
  const open = s.sessions.find((x) => x.status === "open");
  const out: string[] = [
    `# Handoff — ${s.campaign.name}`,
    "",
    `- Verzija stanja: ${s.campaign.stateVersion}`,
    `- Zadnji događaj: ${last ? `#${last.seq} — ${describeEvent({ type: last.type, payload: last.payload } as DomainEventBody)}` : "nema"}`,
    `- Sesija: ${open ? `${open.number}${open.title ? ` (${open.title})` : ""}, otvorena` : "nijedna otvorena"}`,
    "",
    "## Likovi",
    "",
  ];
  for (const c of Object.values(s.state.characters).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const conds = Object.values(s.state.conditions).filter((x) => x.characterId === c.id).map((x) => x.name);
    const conc = s.state.concentration[c.id];
    out.push(`- **${c.name}** (${c.id}): HP ${c.hpCurrent}/${c.hpMax ?? "?"}${c.hpTemp ? ` (+${c.hpTemp} privremeni)` : ""}${conds.length ? `; uvjeti: ${conds.join(", ")}` : ""}${conc ? `; koncentracija: ${s.state.spells[conc.spellSelectionId]?.name ?? conc.spellSelectionId}` : ""}`);
  }
  out.push("", "## Posljednji zapisi", "");
  for (const j of s.journal.slice(-10)) out.push(`- #${j.eventSeqs.at(-1)}: ${j.title ?? j.text.split("\n")[0]}`);
  out.push("", "Nastavak u vanjskom chatu: priloži ovaj dokument; promjene se vraćaju samo kroz aplikaciju (nema tihog prepisivanja).", "");
  return out.join("\n");
}

/** Izrada generacije izvoza. Baca pogrešku ako bilo koji korak ne uspije; prethodni pointer ostaje. */
export function exportCampaign(db: Db, actor: Actor, opts: ExportOptions): ExportResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const step = opts.onStep ?? (() => {});
  const snap = readSnapshot(db, actor, opts.campaignId, opts.audience);
  const createdAt = now();
  const outRoot = path.resolve(opts.outRoot);
  const gensDir = path.join(outRoot, "generations");
  mkdirSync(gensDir, { recursive: true });
  const genName = `${createdAt.replace(/[:.]/g, "-")}-v${snap.campaign.stateVersion}-${opts.audience}`;
  const finalDir = path.join(gensDir, genName);
  if (existsSync(finalDir)) throw new Error(`Generacija ${genName} već postoji.`);
  const tmpDir = path.join(outRoot, `.tmp-${randomUUID()}`);
  mkdirSync(tmpDir);
  let pointerTmp: string | null = null;

  try {
    const contents: [string, string][] = [
      ["state.json", line({ format: snap.state.format, campaign: snap.campaign, state: snap.state }) + "\n"],
      ["entities.json", line(snap.entities) + "\n"],
      ["events.jsonl", snap.events.map((e) => line(e)).join("\n") + (snap.events.length ? "\n" : "")],
      ["journal.json", line(snap.journal) + "\n"],
      ["knowledge.json", line(snap.knowledge) + "\n"],
      ["sessions.json", line(snap.sessions) + "\n"],
      ["journal.md", journalMarkdown(snap, opts.audience)],
      ["handoff.md", handoffMarkdown(snap)],
    ];
    const files: ExportFile[] = [];
    for (const [name, data] of contents) {
      step(`file:${name}`);
      writeDurable(path.join(tmpDir, name), data);
      const buf = Buffer.from(data, "utf8");
      files.push({ path: name, bytes: buf.length, sha256: sha256(buf) });
    }
    const manifest: ExportManifest = {
      format: EXPORT_FORMAT,
      campaignId: snap.campaign.id,
      campaignName: snap.campaign.name,
      audience: opts.audience,
      stateVersion: snap.campaign.stateVersion,
      eventCursor: snap.events.at(-1)?.seq ?? 0,
      eventCount: snap.events.length,
      createdAt,
      appVersion: opts.appVersion ?? process.env.APP_VERSION ?? "dev",
      files,
      generationSha256: sha256(line(files)),
    };
    step("file:manifest.json");
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    writeDurable(path.join(tmpDir, "manifest.json"), manifestText);

    step("verify");
    const check = verifyExportGeneration(tmpDir);
    if (!check.ok) throw new Error(`Provjera izvoza nije uspjela: ${check.problems.join("; ")}`);

    step("publish");
    renameSync(tmpDir, finalDir);

    step("pointer");
    const pointer: ExportPointer = {
      generation: `generations/${genName}`,
      manifestSha256: sha256(manifestText),
      generationSha256: manifest.generationSha256,
      stateVersion: manifest.stateVersion,
      eventCursor: manifest.eventCursor,
      audience: opts.audience,
      createdAt,
    };
    const pointerPath = path.join(outRoot, `CURRENT.${opts.audience}.json`);
    pointerTmp = path.join(outRoot, `.CURRENT.${opts.audience}.${randomUUID()}.tmp`);
    writeDurable(pointerTmp, JSON.stringify(pointer, null, 2) + "\n");
    step("pointer:rename");
    renameSync(pointerTmp, pointerPath);
    pointerTmp = null;
    return { generationDir: finalDir, pointerPath, manifest };
  } catch (e) {
    // Čiste se samo vlastite privremene putanje; paralelni izvoz u isti direktorij ostaje netaknut.
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (pointerTmp) rmSync(pointerTmp, { force: true });
    throw e;
  }
}

/** Provjera generacije: manifest, popis datoteka (bez viška i manjka), veličine i SHA-256. */
export function verifyExportGeneration(dir: string): { ok: boolean; problems: string[]; manifest: ExportManifest | null } {
  const problems: string[] = [];
  let manifest: ExportManifest | null = null;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as ExportManifest;
  } catch {
    return { ok: false, problems: ["manifest.json nedostaje ili nije valjan JSON."], manifest: null };
  }
  if (manifest.format !== EXPORT_FORMAT) problems.push(`Nepoznat format izvoza ${String(manifest.format)}.`);
  const listed = new Set(manifest.files.map((f) => f.path));
  const present = readdirSync(dir).filter((f) => f !== "manifest.json");
  for (const f of present) if (!listed.has(f)) problems.push(`Datoteka ${f} nije u manifestu.`);
  for (const f of manifest.files) {
    if (f.path.includes("/") || f.path.includes("\\") || f.path.startsWith(".")) {
      problems.push(`Neispravna putanja ${f.path}.`);
      continue;
    }
    let buf: Buffer;
    try {
      buf = readFileSync(path.join(dir, f.path));
    } catch {
      problems.push(`Nedostaje ${f.path}.`);
      continue;
    }
    if (buf.length !== f.bytes) problems.push(`${f.path}: veličina ${buf.length}, očekivano ${f.bytes}.`);
    if (sha256(buf) !== f.sha256) problems.push(`${f.path}: SHA-256 ne odgovara.`);
  }
  if (sha256(line(manifest.files)) !== manifest.generationSha256) problems.push("generationSha256 ne odgovara popisu datoteka.");
  return { ok: problems.length === 0, problems, manifest };
}

/**
 * Trenutačno objavljena generacija prema pointeru, s provjerom integriteta i publike: tražena publika,
 * `audience` u pointeru i `audience` u manifestu moraju se podudarati (player provjera nikad ne smije
 * proći za DM generaciju), a generacija mora biti neposredno unutar `generations/`.
 */
export function readCurrentExport(outRoot: string, audience: Audience): { pointer: ExportPointer; check: ReturnType<typeof verifyExportGeneration> } | null {
  const root = path.resolve(outRoot);
  const p = path.join(root, `CURRENT.${audience}.json`);
  if (!existsSync(p)) return null;
  const pointer = JSON.parse(readFileSync(p, "utf8")) as ExportPointer;
  const dir = path.resolve(root, String(pointer.generation));
  if (path.dirname(dir) !== path.join(root, "generations")) {
    return { pointer, check: { ok: false, problems: ["Pointer ne pokazuje na generaciju unutar generations/."], manifest: null } };
  }
  const check = verifyExportGeneration(dir);
  if (pointer.audience !== audience) {
    check.problems.push(`Pointer je za publiku „${String(pointer.audience)}”, tražena je „${audience}”.`);
    check.ok = false;
  }
  if (check.manifest && check.manifest.audience !== audience) {
    check.problems.push(`Manifest generacije je za publiku „${String(check.manifest.audience)}”, tražena je „${audience}”.`);
    check.ok = false;
  }
  const manifestSha = existsSync(path.join(dir, "manifest.json")) ? sha256(readFileSync(path.join(dir, "manifest.json"))) : "";
  if (manifestSha !== pointer.manifestSha256) {
    check.problems.push("Pointer ne odgovara manifestu generacije.");
    check.ok = false;
  }
  return { pointer, check };
}
