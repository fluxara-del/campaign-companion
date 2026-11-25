import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertTestDatabasePath } from "@/server/db/sqlite-safety";
import type { BatchCommand } from "@/domain/commands";
import { openDatabase, type Db } from "@/server/store/connection";
import { createCampaign, type CampaignSetup } from "@/server/store/campaign-setup";

const root = path.resolve(import.meta.dirname, "..", "..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");

/** Jednom migrirana predložna baza; svaki test dobiva vlastitu kopiju u os.tmpdir(). */
const opened: Db[] = [];

export function createTemplate(): { dir: string; template: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kdz-f1-"));
  const template = path.join(dir, "template.db");
  assertTestDatabasePath(template, os.tmpdir());
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${template}` },
    stdio: "pipe",
  });
  const cleanup = () => {
    for (const db of opened.splice(0)) if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return { dir, template, cleanup };
}

export function freshDb(tpl: { dir: string; template: string }, name = randomUUID()): { db: Db; file: string } {
  const file = path.join(tpl.dir, `${name}.db`);
  assertTestDatabasePath(file, os.tmpdir());
  copyFileSync(tpl.template, file);
  const db = openDatabase(file, { busyTimeoutMs: 200 });
  opened.push(db);
  return { db, file };
}

export const OWNER = { actorId: "owner-1" };
export const AI = { actorId: "ai-1" };
export const VIEWER = { actorId: "viewer-1" };
export const STRANGER = { actorId: "stranger-1" };

export const C1 = "KDZ-T1";
export const C2 = "KDZ-T2";

/** Sintetička kampanja inspirirana regresijskim slučajevima iz plana (bez stvarnih podataka). */
export function syntheticSetup(id = C1): CampaignSetup {
  return {
    id,
    name: `Sintetička ${id}`,
    members: [
      { actorId: OWNER.actorId, role: "owner" },
      { actorId: AI.actorId, role: "ai_service" },
      { actorId: VIEWER.actorId, role: "viewer" },
    ],
    characters: [{ id: `${id}-PC-001`, name: "Probni lik", hpCurrent: 20, hpMax: 24, hpTemp: 0 }],
    resourcePools: [
      { id: `${id}-slot-1`, characterId: `${id}-PC-001`, resourceKey: "spell-slot-1", current: 2, max: 2, rechargePolicy: "long_rest" },
      { id: `${id}-smite`, characterId: `${id}-PC-001`, resourceKey: "free-divine-smite", current: 0, max: 1, rechargePolicy: "long_rest" },
      { id: `${id}-insp`, characterId: `${id}-PC-001`, resourceKey: "heroic-inspiration", current: null, max: 1, rechargePolicy: null },
    ],
    wallets: [
      { id: `${id}-w-personal`, ownerCharacterId: `${id}-PC-001`, purpose: "personal", label: "Osobni", currency: "cp", amountMinor: 2100 },
      { id: `${id}-w-group`, ownerCharacterId: null, purpose: "group_dedicated", label: "Grupni fond", currency: "cp", amountMinor: 500 },
      { id: `${id}-w-unknown`, ownerCharacterId: null, purpose: "group_dedicated", label: "Nepoznat", currency: "cp", amountMinor: null },
    ],
  };
}

export function seed(db: Db): void {
  createCampaign(db, syntheticSetup(C1), { now: "2026-11-25T00:00:00.000Z" });
  createCampaign(db, syntheticSetup(C2), { now: "2026-11-25T00:00:00.000Z" });
}

const intent = { kind: "player_choice", messageId: "msg-1" } as const;

export function cmd<T extends BatchCommand["type"]>(
  type: T,
  payload: Extract<BatchCommand, { type: T }>["payload"],
  commandId: string = randomUUID(),
): BatchCommand {
  return { commandId, type, intentRef: intent, payload } as BatchCommand;
}

export function batch(
  commands: BatchCommand[],
  opts: { expectedStateVersion?: number; batchId?: string; campaignId?: string } = {},
) {
  return {
    schemaVersion: 1 as const,
    batchId: opts.batchId ?? randomUUID(),
    campaignId: opts.campaignId ?? C1,
    expectedStateVersion: opts.expectedStateVersion ?? 0,
    commands,
  };
}

export function count(db: Db, table: string, campaignId = C1): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE campaignId = ?`).get(campaignId) as { n: number }).n;
}

export function campaignVersion(db: Db, campaignId = C1): number {
  return (db.prepare(`SELECT stateVersion FROM "Campaign" WHERE id = ?`).get(campaignId) as { stateVersion: number })
    .stateVersion;
}

export function pool(db: Db, id: string): number | null {
  return (db.prepare(`SELECT current FROM "ResourcePool" WHERE id = ?`).get(id) as { current: number | null }).current;
}
