import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import { executeBatch } from "@/server/store/batch-service";
import { openDatabase } from "@/server/store/connection";
import { batch, C1, campaignVersion, cmd, count, createTemplate, freshDb, OWNER, pool, seed } from "./helpers";

let tpl: ReturnType<typeof createTemplate>;
beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => tpl.cleanup());

const SLOT = `${C1}-slot-1`;
const workerFile = path.join(import.meta.dirname, "workers", "submit-batch.ts");

type WorkerResult = { kind: "done"; replayed: boolean; stateVersionAfter: number } | { kind: "error"; code: string };

/** Pokreće N niti, svaku s vlastitom konekcijom, i pušta ih istodobno preko zajedničke barijere. */
async function runConcurrently(file: string, batches: unknown[]): Promise<WorkerResult[]> {
  const barrier = new SharedArrayBuffer(4);
  const flag = new Int32Array(barrier);
  let ready = 0;
  const results = batches.map(
    (b) =>
      new Promise<WorkerResult>((resolve, reject) => {
        const w = new Worker(workerFile, {
          workerData: { file, batch: b, actorId: OWNER.actorId, barrier },
          execArgv: ["--import", "tsx"],
        });
        w.on("message", (m: WorkerResult | { kind: "ready" }) => {
          if (m.kind === "ready") {
            ready += 1;
            if (ready === batches.length) {
              Atomics.store(flag, 0, 1);
              Atomics.notify(flag, 0);
            }
          } else {
            resolve(m);
            void w.terminate();
          }
        });
        w.on("error", reject);
      }),
  );
  return Promise.all(results);
}

describe("ADR-0004 kriterij 1 i 7: istodobni zahtjevi iz zasebnih konekcija", () => {
  it("12 istodobnih identičnih batcheva → točno jedan commit, ostali dobivaju isti receipt", async () => {
    const { db, file } = freshDb(tpl);
    seed(db);
    const b = batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]);
    const results = await runConcurrently(file, Array.from({ length: 12 }, () => structuredClone(b)));

    expect(results.every((r) => r.kind === "done")).toBe(true);
    const done = results as Extract<WorkerResult, { kind: "done" }>[];
    expect(done.filter((r) => !r.replayed)).toHaveLength(1);
    expect(done.every((r) => r.stateVersionAfter === 1)).toBe(true);
    expect(pool(db, SLOT)).toBe(1);
    expect(count(db, "BatchReceipt")).toBe(1);
    expect(count(db, "DomainEvent")).toBe(1);
    expect(campaignVersion(db)).toBe(1);
    db.close();
  }, 120_000);

  it("10 istodobnih različitih batcheva s istom verzijom → jedan commit, devet stale_version", async () => {
    const { db, file } = freshDb(tpl);
    seed(db);
    const batches = Array.from({ length: 10 }, () => batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]));
    const results = await runConcurrently(file, batches);

    expect(results.filter((r) => r.kind === "done")).toHaveLength(1);
    const errors = results.filter((r): r is Extract<WorkerResult, { kind: "error" }> => r.kind === "error");
    expect(errors).toHaveLength(9);
    expect(errors.every((e) => e.code === "stale_version")).toBe(true);
    expect(pool(db, SLOT)).toBe(1);
    expect(campaignVersion(db)).toBe(1);
    db.close();
  }, 120_000);
});

describe("Zauzeta baza", () => {
  it("kad drugi pisac drži lock → busy (503) bez upisa; isti batch nakon oslobađanja → jedan commit", () => {
    const { db, file } = freshDb(tpl);
    seed(db);
    const blocker = openDatabase(file, { busyTimeoutMs: 0 });
    blocker.exec("BEGIN IMMEDIATE");

    const b = batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]);
    let err: unknown;
    try {
      executeBatch(db, OWNER, b);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("busy");
    expect((err as DomainError).httpStatus).toBe(503);

    blocker.exec("ROLLBACK");
    blocker.close();
    expect(pool(db, SLOT)).toBe(2);
    expect(count(db, "BatchReceipt")).toBe(0);

    const r = executeBatch(db, OWNER, b);
    expect(r.replayed).toBe(false);
    expect(executeBatch(db, OWNER, b).replayed).toBe(true);
    expect(pool(db, SLOT)).toBe(1);
    db.close();
  });

  it("dok čitatelj drži otvorenu read transakciju (WAL), pisanje uspijeva", () => {
    const { db, file } = freshDb(tpl);
    seed(db);
    const reader = openDatabase(file, { busyTimeoutMs: 0 });
    reader.exec("BEGIN");
    reader.prepare(`SELECT * FROM "Campaign"`).all();
    const r = executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })], { batchId: randomUUID() }));
    expect(r.replayed).toBe(false);
    reader.exec("COMMIT");
    reader.close();
    db.close();
  });
});
