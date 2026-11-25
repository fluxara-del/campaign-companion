import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Finding, ManifestEntry, SourceManifest } from "./types";

/**
 * Datoteke kampanje koje importer smije čitati (relativne putanje, `/` separator).
 * Sve ostalo se ne kopira; `dm_private/` se nikad ne otvara (odluka O3).
 */
const ALLOWED_FILES = [
  "state/current-state.json",
  "state/character.json",
  "events/events.jsonl",
  "npcs/npcs.json",
  "quests/quests.json",
] as const;
const ALLOWED_MARKDOWN_DIRS = ["sessions", "handoff", "world"] as const;
const NEVER_READ = new Set(["dm_private"]);

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** `child` je `parent` ili se nalazi unutar njega (nakon normalizacije putanja). */
export function isWithin(child: string, parent: string): boolean {
  const c = norm(path.resolve(child));
  const p = norm(path.resolve(parent));
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/** Stvarna (kanonska) putanja; razrješava symlinkove i Windows junctione. */
export function realPath(p: string): string {
  return realpathSync.native(p);
}

type Resolved = { ok: true; abs: string } | { ok: false; reason: "missing" | "link" | "escape" };

/**
 * Provjerava SVAKU komponentu putanje od (stvarnog) korijena izvora prije čitanja ili
 * popisivanja: nijedna ne smije biti symlink ni junction, a stvarna lokacija mora biti
 * točno očekivana putanja unutar izvora. Ništa se ne čita dok provjera ne prođe.
 */
export function resolveInsideSource(realRoot: string, rel: string): Resolved {
  let cur = realRoot;
  for (const part of rel.split("/")) {
    if (!part || part === "." || part === "..") return { ok: false, reason: "escape" };
    cur = path.join(cur, part);
    if (!existsSync(cur)) return { ok: false, reason: "missing" };
    if (lstatSync(cur).isSymbolicLink()) return { ok: false, reason: "link" };
  }
  const real = realPath(cur);
  if (norm(real) !== norm(cur) || !isWithin(real, realRoot)) return { ok: false, reason: "link" };
  return { ok: true, abs: cur };
}

/**
 * Čitanje uz zaštitu od zamjene između provjere i čitanja (TOCTOU): datoteka se otvara
 * (na POSIX-u s O_NOFOLLOW), zatim se putanja provjerava PONOVNO i identitet otvorene
 * datoteke (dev + ino iz fstat) mora biti jednak onome na provjerenoj putanji. Čitaju se
 * isključivo bajtovi iz već otvorenog opisnika.
 */
export function readVerified(realRoot: string, rel: string, hooks: SnapshotHooks = {}): Buffer | null {
  const first = resolveInsideSource(realRoot, rel);
  if (!first.ok) return null;
  hooks.beforeOpen?.(rel);
  const fd = openSync(first.abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) return null;
    hooks.afterOpen?.(rel);
    const again = resolveInsideSource(realRoot, rel);
    if (!again.ok) return null;
    const atPath = lstatSync(again.abs, { bigint: true });
    if (atPath.dev !== opened.dev || atPath.ino !== opened.ino) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Samo za testove: ubacivanje promjene stabla između provjere putanje i otvaranja datoteke. */
export type SnapshotHooks = { beforeOpen?: (rel: string) => void; afterOpen?: (rel: string) => void };

type Listed = { files: { rel: string; abs: string }[]; excluded: string[]; findings: Finding[]; realRoot: string };

/** Popis dopuštenih izvornih datoteka; čitaju se samo imena, i to tek nakon provjere putanje. */
export function listAllowedSources(sourceRoot: string): Listed {
  const findings: Finding[] = [];
  const files: { rel: string; abs: string }[] = [];
  const realRoot = realPath(sourceRoot);
  const rejectLink = (rel: string) =>
    findings.push({
      code: "source_link_rejected",
      severity: "error",
      message: "Putanja izvora prolazi kroz simboličku vezu ili junction; odbijeno bez čitanja sadržaja.",
      source: rel,
    });

  for (const rel of ALLOWED_FILES) {
    const r = resolveInsideSource(realRoot, rel);
    if (!r.ok) {
      if (r.reason === "missing") findings.push({ code: "source_missing", severity: "error", message: "Nedostaje obavezna izvorna datoteka.", source: rel });
      else rejectLink(rel);
      continue;
    }
    if (!lstatSync(r.abs).isFile()) {
      findings.push({ code: "source_not_file", severity: "error", message: "Izvor nije obična datoteka.", source: rel });
      continue;
    }
    files.push({ rel, abs: r.abs });
  }

  for (const dir of ALLOWED_MARKDOWN_DIRS) {
    const d = resolveInsideSource(realRoot, dir);
    if (!d.ok) {
      if (d.reason !== "missing") rejectLink(dir);
      continue; // Direktorij se ne popisuje ako provjera ne prođe.
    }
    if (!lstatSync(d.abs).isDirectory()) continue;
    for (const name of readdirSync(d.abs).sort()) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const rel = `${dir}/${name}`;
      const f = resolveInsideSource(realRoot, rel);
      if (!f.ok) {
        rejectLink(rel);
        continue;
      }
      if (lstatSync(f.abs).isFile()) files.push({ rel, abs: f.abs });
    }
  }

  const top = readdirSync(realRoot).sort();
  const used = new Set(files.map((f) => f.rel.split("/")[0]));
  const excluded = top.filter((n) => !used.has(n));
  if (top.some((n) => NEVER_READ.has(n))) {
    findings.push({
      code: "dm_private_excluded",
      severity: "info",
      message: "Direktorij dm_private postoji i namjerno nije čitan ni uvezen (otvorena odluka O3).",
    });
  }
  return { files, excluded, findings, realRoot };
}

/**
 * Izlaz ne smije završiti u izvoru ni preko veze. Provjerava se stvarna lokacija najbližeg
 * postojećeg roditelja izlazne putanje prije bilo kakvog upisa.
 */
export function assertOutputOutsideSource(outPath: string, sourceRoot: string): void {
  const realSource = realPath(sourceRoot);
  let probe = path.resolve(outPath);
  const rest: string[] = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    rest.unshift(path.basename(probe));
    probe = parent;
  }
  const effective = path.join(realPath(probe), ...rest);
  if (isWithin(effective, realSource) || isWithin(realSource, effective)) {
    throw new Error("Sandbox ne smije biti unutar izvornog direktorija kampanje (ni preko veze).");
  }
}

