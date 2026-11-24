/**
 * CI i pre-deploy provjera migracija.
 *
 * Bez --db (CI): provjerava sve migracije u repozitoriju — destruktivne naredbe moraju
 * imati marker `-- kdz:allow-destructive: <razlog>`; migration_lock mora biti sqlite.
 *
 * S --db (pre-deploy): procjenjuje kompatibilnost konkretne baze s migracijama u ovoj
 * verziji aplikacije. Izlazni kod 0 = sigurno, 3 = nesigurno/nekompatibilno.
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeMigrations,
  findDestructiveStatements,
  listBundledMigrations,
} from "../../src/server/db/sqlite-safety";
import { args, main } from "./_shared";

void main(() => {
  const a = args({ db: { type: "string" }, migrations: { type: "string" }, json: { type: "boolean" } });
  const migrationsDir = path.resolve((a.migrations as string | undefined) ?? "prisma/migrations");

  if (a.db) {
    const analysis = analyzeMigrations(path.resolve(a.db as string), migrationsDir);
    console.log(JSON.stringify(analysis, null, a.json ? 0 : 2));
    return analysis.safeToApply ? 0 : 3;
  }

  const problems: string[] = [];
  const lockPath = path.join(migrationsDir, "migration_lock.toml");
  if (!existsSync(lockPath)) problems.push("Nedostaje migration_lock.toml.");
  else if (!/provider\s*=\s*"sqlite"/.test(readFileSync(lockPath, "utf8"))) {
    problems.push("migration_lock.toml nije za sqlite.");
  }

  const migrations = listBundledMigrations(migrationsDir);
  if (migrations.length === 0) problems.push("Nema nijedne migracije.");
  for (const m of migrations) {
    if (!/^\d{14}_[a-z0-9_]+$/.test(m)) problems.push(`Neispravno ime migracije: ${m}`);
    const sql = readFileSync(path.join(migrationsDir, m, "migration.sql"), "utf8");
    const { statements, allowed } = findDestructiveStatements(sql);
    if (statements.length > 0 && !allowed) {
      problems.push(`${m}: destruktivne naredbe bez markera kdz:allow-destructive:\n  ${statements.join("\n  ")}`);
    } else if (statements.length > 0) {
      console.log(`UPOZORENJE ${m}: odobrena destruktivna migracija (${statements.length} naredbi).`);
    }
  }

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    return 1;
  }
  console.log(`OK: ${migrations.length} migracija, bez neodobrenih destruktivnih naredbi.`);
  return 0;
});
