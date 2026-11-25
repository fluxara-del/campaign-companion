import { afterEach, describe, expect, it } from "vitest";
import { AccessError, assertSameOriginJson, resolveActor } from "@/server/app/access";

// Host je zabranjeno zaglavlje u Request konstruktoru: adresa zahtjeva nosi host (kao u Next.js).
const req = (headers: Record<string, string>) => {
  const { host = "127.0.0.1:3000", ...rest } = headers;
  return new Request(`http://${host}/api/x`, { headers: rest });
};
const saved = { mode: process.env.KDZ_AUTH_MODE, actor: process.env.KDZ_LOCAL_OWNER_ACTOR };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
afterEach(() => {
  restore("KDZ_AUTH_MODE", saved.mode);
  restore("KDZ_LOCAL_OWNER_ACTOR", saved.actor);
});

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    if (e instanceof AccessError) return e.status;
    throw e;
  }
  return 200;
}

describe("pristup API-ju bez autentifikacije (O5)", () => {

  it("bez KDZ_AUTH_MODE API je isključen (503) — i u produkcijskoj slici", () => {
    delete process.env.KDZ_AUTH_MODE;
    expect(status(() => resolveActor(req({ host: "127.0.0.1:3000" })))).toBe(503);
  });

  it("lokalni način prihvaća samo loopback host", () => {
    process.env.KDZ_AUTH_MODE = "local-owner";
    delete process.env.KDZ_LOCAL_OWNER_ACTOR;
    expect(resolveActor(req({ host: "127.0.0.1:3000" }))).toEqual({ actorId: "owner" });
    expect(resolveActor(req({ host: "localhost:3000" }))).toEqual({ actorId: "owner" });
    expect(status(() => resolveActor(req({ host: "192.168.1.20:3000" })))).toBe(403);
    expect(status(() => resolveActor(req({ host: "kdz.example.ts.net" })))).toBe(403);
  });

  it("mutacije traže isti origin i JSON", () => {
    expect(status(() => assertSameOriginJson(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" })))).toBe(200);
    expect(status(() => assertSameOriginJson(req({ host: "127.0.0.1:3000", origin: "http://evil.example", "content-type": "application/json" })))).toBe(403);
    expect(status(() => assertSameOriginJson(req({ host: "127.0.0.1:3000", "content-type": "application/json" })))).toBe(403);
    expect(status(() => assertSameOriginJson(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "text/plain" })))).toBe(415);
  });
});
