import { isIP } from "node:net";
import type { Actor } from "@/server/store/batch-service";

/**
 * Pristup HTTP sloju dok autentifikacija nije odlučena (O5):
 * - `KDZ_AUTH_MODE=local-owner`: jedan vlasnik; dopušteno samo kad je poslužitelj vezan na loopback
 *   (`npm run dev` / `npm start` kroz `scripts/app/launch.mjs`, koji postavlja `KDZ_LISTEN_HOST`);
 *   akter je `KDZ_LOCAL_OWNER_ACTOR` (zadano `owner`). Host zaglavlje se provjerava samo kao dodatna
 *   obrana i NIJE sigurnosna granica.
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

/** Loopback adresa na koju je poslužitelj vezan (postavlja je `scripts/app/launch.mjs`). */
function boundToLoopback(): boolean {
  const norm = (h: string) => h.trim().replace(/^\[|\]$/g, "").toLowerCase();
  const listen = process.env.KDZ_LISTEN_HOST;
  if (!listen || !LOOPBACK.has(norm(listen))) return false;
  // Next.js poslužitelj u slici veže se na HOSTNAME (npr. 0.0.0.0); takva adresa isključuje lokalni način.
  // Na nekim sustavima (Fedora, RHEL) HOSTNAME je ime računala, a ne bind adresa, pa se gleda samo
  // kad je to IP literal ili zamjenska adresa.
  const hostname = process.env.HOSTNAME ? norm(process.env.HOSTNAME) : "";
  return !(isIP(hostname) !== 0 && !LOOPBACK.has(hostname));
}

export function resolveActor(req: Request): Actor {
  if (process.env.KDZ_AUTH_MODE !== "local-owner") {
    throw new AccessError(503, "auth_not_configured", "Prijava još nije konfigurirana; API je isključen.");
  }
  // Sigurnosna granica lokalnog načina je loopback bind, ne zaglavlje zahtjeva: bez potvrđene
  // loopback adrese (npr. `next start` bez -H, ili HOSTNAME=0.0.0.0) API se ne poslužuje.
  if (!boundToLoopback()) {
    throw new AccessError(503, "local_owner_requires_loopback_bind", "Lokalni način radi samo kad je aplikacija pokrenuta na 127.0.0.1 (npm run dev / npm start).");
  }
  // Provjera Host zaglavlja NIJE sigurnosna granica (klijent ga postavlja); samo dodatna obrana.
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
