/**
 * Sigurnosni alati za SQLite bazu: provjera integriteta, konzistentna sigurnosna
 * kopija (SQLite Online Backup API), provjereni restore i analiza migracija.
 *
 * Koriste ih deploy skripte, CLI skripte u `scripts/db/` i health endpoint.
 * Modul namjerno ne ovisi o Prisma Clientu kako bi radio i kad migracija ne uspije.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

export const BACKUP_MANIFEST_SUFFIX = ".manifest.json";
export const DESTRUCTIVE_ALLOW_MARKER = "-- kdz:allow-destructive:";

export type IntegrityResult = { ok: boolean; messages: string[] };

export type BackupManifest = {
  formatVersion: 1;
  createdAt: string;
  label: string;
  sourcePath: string;
  backupFile: string;
  sha256: string;
  sizeBytes: number;
  sqliteVersion: string;
  integrity: "ok";
  appliedMigrations: string[];
};

export type MigrationAnalysis = {
  bundled: string[];
  applied: string[];
  pending: string[];
  /** Migracije zapisane u bazi koje ova verzija aplikacije ne poznaje (baza je novija). */
  unknownApplied: string[];
  /** Migracije koje su počele, a nisu završile ili su označene kao vraćene. */
  failed: string[];
  destructivePending: { migration: string; statements: string[] }[];
  compatible: boolean;
  safeToApply: boolean;
  reasons: string[];
};

/** Pretvara Prisma/SQLite URL (`file:./data/app.db`) u apsolutnu putanju. */
export function sqlitePathFromUrl(url: string, cwd: string = process.cwd()): string {
  if (!url.startsWith("file:")) {
    throw new Error("Podržan je samo SQLite URL oblika file:<putanja>.");
  }
  const raw = url.slice("file:".length).split("?")[0] ?? "";
  if (!raw) throw new Error("SQLite URL nema putanju.");
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

/**
 * Testovi nikada ne smiju raditi nad produkcijskom bazom.
 * Dopuštene su samo putanje unutar privremenog direktorija ili izričito testne datoteke.
 */
export function assertTestDatabasePath(dbPath: string, tmpRoot: string): void {
  const resolved = path.resolve(dbPath);
  const root = path.resolve(tmpRoot);
  const insideTmp = resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep);
  if (!insideTmp) {
    throw new Error(`Testna baza mora biti u privremenom direktoriju (${root}), a ne: ${resolved}`);
  }
}

function openReadonly(dbPath: string): Database.Database {
  if (!existsSync(dbPath)) throw new Error(`Baza ne postoji: ${dbPath}`);
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

/** `PRAGMA integrity_check` (ili brži `quick_check`) u read-only načinu. */
export function checkIntegrity(dbPath: string, opts: { quick?: boolean } = {}): IntegrityResult {
  const db = openReadonly(dbPath);
  try {
    const pragma = opts.quick ? "quick_check" : "integrity_check";
    const rows = db.pragma(pragma) as Record<string, string>[];
    const messages = rows.map((r) => String(Object.values(r)[0]));
    const fk = db.pragma("foreign_key_check") as unknown[];
    if (fk.length > 0) messages.push(`foreign_key_check: ${fk.length} povreda`);
    const ok = messages.length === 1 && messages[0] === "ok";
    return { ok, messages };
  } finally {
    db.close();
  }
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Popis primijenjenih (uspješno završenih) Prisma migracija; prazno ako tablica ne postoji. */
export function getAppliedMigrations(dbPath: string): { applied: string[]; failed: string[] } {
  const db = openReadonly(dbPath);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
      .get();
    if (!table) return { applied: [], failed: [] };
    const rows = db
      .prepare(
        "SELECT migration_name AS name, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations ORDER BY started_at",
      )
      .all() as { name: string; finishedAt: string | null; rolledBackAt: string | null }[];
    const applied = rows.filter((r) => r.finishedAt && !r.rolledBackAt).map((r) => r.name);
    const failed = rows.filter((r) => !r.finishedAt && !r.rolledBackAt).map((r) => r.name);
    return { applied: [...new Set(applied)], failed: [...new Set(failed)] };
  } finally {
    db.close();
  }
}

export function listBundledMigrations(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .filter((name) => existsSync(path.join(migrationsDir, name, "migration.sql")))
    .sort();
}

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bALTER\s+TABLE\s+\S+\s+DROP\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+INDEX\b/i,
  /\bDROP\s+VIEW\b/i,
  /\bDROP\s+TRIGGER\b/i,
];

/** Vraća destruktivne naredbe u SQL-u migracije, osim ako je migracija izričito odobrena markerom. */
export function findDestructiveStatements(sql: string): { statements: string[]; allowed: boolean } {
  const allowed = sql.split(/\r?\n/).some((line) => line.trim().startsWith(DESTRUCTIVE_ALLOW_MARKER));
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && DESTRUCTIVE_PATTERNS.some((p) => p.test(s)));
  return { statements, allowed };
}

/**
 * Procjena kompatibilnosti baze i paketa migracija prije `prisma migrate deploy`.
 * `safeToApply` je true samo ako nema nepoznatih ni neuspjelih migracija
 * te nijedna pending migracija nema neodobrenu destruktivnu naredbu.
 */
