import { openDatabase, type Db } from "@/server/store/connection";
import { sqlitePathFromUrl } from "@/server/db/sqlite-safety";

const globalForDb = globalThis as unknown as { kdzDb?: Db };

/** Jedna konekcija po procesu (jedan pisac); baza mora biti migrirana (`prisma migrate deploy`). */
export function appDb(): Db {
  if (!globalForDb.kdzDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL nije postavljen.");
    globalForDb.kdzDb = openDatabase(sqlitePathFromUrl(url), { busyTimeoutMs: 2_000 });
  }
  return globalForDb.kdzDb;
}
