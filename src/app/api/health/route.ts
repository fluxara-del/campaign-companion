import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { analyzeMigrations, sqlitePathFromUrl } from "@/server/db/sqlite-safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health check za deploy: proces radi, baza je dostupna i shema odgovara migracijama
 * ugrađenima u ovu verziju. Ne vraća putanje, tajne ni podatke kampanje.
 */
export function GET() {
  const version = process.env.APP_VERSION ?? "dev";
  const commit = process.env.GIT_SHA ?? "unknown";
  const url = process.env.DATABASE_URL;

  const body: Record<string, unknown> = { status: "ok", version, commit };
  let healthy = true;

  try {
    if (!url) throw new Error("DATABASE_URL nije postavljen");
    const dbPath = sqlitePathFromUrl(url);
    if (!existsSync(dbPath)) throw new Error("baza ne postoji");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.prepare("SELECT 1").get();
    } finally {
      db.close();
    }
    const m = analyzeMigrations(dbPath, path.join(process.cwd(), "prisma", "migrations"));
    body.database = {
      reachable: true,
      migrationsApplied: m.applied.length,
      migrationsPending: m.pending.length,
      schemaCompatible: m.compatible,
    };
    if (m.pending.length > 0 || !m.compatible) healthy = false;
  } catch (err) {
    healthy = false;
    body.database = { reachable: false, error: err instanceof Error ? err.message : "nepoznata greška" };
  }

  if (!healthy) body.status = "degraded";
  return Response.json(body, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
