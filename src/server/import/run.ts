import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalHash, canonicalJson } from "@/domain/canonical";
import { openDatabase } from "@/server/store/connection";
import { verifyReplay } from "@/server/store/replay";
import { loadState } from "@/server/store/state-repo";
import { checkIntegrity } from "@/server/db/sqlite-safety";
import { runConsistencyChecks } from "./checks";
import { buildImportPlan } from "./mapper";
import { renderReportMarkdown, type ImportReport } from "./report";
import { snapshotSources, verifySourcesUnchanged } from "./source-snapshot";
import { IMPORTER_VERSION, type Finding, type ImportPlan } from "./types";
import { writeImport } from "./writer";

export type TrialImportOptions = {
  sourceRoot: string;
  /** Korijen sandboxa; svaka proba dobiva novu generaciju `<outRoot>/<generation>/`. */
  outRoot: string;
  ownerActorId: string;
  generation: string;
  now: string;
  /** Putanja do Prisma CLI-ja (za `migrate deploy` probne baze). */
  prismaCli: string;
  projectRoot: string;
};

export type TrialImportResult = { report: ImportReport; generationDir: string; dbPath: string | null };

/** Hash sadržaja plana: ne ovisi o vremenu ni generaciji, pa dokazuje determinizam. */
export function planContentHash(plan: ImportPlan): string {
  return canonicalHash(plan);
}

/**
 * Probni uvoz: kopija izvora → plan → provjere → nova zasebna baza → replay/integritet →
 * izvještaj. Izvorni direktorij se samo čita; generacija se odbacuje brisanjem direktorija.
 */
export function runTrialImport(o: TrialImportOptions): TrialImportResult {
  const generationDir = path.resolve(o.outRoot, o.generation);
  if (existsSync(generationDir)) throw new Error(`Generacija već postoji: ${generationDir}`);
  const sourceResolved = path.resolve(o.sourceRoot);
  if (generationDir.toLowerCase().startsWith(sourceResolved.toLowerCase() + path.sep)) {
    throw new Error("Sandbox ne smije biti unutar izvornog direktorija kampanje.");
  }
  const copyRoot = path.join(generationDir, "source");
  mkdirSync(copyRoot, { recursive: true });

  const findings: Finding[] = [];
  const { manifest, findings: snapFindings } = snapshotSources(o.sourceRoot, copyRoot);
  findings.push(...snapFindings);
  const manifestHash = canonicalHash(manifest);

  let plan: ImportPlan | null = null;
  if (!findings.some((f) => f.severity === "error")) {
    const built = buildImportPlan(copyRoot, manifest, { ownerActorId: o.ownerActorId });
    findings.push(...built.findings);
    plan = built.plan;
    if (plan && !findings.some((f) => f.severity === "error")) findings.push(...runConsistencyChecks(copyRoot, plan));
  }

  const contentHash = plan ? planContentHash(plan) : null;
  const blocked = !plan || findings.some((f) => f.severity === "error");
  let dbPath: string | null = null;

  const report: ImportReport = {
    importerVersion: IMPORTER_VERSION,
    generation: o.generation,
    createdAt: o.now,
    status: blocked ? "blocked" : "trial",
    sourceManifest: manifest,
    sourceManifestHash: manifestHash,
    contentHash,
    legacy: plan?.legacy ?? null,
    counts: plan
      ? {
          characters: plan.setup.characters.length,
          resourcePools: plan.setup.resourcePools.length,
          wallets: plan.setup.wallets.length,
          items: plan.items.length,
          legacyEvents: plan.legacyEvents.length,
          entities: plan.entities.length,
          documents: plan.documents.length,
        }
      : null,
    keyValues: plan ? keyValues(plan) : [],
    mapping: plan?.mapping ?? {},
    findings,
    verification: null,
  };

  if (!blocked && plan) {
    dbPath = path.join(generationDir, "trial.db");
    execFileSync(process.execPath, [o.prismaCli, "migrate", "deploy"], {
      cwd: o.projectRoot,
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      stdio: "pipe",
    });
    const db = openDatabase(dbPath);
    try {
      // Izvještaj se u bazu sprema bez rezultata provjere (oni nastaju nakon upisa).
      const { baselineHash } = writeImport(db, plan, manifest, {
        importBatchId: `IMPORT-${o.generation}`,
        manifestHash,
        contentHash: contentHash!,
        reportJson: JSON.stringify({ ...report, verification: null }),
        now: o.now,
      });
      const replay = verifyReplay(db, plan.setup.id);
      const roundTrip = loadState(db, plan.setup.id);
      const expected = { campaignId: plan.setup.id, characters: plan.setup.characters, pools: plan.setup.resourcePools, wallets: plan.setup.wallets };
      const actual = {
        campaignId: roundTrip.campaignId,
        characters: Object.values(roundTrip.characters),
        pools: Object.values(roundTrip.resourcePools),
        wallets: Object.values(roundTrip.wallets),
      };
      const sortById = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
      const same =
        canonicalJson({ ...expected, characters: sortById(expected.characters), pools: sortById(expected.pools), wallets: sortById(expected.wallets) }) ===
        canonicalJson({ ...actual, characters: sortById(actual.characters), pools: sortById(actual.pools), wallets: sortById(actual.wallets) });
      report.verification = { baselineHash, replayOk: replay.ok, replayProblems: replay.problems, roundTripOk: same, integrityOk: false };
    } finally {
      db.close();
    }
    const v = report.verification!;
    v.integrityOk = checkIntegrity(dbPath).ok;
    if (!v.replayOk || !v.roundTripOk || !v.integrityOk) report.status = "blocked";
  }

  findings.push(...verifySourcesUnchanged(o.sourceRoot, manifest));
  if (findings.some((f) => f.code === "source_changed_during_import")) report.status = "blocked";

  writeFileSync(path.join(generationDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(generationDir, "report.md"), renderReportMarkdown(report));
  return { report, generationDir, dbPath };
}

function keyValues(plan: ImportPlan): ImportReport["keyValues"] {
  const pc = plan.setup.characters[0];
  const out: ImportReport["keyValues"] = [];
  if (pc) out.push({ label: `${pc.id} HP`, value: `${pc.hpCurrent}/${pc.hpMax ?? "?"} (privremeni ${pc.hpTemp})` });
  for (const p of plan.setup.resourcePools) {
    out.push({ label: `${p.resourceKey}`, value: p.current === null ? "nepoznato" : `${p.current}/${p.max ?? "?"}` });
  }
  for (const w of plan.setup.wallets) {
    out.push({ label: `${w.label} (${w.purpose})`, value: w.amountMinor === null ? "nepoznato" : `${w.amountMinor / 100} GP` });
  }
  out.push({ label: "Legacy verzija / posljednji događaj", value: `${plan.legacy.stateVersion ?? "?"} / ${plan.legacy.lastEventId ?? "?"}` });
  return out;
}
