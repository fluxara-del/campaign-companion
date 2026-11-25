/**
 * Web server za Playwright: svježa privremena baza (migrate deploy + demo kampanje),
 * zatim `next start` samo na 127.0.0.1 u lokalnom single-owner načinu.
 * Nikad ne koristi razvojnu ni produkcijsku bazu.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedDemo } from "../dev/seed-demo";

const root = path.resolve(import.meta.dirname, "..", "..");
const dir = path.join(os.tmpdir(), "kdz-e2e");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const db = path.join(dir, "e2e.db");
const env = { ...process.env, DATABASE_URL: `file:${db}`, KDZ_AUTH_MODE: "local-owner", KDZ_LOCAL_OWNER_ACTOR: "owner" };

execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env, stdio: "inherit" });
const ids: string[] = [];
for (const project of ["desktop", "mobile"]) for (let i = 1; i <= 20; i++) ids.push(`E2E-${project}-${String(i).padStart(2, "0")}`);
seedDemo(db, ids);

const port = process.env.E2E_PORT ?? "3100";
const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", port], { cwd: root, env, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