/**
 * Kopira dopuštene izvore u `targetDir` i vraća manifest SHA-256. Bajtovi se čitaju jednom
 * (iz provjerene putanje), hash se računa nad njima, a kopija se ponovno hashira.
 */
export function snapshotSources(
  sourceRoot: string,
  targetDir: string,
  hooks: SnapshotHooks = {},
): { manifest: SourceManifest; findings: Finding[] } {
  const { files, excluded, findings, realRoot } = listAllowedSources(sourceRoot);
  const entries: ManifestEntry[] = [];
  if (findings.some((f) => f.severity === "error")) {
    // Ništa se ne kopira ako ijedna putanja nije prošla provjeru.
    return { manifest: { formatVersion: 1, files: [], excluded }, findings };
  }
  const read: { rel: string; bytes: Buffer }[] = [];
  for (const { rel } of files) {
    const bytes = readVerified(realRoot, rel, hooks);
    if (!bytes) {
      findings.push({
        code: "source_changed_before_read",
        severity: "error",
        message: "Putanja ili datoteka promijenila se između provjere i čitanja; odbijeno.",
        source: rel,
      });
      continue;
    }
    read.push({ rel, bytes });
  }
  if (findings.some((f) => f.severity === "error")) {
    return { manifest: { formatVersion: 1, files: [], excluded }, findings };
  }
  for (const { rel, bytes } of read) {
    const dst = path.join(targetDir, ...rel.split("/"));
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, bytes, { flag: "wx" });
    const srcHash = sha256(bytes);
    if (sha256(readFileSync(dst)) !== srcHash) {
      findings.push({ code: "copy_mismatch", severity: "error", message: "Kopija se razlikuje od izvora.", source: rel });
    }
    entries.push({ path: rel, sha256: srcHash, size: bytes.length });
  }
  return { manifest: { formatVersion: 1, files: entries, excluded }, findings };
}

/**
 * Ponovno hashira izvore iz manifesta (dokaz da izvor nije mijenjan tijekom uvoza).
 * Koristi isto zaštićeno čitanje kao izrada kopije: nestanak datoteke, veza, promjena
 * identiteta ili neuspjelo otvaranje daju `source_changed_during_import` bez čitanja
 * zamjenskog sadržaja.
 */
export function verifySourcesUnchanged(sourceRoot: string, manifest: SourceManifest, hooks: SnapshotHooks = {}): Finding[] {
  const findings: Finding[] = [];
  const changed = (source: string) =>
    findings.push({
      code: "source_changed_during_import",
      severity: "error",
      message: "Izvorna datoteka promijenila se tijekom uvoza (ili se ne može sigurno pročitati); rezultat nije pouzdan.",
      source,
    });
  let realRoot: string;
  try {
    realRoot = realPath(sourceRoot);
  } catch {
    changed(".");
    return findings;
  }
  for (const e of manifest.files) {
    let bytes: Buffer | null = null;
    try {
      bytes = readVerified(realRoot, e.path, hooks);
    } catch {
      bytes = null;
    }
    if (!bytes || sha256(bytes) !== e.sha256) changed(e.path);
  }
  return findings;
}
