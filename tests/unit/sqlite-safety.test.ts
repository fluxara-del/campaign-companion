import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTestDatabasePath,
  findDestructiveStatements,
  sqlitePathFromUrl,
} from "@/server/db/sqlite-safety";

describe("sqlitePathFromUrl", () => {
  it("razrješava relativnu putanju prema radnom direktoriju", () => {
    expect(sqlitePathFromUrl("file:./data/app.db", "/srv/app")).toBe(path.resolve("/srv/app", "data/app.db"));
  });

  it("zadržava apsolutnu putanju i odbacuje query parametre", () => {
    const abs = path.resolve("/data/app.db");
    expect(sqlitePathFromUrl(`file:${abs}?connection_limit=1`)).toBe(abs);
  });

  it("odbija URL koji nije SQLite datoteka", () => {
    expect(() => sqlitePathFromUrl("postgres://x")).toThrow();
    expect(() => sqlitePathFromUrl("file:")).toThrow();
  });
});

describe("findDestructiveStatements", () => {
  it("prepoznaje DROP TABLE, DROP COLUMN i DELETE", () => {
    const sql = `CREATE TABLE "A" ("id" TEXT);\nDROP TABLE "B";\nALTER TABLE "C" DROP COLUMN "x";\nDELETE FROM "D";`;
    expect(findDestructiveStatements(sql).statements).toHaveLength(3);
    expect(findDestructiveStatements(sql).allowed).toBe(false);
  });

  it("ignorira komentare i aditivne naredbe", () => {
    const sql = `-- DROP TABLE "X" u komentaru\nCREATE TABLE "A" ("id" TEXT);\nCREATE INDEX "i" ON "A"("id");`;
    expect(findDestructiveStatements(sql).statements).toHaveLength(0);
  });

  it("poštuje izričit marker odobrenja", () => {
    const sql = `-- kdz:allow-destructive: preimenovanje stupca uz kopiranje podataka\nDROP TABLE "Old";`;
    const r = findDestructiveStatements(sql);
    expect(r.allowed).toBe(true);
    expect(r.statements).toHaveLength(1);
  });
});

describe("assertTestDatabasePath", () => {
  it("dopušta bazu unutar privremenog direktorija", () => {
    expect(() => assertTestDatabasePath(path.join(os.tmpdir(), "kdz-test", "t.db"), os.tmpdir())).not.toThrow();
  });

  it("odbija bazu izvan privremenog direktorija", () => {
    expect(() => assertTestDatabasePath(path.resolve("/DATA/AppData/campaign-companion/data/app.db"), os.tmpdir())).toThrow();
  });
});
