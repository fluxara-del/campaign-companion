import type { Finding, SourceManifest } from "./types";

export type ImportReport = {
  importerVersion: string;
  generation: string;
  createdAt: string;
  /** blocked = postoji pogreška; trial = probna baza je izrađena i provjerena. */
  status: "blocked" | "trial";
  sourceManifest: SourceManifest;
  sourceManifestHash: string;
  contentHash: string | null;
  legacy: { stateVersion: number | null; lastEventId: string | null } | null;
  counts: Record<string, number> | null;
  keyValues: { label: string; value: string }[];
  mapping: Record<string, string>;
  findings: Finding[];
  verification: {
    baselineHash: string;
    replayOk: boolean;
    replayProblems: string[];
    roundTripOk: boolean;
    integrityOk: boolean;
  } | null;
};

const SEVERITY_LABEL: Record<Finding["severity"], string> = { error: "Pogreška", warning: "Upozorenje", info: "Info" };
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Izvještaj probnog uvoza za vlasnika (hrvatski). Ne sadrži sadržaj dm_private. */
export function renderReportMarkdown(r: ImportReport): string {
  const lines: string[] = [];
  lines.push(`# Probni uvoz kampanje — izvještaj`, "");
  lines.push(`- Generacija: \`${r.generation}\``);
  lines.push(`- Vrijeme: ${r.createdAt}`);
  lines.push(`- Importer: ${r.importerVersion}`);
  lines.push(`- **Status: ${r.status === "trial" ? "probna baza izrađena i provjerena" : "BLOKIRANO — vidi pogreške"}**`);
  lines.push(`- Hash manifesta izvora: \`${r.sourceManifestHash}\``);
  lines.push(`- Hash sadržaja uvoza: \`${r.contentHash ?? "—"}\``, "");
  lines.push(
    "Stare datoteke kampanje ostaju autoritet. Ova proba nije prelazak na novu bazu; generacija se može odbaciti brisanjem njezina direktorija.",
    "",
  );

  if (r.verification) {
    const v = r.verification;
    lines.push("## Provjere probne baze", "");
    lines.push(`| Provjera | Rezultat |`, `|---|---|`);
    lines.push(`| Replay od baseline-a | ${v.replayOk ? "prolazi" : "NE PROLAZI"} |`);
    lines.push(`| Povratno čitanje stanja (lik, resursi, novčanici) | ${v.roundTripOk ? "jednako planu" : "RAZLIKUJE SE"} |`);
    lines.push(`| SQLite integrity_check | ${v.integrityOk ? "ok" : "NE PROLAZI"} |`);
    lines.push(`| Hash baseline snapshot-a | \`${v.baselineHash}\` |`, "");
  }

  if (r.keyValues.length > 0) {
    lines.push("## Ključne uvezene vrijednosti", "", "| Polje | Vrijednost |", "|---|---|");
    for (const kv of r.keyValues) lines.push(`| ${esc(kv.label)} | ${esc(kv.value)} |`);
    lines.push("");
  }

  if (r.counts) {
    lines.push("## Opseg", "", "| Vrsta | Broj |", "|---|---:|");
    for (const [k, n] of Object.entries(r.counts)) lines.push(`| ${k} | ${n} |`);
    lines.push("");
  }

  for (const sev of ["error", "warning", "info"] as const) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    lines.push(`## ${SEVERITY_LABEL[sev]} (${list.length})`, "", "| Kod | Poruka | Izvor |", "|---|---|---|");
    for (const f of list) lines.push(`| ${f.code} | ${esc(f.message)} | ${esc(f.source ?? "")} |`);
    lines.push("");
  }

  lines.push("## Izvorne datoteke (manifest)", "", "| Putanja | Veličina | SHA-256 |", "|---|---:|---|");
  for (const f of r.sourceManifest.files) lines.push(`| ${f.path} | ${f.size} | \`${f.sha256}\` |`);
  lines.push("", `Namjerno nečitano (samo imena): ${r.sourceManifest.excluded.join(", ") || "—"}`, "");
  return lines.join("\n");
}
