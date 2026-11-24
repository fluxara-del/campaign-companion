import path from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { sqlitePathFromUrl } from "../../src/server/db/sqlite-safety";

export function resolveDbPath(cliValue: string | undefined): string {
  if (cliValue) return path.resolve(cliValue);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Zadaj --db <putanja> ili DATABASE_URL.");
  return sqlitePathFromUrl(url);
}

export function args(options: ParseArgsOptionsConfig) {
  return parseArgs({ options, strict: true, allowPositionals: false }).values as Record<
    string,
    string | boolean | undefined
  >;
}

export async function main(fn: () => Promise<number | void> | number | void): Promise<void> {
  try {
    const code = await fn();
    process.exit(typeof code === "number" ? code : 0);
  } catch (err) {
    console.error(`GREŠKA: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
