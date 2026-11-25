// Worker za test istodobnih zahtjeva: svaka nit ima vlastitu SQLite konekciju.
import { parentPort, workerData } from "node:worker_threads";
import { isDomainError } from "../../../src/domain/errors";
import { executeBatch } from "../../../src/server/store/batch-service";
import { openDatabase } from "../../../src/server/store/connection";

type Data = { file: string; batch: unknown; actorId: string; barrier: SharedArrayBuffer };

const { file, batch, actorId, barrier } = workerData as Data;
const db = openDatabase(file, { busyTimeoutMs: 10_000 });
const flag = new Int32Array(barrier);

parentPort!.postMessage({ kind: "ready" });
Atomics.wait(flag, 0, 0);

try {
  const r = executeBatch(db, { actorId }, batch);
  parentPort!.postMessage({ kind: "done", replayed: r.replayed, stateVersionAfter: r.stateVersionAfter });
} catch (err) {
  parentPort!.postMessage({ kind: "error", code: isDomainError(err) ? err.code : String(err) });
} finally {
  db.close();
}
