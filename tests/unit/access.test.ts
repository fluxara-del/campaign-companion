import { afterEach, describe, expect, it } from "vitest";
import { AccessError, assertSameOriginJson, resolveActor } from "@/server/app/access";
// @ts-expect-error -- .mjs pokretač bez deklaracija tipova
import { isLoopbackHost, planLaunch } from "../../scripts/app/launch.mjs";

// Host je zabranjeno zaglavlje u Request konstruktoru: adresa zahtjeva nosi host (kao u Next.js).
const req = (headers: Record<string, string>) => {
  const { host = "127.0.0.1:3000", ...rest } = headers;
  return new Request(`http://${host}/api/x`, { headers: rest });
};
const saved = { mode: process.env.KDZ_AUTH_MODE, actor: process.env.KDZ_LOCAL_OWNER_ACTOR, listen: process.env.KDZ_LISTEN_HOST, hostname: process.env.HOSTNAME };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
afterEach(() => {
  restore("KDZ_AUTH_MODE", saved.mode);
  restore("KDZ_LOCAL_OWNER_ACTOR", saved.actor);
  restore("KDZ_LISTEN_HOST", saved.listen);
  restore("HOSTNAME", saved.hostname);
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
    process.env.KDZ_LISTEN_HOST = "127.0.0.1";
    delete process.env.HOSTNAME;
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

  it("SUP-17-03: local-owner bez potvrđenog loopback binda ne poslužuje API, ni uz lažni Host 127.0.0.1", () => {
    process.env.KDZ_AUTH_MODE = "local-owner";
    delete process.env.HOSTNAME;
    const spoofed = () => resolveActor(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }));
    for (const listen of [undefined, "0.0.0.0", "192.168.1.20", "::"]) {
      restore("KDZ_LISTEN_HOST", listen);
      expect(status(spoofed), String(listen)).toBe(503);
    }
    process.env.KDZ_LISTEN_HOST = "127.0.0.1";
    process.env.HOSTNAME = "0.0.0.0";
    expect(status(spoofed)).toBe(503);
    process.env.HOSTNAME = "127.0.0.1";
    expect(status(spoofed)).toBe(200);
  });

  it("SUP-17-03: pokretač odbija local-owner uz ne-loopback adresu", () => {
    expect(planLaunch({ KDZ_AUTH_MODE: "local-owner" })).toEqual({ ok: true, host: "127.0.0.1" });
    expect(planLaunch({ KDZ_AUTH_MODE: "local-owner", KDZ_LISTEN_HOST: "::1" })).toEqual({ ok: true, host: "::1" });
    for (const h of ["0.0.0.0", "192.168.1.20", "::", "kdz.example.ts.net"]) expect(planLaunch({ KDZ_AUTH_MODE: "local-owner", KDZ_LISTEN_HOST: h }).ok).toBe(false);
    // Bez lokalnog načina (npr. buduća prava prijava) pokretač ne ograničava adresu.
    expect(planLaunch({ KDZ_LISTEN_HOST: "0.0.0.0" })).toEqual({ ok: true, host: "0.0.0.0" });
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("127.0.0.2")).toBe(false);
  });
});
