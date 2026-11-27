import { assertSameOriginJson, resolveActor } from "@/server/app/access";
import { appDb } from "@/server/app/db";
import { handle, json } from "@/server/app/http";
import { DomainError } from "@/domain/errors";
import { executeBatch } from "@/server/store/batch-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

/** `POST …/batches`: slanje i ponavljanje batcha (ADR-0004). */
export async function POST(req: Request, ctx: RouteContext<"/api/campaigns/[campaignId]/batches">) {
  return handle(async () => {
    const actor = resolveActor(req);
    assertSameOriginJson(req);
    const { campaignId } = await ctx.params;
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new DomainError("validation", "Zahtjev je prevelik.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new DomainError("validation", "Tijelo nije valjan JSON.");
    }
    if (typeof body !== "object" || body === null || (body as { campaignId?: unknown }).campaignId !== campaignId) {
      throw new DomainError("validation", "campaignId u tijelu mora odgovarati adresi.");
    }
    return json(executeBatch(appDb(), actor, body));
  });
}
