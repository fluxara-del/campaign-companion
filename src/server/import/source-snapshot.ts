import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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

/** Popis dopuštenih izvornih datoteka; samo čitanje imena direktorija, nikakav upis. */
export function listAllowedSources(sourceRoot: string): { files: string[]; excluded: string[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const files: string[] = [];
  for (const rel of ALLOWED_FILES) {
    const abs = path.join(sourceRoot, ...rel.split("/"));
    if (!existsSync(abs)) {
      findings.push({ code: "source_missing", severity: "error", message: "Nedostaje obavezna izvorna datoteka.", source: rel });
      continue;
    }
    if (lstatSync(abs).isSymbolicLink()) {
      findings.push({ code: "source_symlink", severity: "error", message: "Izvorna datoteka je simbolička veza; odbijeno.", source: rel });
      continue;
    }
    files.push(rel);
  }
  for (const dir of ALLOWED_MARKDOWN_DIRS) {
    const absDir = path.join(sourceRoot, dir);
    if (!existsSync(absDir)) continue;
    for (const name of readdirSync(absDir).sort()) {
      const abs = path.join(absDir, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink() || !st.isFile() || !name.toLowerCase().endsWith(".md")) continue;
      files.push(`${dir}/${name}`);
    }
  }
  const top = existsSync(sourceRoot) ? readdirSync(sourceRoot).sort() : [];
  const used = new Set(files.map((f) => f.split("/")[0]));
  const excluded = top.filter((n) => !used.has(n));
  if (top.some((n) => NEVER_READ.has(n))) {
    findings.push({
      code: "dm_private_excluded",
      severity: "info",
      message: "Direktorij dm_private postoji i namjerno nije čitan ni uvezen (otvorena odluka O3).",
    });
  }
  return { files, excluded, findings };
}

/**
 * Kopira dopuštene izvore u `targetDir` i vraća manifest SHA-256. Hash se računa nad
 * izvornim bajtovima, a kopija se ponovno hashira i mora biti jednaka. Izvor se samo čita.
 */
export function snapshotSources(sourceRoot: string, targetDir: string): { manifest: SourceManifest; findings: Finding[] } {
  const { files, excluded, findings } = listAllowedSources(sourceRoot);
  const entries: ManifestEntry[] = [];
  for (const rel of files) {
    const src = path.join(sourceRoot, ...rel.split("/"));
    const dst = path.join(targetDir, ...rel.split("/"));
    const bytes = readFileSync(src);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    const copyHash = sha256(readFileSync(dst));
    const srcHash = sha256(bytes);
    if (copyHash !== srcHash) {
      findings.push({ code: "copy_mismatch", severity: "error", message: "Kopija se razlikuje od izvora.", source: rel });
    }
    entries.push({ path: rel, sha256: srcHash, size: bytes.length });
  }
  return { manifest: { formatVersion: 1, files: entries, excluded }, findings };
}

/** Ponovno hashira izvore iz manifesta (dokaz da izvor nije mijenjan tijekom uvoza). */
export function verifySourcesUnchanged(sourceRoot: string, manifest: SourceManifest): Finding[] {
  const findings: Finding[] = [];
  for (const e of manifest.files) {
    const abs = path.join(sourceRoot, ...e.path.split("/"));
    if (!existsSync(abs) || sha256(readFileSync(abs)) !== e.sha256) {
      findings.push({
        code: "source_changed_during_import",
        severity: "error",
        message: "Izvorna datoteka promijenila se tijekom uvoza; rezultat nije pouzdan.",
        source: e.path,
      });
    }
  }
  return findings;
}
