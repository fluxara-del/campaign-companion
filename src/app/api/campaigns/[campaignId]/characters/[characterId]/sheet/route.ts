import { resolveActor } from "@/server/app/access";
import { appDb } from "@/server/app/db";
import { handle, json } from "@/server/app/http";
import { getCharacterSheet } from "@/server/store/sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read model character sheeta (samo čitanje; ne mijenja stanje). */
export async function GET(req: Request, ctx: RouteContext<"/api/campaigns/[campaignId]/characters/[characterId]/sheet">) {
  return handle(async () => {
    const actor = resolveActor(req);
    const { campaignId, characterId } = await ctx.params;
    return json(getCharacterSheet(appDb(), actor, campaignId, characterId));
  });
}