export function analyzeMigrations(dbPath: string | null, migrationsDir: string): MigrationAnalysis {
  const bundled = listBundledMigrations(migrationsDir);
  const { applied, failed } = dbPath && existsSync(dbPath) ? getAppliedMigrations(dbPath) : { applied: [], failed: [] };
  const pending = bundled.filter((m) => !applied.includes(m));
  const unknownApplied = applied.filter((m) => !bundled.includes(m));
  const destructivePending = pending
    .map((migration) => {
      const sql = readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
      const { statements, allowed } = findDestructiveStatements(sql);
      return { migration, statements: allowed ? [] : statements };
    })
    .filter((d) => d.statements.length > 0);

  const reasons: string[] = [];
  if (unknownApplied.length > 0) {
    reasons.push(`Baza sadrži migracije koje ova verzija ne poznaje: ${unknownApplied.join(", ")}`);
  }
  if (failed.length > 0) reasons.push(`Postoje nedovršene/neuspjele migracije: ${failed.join(", ")}`);
  for (const d of destructivePending) {
    reasons.push(`Neodobrena destruktivna migracija ${d.migration}: ${d.statements.length} naredbi`);
  }
  // Pending migracija mora biti novija od svake primijenjene (nema "umetanja" u povijest).
  const lastApplied = applied.filter((m) => bundled.includes(m)).sort().at(-1);
  const outOfOrder = lastApplied ? pending.filter((m) => m < lastApplied) : [];
  if (outOfOrder.length > 0) reasons.push(`Migracije izvan redoslijeda: ${outOfOrder.join(", ")}`);

  const compatible = unknownApplied.length === 0 && failed.length === 0;
  const safeToApply = compatible && destructivePending.length === 0 && outOfOrder.length === 0;
  return { bundled, applied, pending, unknownApplied, failed, destructivePending, compatible, safeToApply, reasons };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Konzistentna kopija aktivne baze (uključujući sadržaj WAL-a) preko SQLite Online Backup API-ja,
 * nakon čega se kopija provjerava `integrity_check`-om i dobiva manifest s hashom.
 * Nikada ne prepisuje postojeću kopiju.
 */
export async function createBackup(
  sourcePath: string,
  backupDir: string,
  label = "manual",
): Promise<BackupManifest> {
  if (!existsSync(sourcePath)) throw new Error(`Izvorna baza ne postoji: ${sourcePath}`);
  mkdirSync(backupDir, { recursive: true });
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "backup";
  const fileName = `${path.basename(sourcePath, path.extname(sourcePath))}-${timestamp()}-${safeLabel}.db`;
  const target = path.join(backupDir, fileName);
  if (existsSync(target)) throw new Error(`Kopija već postoji, odbijam prepisivanje: ${target}`);

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let sqliteVersion: string;
  try {
    sqliteVersion = (source.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    await source.backup(target);
  } finally {
    source.close();
  }

  const integrity = checkIntegrity(target);
  if (!integrity.ok) {
    renameSync(target, `${target}.corrupt`);
    throw new Error(`Kopija nije prošla provjeru integriteta: ${integrity.messages.join("; ")}`);
  }

  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    label: safeLabel,
    sourcePath: path.resolve(sourcePath),
    backupFile: fileName,
    sha256: sha256File(target),
    sizeBytes: statSync(target).size,
    sqliteVersion,
    integrity: "ok",
    appliedMigrations: getAppliedMigrations(target).applied,
  };
  writeFileSync(target + BACKUP_MANIFEST_SUFFIX, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

export function readManifest(backupPath: string): BackupManifest {
  const manifestPath = backupPath + BACKUP_MANIFEST_SUFFIX;
  if (!existsSync(manifestPath)) throw new Error(`Nedostaje manifest kopije: ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
}

/** Provjerava hash iz manifesta i integritet same kopije. */
export function verifyBackup(backupPath: string): { manifest: BackupManifest; integrity: IntegrityResult } {
  const manifest = readManifest(backupPath);
  const actual = sha256File(backupPath);
  if (actual !== manifest.sha256) {
    throw new Error(`Hash kopije ne odgovara manifestu (${actual} != ${manifest.sha256}).`);
  }
  const integrity = checkIntegrity(backupPath);
  if (!integrity.ok) throw new Error(`Kopija nije cjelovita: ${integrity.messages.join("; ")}`);
  return { manifest, integrity };
}

/**
 * Vraća provjerenu kopiju na ciljnu putanju. Aplikacija mora biti zaustavljena.
 * Postojeća baza (i njezine -wal/-shm datoteke) se ne briše nego premješta u
 * `<ime>.pre-restore-<vrijeme>`; restore se piše u privremenu datoteku i tek nakon
 * provjere atomski preimenuje na ciljnu putanju.
 */
export function restoreBackup(
  backupPath: string,
  targetPath: string,
): { restoredFrom: string; previousMovedTo: string | null; manifest: BackupManifest } {
  const { manifest } = verifyBackup(backupPath);
  const dir = path.dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const staging = `${targetPath}.restore-staging-${timestamp()}`;
  copyFileSync(backupPath, staging);
  if (sha256File(staging) !== manifest.sha256 || !checkIntegrity(staging).ok) {
    rmSync(staging, { force: true });
    throw new Error("Pripremljena kopija za restore nije valjana; ciljna baza nije dirana.");
  }

  let previousMovedTo: string | null = null;
  if (existsSync(targetPath)) {
    previousMovedTo = `${targetPath}.pre-restore-${timestamp()}`;
    renameSync(targetPath, previousMovedTo);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (existsSync(targetPath + suffix)) renameSync(targetPath + suffix, previousMovedTo + suffix);
    }
  }
  renameSync(staging, targetPath);

  const after = checkIntegrity(targetPath);
  if (!after.ok) throw new Error(`Vraćena baza nije prošla provjeru: ${after.messages.join("; ")}`);
  return { restoredFrom: path.resolve(backupPath), previousMovedTo, manifest };
}
