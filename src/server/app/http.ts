import { isDomainError } from "@/domain/errors";
import { AccessError } from "./access";

const noStore = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/**
 * Pretvara pogreške u HTTP odgovor. Domenske i pristupne pogreške vraćaju kod i poruku
 * (bez tajni); neočekivane pogreške vraćaju generičku poruku, a detalj ide samo u log.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof AccessError) return json({ code: err.code, message: err.message }, err.status);
  if (isDomainError(err)) return json({ code: err.code, message: err.message, details: err.details }, err.httpStatus);
  console.error("[api] neočekivana pogreška", err instanceof Error ? err.message : err);
  return json({ code: "internal", message: "Neočekivana pogreška poslužitelja." }, 500);
}

export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
