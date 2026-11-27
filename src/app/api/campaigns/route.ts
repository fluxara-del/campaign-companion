import { appDb } from "@/server/app/db";
import { resolveActor } from "@/server/app/access";
import { handle, json } from "@/server/app/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kampanje i likovi kojima je akter član (samo ID i naziv). */
export function GET(req: Request) {
  return handle(() => {
    const actor = resolveActor(req);
    const rows = appDb()
      .prepare(
        `SELECT c.id AS campaignId, c.name AS campaignName, ch.id AS characterId, ch.name AS characterName
         FROM "Member" m JOIN "Campaign" c ON c.id = m.campaignId LEFT JOIN "Character" ch ON ch.campaignId = c.id
         WHERE m.actorId = ? ORDER BY c.name, ch.name`,
      )
      .all(actor.actorId);
    return json({ campaigns: rows });
  });
}
