import Database from "better-sqlite3";

export type Db = Database.Database;

export type OpenOptions = {
  /** Koliko dugo čekati na write lock prije `busy` (503). */
  busyTimeoutMs?: number;
  readonly?: boolean;
};

/**
 * Otvara SQLite konekciju za domenski put pisanja (ADR-0006):
 * WAL, strani ključevi uključeni, `synchronous=FULL` (potvrđen commit preživi pad napajanja),
 * ograničen `busy_timeout`. Baza mora već biti migrirana (`prisma migrate deploy`).
 */
export function openDatabase(path: string, opts: OpenOptions = {}): Db {
  const db = new Database(path, { fileMustExist: true, readonly: opts.readonly ?? false });
  db.pragma(`busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 2_000))}`);
  db.pragma("foreign_keys = ON");
  if (!opts.readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
  }
  const fk = db.pragma("foreign_keys", { simple: true });
  if (fk !== 1) {
    db.close();
    throw new Error("SQLite strani ključevi nisu uključeni; odbijam rad.");
  }
  return db;
}

type SqliteLikeError = { code?: unknown };

export function sqliteCode(err: unknown): string | null {
  const code = (err as SqliteLikeError | null)?.code;
  return typeof code === "string" ? code : null;
}

export function isBusyError(err: unknown): boolean {
  const code = sqliteCode(err);
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_LOCKED";
}

export function isUniqueViolation(err: unknown): boolean {
  const code = sqliteCode(err);
  return code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE";
}
