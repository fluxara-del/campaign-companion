import { resolveActor } from "@/server/app/access";
import { appDb } from "@/server/app/db";
import { handle, json } from "@/server/app/http";
import { getBatchReceipt } from "@/server/store/batch-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `GET …/batches/:batchId`: oporavak ishoda nakon timeouta. */
export async function GET(req: Request, ctx: RouteContext<"/api/campaigns/[campaignId]/batches/[batchId]">) {
  return handle(async () => {
    const actor = resolveActor(req);
    const { campaignId, batchId } = await ctx.params;
    return json(getBatchReceipt(appDb(), actor, campaignId, batchId));
  });
}
