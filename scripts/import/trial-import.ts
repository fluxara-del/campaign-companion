/**
 * Probni uvoz postojeće kampanje u ZASEBNU bazu nad kopijom izvora (Faza 2).
 *   npm run import:trial -- --source "E:\DnD\Kronike-Devet-Zvona" --out ./import-sandbox
 * Izvor se samo čita; dm_private se ne čita. Rezultat: <out>/<generacija>/{source/, trial.db, report.json, report.md}.
 * Odbacivanje probe = brisanje direktorija generacije.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { runTrialImport } from "../../src/server/import/run";

const { values } = parseArgs({
  options: { source: { type: "string" }, out: { type: "string" }, owner: { type: "string" } },
  strict: true,
});

try {
  if (!values.source) throw new Error("Zadaj --source <direktorij kampanje>.");
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  const now = new Date().toISOString();
  const result = runTrialImport({
    sourceRoot: path.resolve(values.source),
    outRoot: path.resolve(values.out ?? path.join(projectRoot, "import-sandbox")),
    ownerActorId: values.owner ?? "owner",
    generation: now.replace(/[:.]/g, "-"),
    now,
    prismaCli: path.join(projectRoot, "node_modules", "prisma", "build", "index.js"),
    projectRoot,
  });
  const errors = result.report.findings.filter((f) => f.severity === "error").length;
  console.log(
    JSON.stringify({
      status: result.report.status,
      generationDir: result.generationDir,
      report: path.join(result.generationDir, "report.md"),
      errors,
      warnings: result.report.findings.filter((f) => f.severity === "warning").length,
      contentHash: result.report.contentHash,
    }),
  );
  process.exit(result.report.status === "trial" ? 0 : 2);
} catch (err) {
  console.error(`GREŠKA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
