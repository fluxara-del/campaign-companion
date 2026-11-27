/**
 * Verzionirani izvoz kampanje (Faza 4, spec §10). Samo čita bazu.
 *   npm run export -- --campaign <id> --out <direktorij> [--audience player|dm] [--db <putanja>] [--actor <actorId>]
 *   npm run export -- --verify --out <direktorij> [--audience player|dm]
 * Ispis: verzija stanja, event cursor i SHA-256 cijele generacije i svake datoteke.
 */
import "dotenv/config";
import { exportCampaign, readCurrentExport, type Audience } from "../../src/server/export/export";
import { openDatabase } from "../../src/server/store/connection";
import { args, main, resolveDbPath } from "../db/_shared";

void main(() => {
  const a = args({
    db: { type: "string" },
    campaign: { type: "string" },
    out: { type: "string" },
    audience: { type: "string" },
    actor: { type: "string" },
    verify: { type: "boolean" },
  });
  const audience = ((a.audience as string | undefined) ?? "player") as Audience;
  if (audience !== "player" && audience !== "dm") throw new Error("--audience mora biti player ili dm.");
  if (!a.out) throw new Error("Zadaj --out <direktorij izvoza>.");

  if (a.verify) {
    const cur = readCurrentExport(a.out as string, audience);
    if (!cur) throw new Error(`Nema objavljenog izvoza (${audience}) u ${String(a.out)}.`);
    console.log(JSON.stringify({ ok: cur.check.ok, pointer: cur.pointer, problems: cur.check.problems }, null, 2));
    return cur.check.ok ? 0 : 2;
  }

  if (!a.campaign) throw new Error("Zadaj --campaign <id>.");
  const db = openDatabase(resolveDbPath(a.db as string | undefined), { readonly: true });
  try {
    const actorId = (a.actor as string | undefined) ?? process.env.KDZ_LOCAL_OWNER_ACTOR ?? "owner";
    const r = exportCampaign(db, { actorId }, { campaignId: a.campaign as string, outRoot: a.out as string, audience });
    const m = r.manifest;
    console.log(`Izvoz ${m.audience}: ${m.campaignName} (${m.campaignId})`);
    console.log(`Verzija stanja ${m.stateVersion}, event cursor ${m.eventCursor} (${m.eventCount} događaja)`);
    console.log(`Generacija: ${r.generationDir}`);
    console.log(`SHA-256 generacije: ${m.generationSha256}`);
    for (const f of m.files) console.log(`  ${f.sha256}  ${f.bytes.toString().padStart(8)}  ${f.path}`);
    console.log(`Pointer: ${r.pointerPath}`);
    return 0;
  } finally {
    db.close();
  }
});
