import { describe, expect, it, vi } from "vitest";
import { parseMoveTarget } from "@/components/sheet/tabs";
import { postBatch } from "@/components/sheet/useSheet";

describe("parseMoveTarget (SUP-17-01)", () => {
  it("zadržava cijeli ID s dvotočkama", () => {
    expect(parseMoveTarget("container:DEMO-001-PC:item:pack")).toEqual({ kind: "container", containerItemId: "DEMO-001-PC:item:pack" });
    expect(parseMoveTarget("holder:DEMO-001-PC")).toEqual({ kind: "holder", holderRef: "DEMO-001-PC" });
    expect(parseMoveTarget("holder:UZR-001:npc:mara")).toEqual({ kind: "holder", holderRef: "UZR-001:npc:mara" });
  });
  it("odbija praznu, nepoznatu ili nepotpunu vrijednost", () => {
    for (const v of ["", "holder", "holder:", ":x", "location:Pod"]) expect(parseMoveTarget(v)).toBeNull();
  });
});

const BASE = "/api/campaigns/K";
const body = { schemaVersion: 1, batchId: "b-1", campaignId: "K", expectedStateVersion: 3, commands: [] };
const jsonRes = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const brokenRes = (status: number) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.reject(new SyntaxError("Unexpected end of JSON")) }) as unknown as Response;

describe("postBatch (SUP-17-02)", () => {
  it("uspjeh s čitljivom potvrdom", async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonRes(200, { stateVersionAfter: 4 }));
    expect(await postBatch(BASE, body, f)).toEqual({ kind: "saved", version: 4 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("2xx s nečitljivim tijelom: dohvaća potvrdu po istom batchId prije prijave uspjeha", async () => {
    const f = vi.fn().mockResolvedValueOnce(brokenRes(200)).mockResolvedValueOnce(jsonRes(200, { batchId: "b-1", stateVersionAfter: 4 }));
    expect(await postBatch(BASE, body, f)).toEqual({ kind: "saved", version: 4 });
    expect(f.mock.calls[1]![0]).toBe(`${BASE}/batches/b-1`);
    expect(f.mock.calls[1]![1]).not.toHaveProperty("method");
  });

  it("2xx s nečitljivim tijelom i nedostupnom potvrdom: ishod nepoznat, ne „spremljeno”", async () => {
    for (const second of [() => Promise.resolve(brokenRes(200)), () => Promise.resolve(jsonRes(404, { code: "not_found" })), () => Promise.reject(new TypeError("network"))]) {
      const f = vi.fn().mockResolvedValueOnce(brokenRes(200)).mockImplementationOnce(second);
      expect(await postBatch(BASE, body, f)).toEqual({ kind: "unknown" });
    }
  });

  it("2xx bez verzije u tijelu tretira se jednako kao nečitljivo", async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonRes(200, {})).mockResolvedValueOnce(jsonRes(200, { stateVersionAfter: 7 }));
    expect(await postBatch(BASE, body, f)).toEqual({ kind: "saved", version: 7 });
  });

  it("prekid veze, zauzeta baza, konflikt i odbijanje", async () => {
    expect(await postBatch(BASE, body, vi.fn().mockRejectedValueOnce(new TypeError("network")))).toEqual({ kind: "unknown" });
    expect(await postBatch(BASE, body, vi.fn().mockResolvedValueOnce(jsonRes(503, { code: "busy" })))).toEqual({ kind: "busy" });
    expect(await postBatch(BASE, body, vi.fn().mockResolvedValueOnce(jsonRes(409, { code: "stale_version", message: "Zastarjelo." })))).toEqual({ kind: "conflict", message: "Zastarjelo." });
    expect(await postBatch(BASE, body, vi.fn().mockResolvedValueOnce(brokenRes(422)))).toEqual({ kind: "rejected", message: "Zahtjev je odbijen.", code: "error" });
  });
});
