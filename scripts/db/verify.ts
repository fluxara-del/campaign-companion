/**
 * Provjera baze ili sigurnosne kopije.
 *   npm run db:verify -- --db ./data/app.db            (integrity_check aktivne baze, read-only)
 *   npm run db:verify -- --backup ./backups/x.db        (hash iz manifesta + integrity_check)
 */
import "dotenv/config";
import { checkIntegrity, verifyBackup } from "../../src/server/db/sqlite-safety";
import { args, main, resolveDbPath } from "./_shared";

void main(() => {
  const a = args({ db: { type: "string" }, backup: { type: "string" }, quick: { type: "boolean" } });
  if (a.backup) {
    const { manifest } = verifyBackup(a.backup as string);
    console.log(JSON.stringify({ ok: true, backup: manifest.backupFile, migrations: manifest.appliedMigrations.length }));
    return 0;
  }
  const result = checkIntegrity(resolveDbPath(a.db as string | undefined), { quick: Boolean(a.quick) });
  console.log(JSON.stringify(result));
  return result.ok ? 0 : 2;
});
