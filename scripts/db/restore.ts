/**
 * Restore provjerene kopije. Aplikacija MORA biti zaustavljena.
 * Postojeća baza se ne briše: premješta se u <ime>.pre-restore-<vrijeme>.
 *   npm run db:restore -- --backup ./backups/x.db --db ./data/app.db --confirm
 */
import "dotenv/config";
import { restoreBackup } from "../../src/server/db/sqlite-safety";
import { args, main, resolveDbPath } from "./_shared";

void main(() => {
  const a = args({ backup: { type: "string" }, db: { type: "string" }, confirm: { type: "boolean" } });
  if (!a.backup) throw new Error("Zadaj --backup <datoteka>.");
  if (!a.confirm) throw new Error("Restore zahtijeva --confirm (i zaustavljenu aplikaciju).");
  const result = restoreBackup(a.backup as string, resolveDbPath(a.db as string | undefined));
  console.log(JSON.stringify({ ok: true, ...result, manifest: result.manifest.backupFile }));
});
