import type { Actor } from "@/server/store/batch-service";

/**
 * Pristup HTTP sloju dok autentifikacija nije odlučena (O5):
 * - `KDZ_AUTH_MODE=local-owner`: jedan vlasnik, samo zahtjevi na loopback adresu
 *   (aplikacija se pokreće s `-H 127.0.0.1`); akter je `KDZ_LOCAL_OWNER_ACTOR` (zadano `owner`).
 * - bilo što drugo (uključujući produkcijsku sliku bez postavke): API je isključen (503).
 * Mutacije dodatno traže isti origin (CSRF) i JSON tijelo.
 */
export class AccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export function resolveActor(req: Request): Actor {
  if (process.env.KDZ_AUTH_MODE !== "local-owner") {
    throw new AccessError(503, "auth_not_configured", "Prijava još nije konfigurirana; API je isključen.");
  }
  const host = hostnameOf(req.headers.get("host") ?? new URL(req.url).host);
  if (!host || !LOOPBACK.has(host)) {
    throw new AccessError(403, "loopback_only", "Lokalni način rada dopušta samo pristup s ovog računala.");
  }
  return { actorId: process.env.KDZ_LOCAL_OWNER_ACTOR || "owner" };
}

/** Isti origin za mutacije (zaštita od CSRF-a) i JSON tijelo. */
export function assertSameOriginJson(req: Request): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") ?? new URL(req.url).host;
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !host || originHost !== host) {
    throw new AccessError(403, "origin_mismatch", "Zahtjev mora doći s iste adrese aplikacije.");
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    throw new AccessError(415, "json_required", "Tijelo zahtjeva mora biti JSON.");
  }
}
