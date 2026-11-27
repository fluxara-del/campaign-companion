// Pokretač `next dev` / `next start` koji veže poslužitelj na izričitu adresu.
//
// Lokalni način bez prijave (KDZ_AUTH_MODE=local-owner, O5 još otvoren) smije raditi samo kad
// poslužitelj sluša na loopback adresi. Provjera Host zaglavlja u API-ju NIJE sigurnosna granica
// (klijent ga može postaviti po volji); granica je bind adresa koju ovdje postavljamo i provjeravamo.
//
// Uporaba: node scripts/app/launch.mjs dev|start [-p PORT]
// Adresa: KDZ_LISTEN_HOST (zadano 127.0.0.1). Pokretač je prosljeđuje Next.js-u (-H) i API-ju
// (process.env.KDZ_LISTEN_HOST), koji local-owner odbija ako adresa nije loopback.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** @param {string | undefined | null} host */
export function isLoopbackHost(host) {
  return typeof host === "string" && LOOPBACK.has(host.trim().replace(/^\[|\]$/g, "").toLowerCase());
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, host: string } | { ok: false, host: string, message: string }}
 */
export function planLaunch(env) {
  const host = (env.KDZ_LISTEN_HOST ?? "127.0.0.1").trim();
  if (env.KDZ_AUTH_MODE === "local-owner" && !isLoopbackHost(host)) {
    return {
      ok: false,
      host,
      message: `KDZ_AUTH_MODE=local-owner dopušten je samo uz loopback adresu (127.0.0.1 ili ::1), a zadano je „${host}”. Lokalni način nema prijavu; ne izlaži ga mreži.`,
    };
  }
  return { ok: true, host };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "dev" && mode !== "start") {
    console.error("Uporaba: node scripts/app/launch.mjs dev|start [-p PORT]");
    process.exit(2);
  }
  const plan = planLaunch(process.env);
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [next, mode, "-H", plan.host, ...rest], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, KDZ_LISTEN_HOST: plan.host },
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
