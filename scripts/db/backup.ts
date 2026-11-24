/**
 * Konzistentna sigurnosna kopija SQLite baze s provjerom integriteta i manifestom.
 *   npm run db:backup -- --db ./data/app.db --out ./backups --label pre-deploy
 */
import "dotenv/config";
import { createBackup } from "../../src/server/db/sqlite-safety";
import { args, main, resolveDbPath } from "./_shared";

void main(async () => {
  const a = args({ db: { type: "string" }, out: { type: "string" }, label: { type: "string" } });
  const dbPath = resolveDbPath(a.db as string | undefined);
  const outDir = (a.out as string | undefined) ?? process.env.BACKUP_DIR;
  if (!outDir) throw new Error("Zadaj --out <direktorij> ili BACKUP_DIR.");
  const manifest = await createBackup(dbPath, outDir, (a.label as string | undefined) ?? "manual");
  console.log(JSON.stringify({ ok: true, backup: manifest.backupFile, sha256: manifest.sha256 }));
});
