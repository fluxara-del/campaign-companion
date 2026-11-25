import { createHash } from "node:crypto";

/**
 * Kanonska JSON serijalizacija za hashiranje (podskup RFC 8785 / JCS):
 * ključevi objekata sortirani po UTF-16 kodnim jedinicama, bez razmaka,
 * nizovi zadržavaju redoslijed. Dopušteni su samo konačni cijeli brojevi,
 * jer domena ne koristi decimalne vrijednosti (iznosi su u najmanjim jedinicama).
 */
export type CanonicalOptions = {
  /**
   * "integer" (zadano, domena): dopušteni samo sigurni cijeli brojevi.
   * "any" (uvoz izvornih podataka): svaki konačan broj, zapisan kao u ECMAScriptu (RFC 8785).
   */
  numbers?: "integer" | "any";
};

export function canonicalJson(value: unknown, opts: CanonicalOptions = {}): string {
  const rec = (v: unknown) => canonicalJson(v, opts);
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (opts.numbers === "any") {
        if (!Number.isFinite(value)) throw new Error(`Broj mora biti konačan, dobiveno: ${value}`);
        return Object.is(value, -0) ? "0" : JSON.stringify(value);
      }
      if (!Number.isSafeInteger(value)) {
        throw new Error(`Kanonski JSON dopušta samo sigurne cijele brojeve, dobiveno: ${value}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(rec).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${rec(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`Vrijednost tipa ${typeof value} nije dopuštena u kanonskom JSON-u.`);
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalHash(value: unknown, opts: CanonicalOptions = {}): string {
  return sha256Hex(canonicalJson(value, opts));
}
