/**
 * Upisuje sintetičke demo kampanje u (već migriranu) lokalnu bazu.
 *   npm run dev:seed -- --db ./data/dev.db [--ids DEMO-001,DEMO-002]
 * Nikad ne dira postojeće kampanje (isti ID → pogreška).
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { openDatabase } from "../../src/server/store/connection";
import { createCampaign } from "../../src/server/store/campaign-setup";
import { demoCampaign } from "./demo-campaign";

export function seedDemo(dbPath: string, ids: string[], owner = "owner"): void {
  const db = openDatabase(path.resolve(dbPath));
  try {
    for (const id of ids) {
      createCampaign(db, demoCampaign(id, owner), { source: "synthetic", now: "2026-11-25T00:00:00.000Z" });
      const npc = db.prepare(`INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES (?, ?, 'npc', ?, NULL, ?, '{}', 'demo')`);
      npc.run("NPC-MARA", id, "Mara (suputnica)", "player");
      npc.run("NPC-TAJNI", id, "Tajni zlikovac", "dm");
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: { db: { type: "string" }, ids: { type: "string" }, owner: { type: "string" } } });
  const db = values.db ?? "./data/dev.db";
  const ids = (values.ids ?? "DEMO-001").split(",").map((s) => s.trim()).filter(Boolean);
  seedDemo(db, ids, values.owner ?? "owner");
  console.log(`Demo kampanje upisane u ${db}: ${ids.join(", ")}`);
}
