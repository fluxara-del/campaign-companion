import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import { executeBatch, getBatchReceipt } from "@/server/store/batch-service";
import type { Db } from "@/server/store/connection";
import { loadState } from "@/server/store/state-repo";
import {
  AI,
  batch,
  C1,
  C2,
  campaignVersion,
  cmd,
  count,
  createTemplate,
  freshDb,
  OWNER,
  PLAYER,
  PLAYER2,
  pool,
  seed,
  STRANGER,
  VIEWER,
} from "./helpers";

let tpl: ReturnType<typeof createTemplate>;
let db: Db;

beforeAll(() => {
  tpl = createTemplate();
});
afterAll(() => tpl.cleanup());
beforeEach(() => {
  db = freshDb(tpl).db;
  seed(db);
});

function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error(`Očekivana DomainError ${code}, a nije bačena.`);
}

const SLOT = `${C1}-slot-1`;
const PC = `${C1}-PC-001`;

describe("ADR-0004 kriterij 1: isti batch dvaput → jedan commit, jedan trošak", () => {
  it("sekvencijalno ponavljanje vraća isti odgovor bez novog upisa", () => {
    const b = batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]);
    const first = executeBatch(db, OWNER, b);
    const second = executeBatch(db, OWNER, structuredClone(b));
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect({ ...second, replayed: false }).toEqual(first);
    expect(pool(db, SLOT)).toBe(1);
    expect(count(db, "BatchReceipt")).toBe(1);
    expect(count(db, "DomainEvent")).toBe(1);
    expect(campaignVersion(db)).toBe(1);
  });

  it("ponavljanje radi i nakon kasnijih promjena (izgubljeni odgovor), bez provjere trenutačne verzije", () => {
    const b1 = batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]);
    executeBatch(db, OWNER, b1);
    executeBatch(db, OWNER, batch([cmd("ApplyDamage", { characterId: PC, amount: 3, damageType: null })], { expectedStateVersion: 1 }));
    const again = executeBatch(db, OWNER, b1);
    expect(again.replayed).toBe(true);
    expect(again.stateVersionAfter).toBe(1);
    expect(pool(db, SLOT)).toBe(1);
    expect(campaignVersion(db)).toBe(2);
  });
});

describe("ADR-0004 kriterij 2: isti batchId, drugi sadržaj → 409 bez upisa", () => {
  it.each([
    ["izmijenjen iznos", (b: ReturnType<typeof batch>) => ((b.commands[0]!.payload as { amount: number }).amount = 2)],
    ["obrnut redoslijed", (b: ReturnType<typeof batch>) => b.commands.reverse()],
    ["dodatni član", (b: ReturnType<typeof batch>) => b.commands.push(cmd("ApplyHealing", { characterId: PC, amount: 1 }))],
  ])("%s", (_label, mutate) => {
    const b = batch([
      cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 }),
      cmd("ApplyDamage", { characterId: PC, amount: 2, damageType: "fire" }),
    ]);
    executeBatch(db, OWNER, b);
    const before = { events: count(db, "DomainEvent"), state: loadState(db, C1), version: campaignVersion(db) };
    const changed = structuredClone(b);
    mutate(changed);
    expectDomainError(() => executeBatch(db, OWNER, changed), "batch_id_reused");
    expect(count(db, "DomainEvent")).toBe(before.events);
    expect(loadState(db, C1)).toEqual(before.state);
    expect(campaignVersion(db)).toBe(before.version);
  });
});

describe("ADR-0004 kriterij 3: novi batch s već potvrđenim commandId → 409", () => {
  it("odbija ponovnu uporabu člana i ne upisuje ništa", () => {
    const c = cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 });
    executeBatch(db, OWNER, batch([c]));
    const err = expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 }), c], { expectedStateVersion: 1 })),
      "command_id_reused",
    );
    expect(err.details.commandIndex).toBe(1);
    expect(pool(db, SLOT)).toBe(1);
    expect(campaignVersion(db)).toBe(1);
  });

  it("odbija isti commandId dvaput unutar batcha (422) prije transakcije", () => {
    const id = randomUUID();
    expectDomainError(
      () =>
        executeBatch(db, OWNER, batch([
          cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 }, id),
          cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 }, id),
        ])),
      "duplicate_command_in_batch",
    );
    expect(count(db, "BatchReceipt")).toBe(0);
  });
});

describe("ADR-0004 kriterij 4: dva različita batcha s istom verzijom", () => {
  it("prvi commita, drugi dobiva stale_version s trenutačnom verzijom", () => {
    executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]));
    const err = expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })])),
      "stale_version",
    );
    expect(err.httpStatus).toBe(409);
    expect(err.details.currentStateVersion).toBe(1);
    expect(pool(db, SLOT)).toBe(1);
  });
});

describe("ADR-0004 kriterij 5: pogreška u zadnjem članu → ništa se ne upisuje", () => {
  it("rollback cijelog batcha, bez receipt-a, događaja, journala i promjene stanja", () => {
    const before = loadState(db, C1);
    const err = expectDomainError(
      () =>
        executeBatch(db, OWNER, batch([
          cmd("ApplyDamage", { characterId: PC, amount: 5, damageType: null }),
          cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 }),
          cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 5 }),
        ])),
      "rule_violation",
    );
    expect(err.details.commandIndex).toBe(2);
    expect(loadState(db, C1)).toEqual(before);
    for (const t of ["BatchReceipt", "DomainEvent", "JournalEntry"]) expect(count(db, t)).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "CommandIndex"`).get() as { n: number }).n).toBe(0);
    expect(campaignVersion(db)).toBe(0);
  });

  it("neočekivana pogreška neposredno prije COMMIT-a također vraća sve", () => {
    expect(() =>
      executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]), {
        beforeCommit: () => {
          throw new Error("simulirani pad prije commita");
        },
      }),
    ).toThrow("simulirani pad");
    expect(pool(db, SLOT)).toBe(2);
    expect(count(db, "BatchReceipt")).toBe(0);
  });
});

describe("ADR-0004 kriterij 6: prekid nakon commita", () => {
  it("ponovljeni batch vraća receipt bez novog troška; GET po batchId vraća isto", () => {
    const b = batch([cmd("ConsumeResource", { resourcePoolId: SLOT, amount: 1 })]);
    expect(() =>
      executeBatch(db, OWNER, b, {
        afterCommit: () => {
          throw new Error("veza prekinuta nakon commita");
        },
      }),
    ).toThrow("veza prekinuta");
    expect(pool(db, SLOT)).toBe(1);
    const recovered = getBatchReceipt(db, OWNER, C1, b.batchId);
    const retried = executeBatch(db, OWNER, b);
    expect(retried.replayed).toBe(true);
    expect(retried.events).toEqual(recovered.events);
    expect(pool(db, SLOT)).toBe(1);
    expect(campaignVersion(db)).toBe(1);
  });

  it("GET za nepotvrđen batch vraća not_found", () => {
    expectDomainError(() => getBatchReceipt(db, OWNER, C1, randomUUID()), "not_found");
  });
});

describe("Atomski zapis: receipt, događaji, indeks, journal i verzija zajedno", () => {
  it("složeni batch daje jedan receipt, događaje u redoslijedu i journal projekciju", () => {
    const r = executeBatch(db, OWNER, batch([
      cmd("SetTemporaryHp", { characterId: PC, amount: 5, mode: "replace" }),
      cmd("ApplyDamage", { characterId: PC, amount: 8, damageType: "slashing" }),
      cmd("SpendCurrency", { walletId: `${C1}-w-personal`, amountMinor: 100, reason: "Lijek" }),
      cmd("AppendJournalNote", { title: "Bilješka", text: "Platili smo iscjelitelja.", visibility: "player" }),
    ]));
    expect(r.stateVersionBefore).toBe(0);
    expect(r.stateVersionAfter).toBe(1);
    expect(r.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(r.events.map((e) => e.type)).toEqual(["TemporaryHpSet", "DamageApplied", "CurrencySpent", "JournalNoteAppended"]);
    const s = loadState(db, C1);
    expect(s.characters[PC]).toMatchObject({ hpTemp: 0, hpCurrent: 17 });
    expect(s.wallets[`${C1}-w-personal`]!.amountMinor).toBe(2000);
    expect(s.wallets[`${C1}-w-group`]!.amountMinor).toBe(500);
    expect(count(db, "JournalEntry")).toBe(2);
    const links = db.prepare(`SELECT COUNT(*) AS n FROM "JournalEventLink"`).get() as { n: number };
    expect(links.n).toBe(4);
    const projection = db.prepare(`SELECT text FROM "JournalEntry" WHERE kind = 'projection'`).get() as { text: string };
    expect(projection.text).toContain("HP 20 → 17");
  });

  it("svaka potvrđena promjena ima događaj i receipt", () => {
    for (let v = 0; v < 3; v++) {
      executeBatch(db, OWNER, batch([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })], { expectedStateVersion: v }));
    }
    const orphans = db
      .prepare(`SELECT COUNT(*) AS n FROM "DomainEvent" e LEFT JOIN "BatchReceipt" r ON r.campaignId = e.campaignId AND r.batchId = e.batchId WHERE r.batchId IS NULL`)
      .get() as { n: number };
    expect(orphans.n).toBe(0);
    expect(count(db, "BatchReceipt")).toBe(3);
    expect(campaignVersion(db)).toBe(3);
  });
});

describe("Nepoznate vrijednosti ostaju nepoznate", () => {
  it("potrošnja nepoznatog resursa → needs_ruling, vrijednost ostaje null", () => {
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: `${C1}-insp`, amount: 1 })])),
      "needs_ruling",
    );
    expect(pool(db, `${C1}-insp`)).toBeNull();
  });

  it("plaćanje iz novčanika nepoznatog stanja → needs_ruling", () => {
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("SpendCurrency", { walletId: `${C1}-w-unknown`, amountMinor: 1, reason: "x" })])),
      "needs_ruling",
    );
  });

  it("iskorištena besplatna uporaba (0/1) ostaje potrošena", () => {
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: `${C1}-smite`, amount: 1 })])),
      "rule_violation",
    );
    expect(pool(db, `${C1}-smite`)).toBe(0);
  });
});

describe("Pristup kampanji", () => {
  it("akter koji nije član i nepostojeća kampanja dobivaju isti 403", () => {
    const e1 = expectDomainError(() => executeBatch(db, STRANGER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })])), "forbidden");
    const e2 = expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })], { campaignId: "NE-POSTOJI" })),
      "forbidden",
    );
    expect(e1.message).toBe(e2.message);
  });

  it("viewer ne može pisati; AI ne troši novac i ne piše DM bilješke", () => {
    expectDomainError(() => executeBatch(db, VIEWER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })])), "forbidden");
    expectDomainError(
      () => executeBatch(db, AI, batch([cmd("SpendCurrency", { walletId: `${C1}-w-personal`, amountMinor: 1, reason: "x" })])),
      "forbidden",
    );
    expectDomainError(
      () => executeBatch(db, AI, batch([cmd("AppendJournalNote", { title: null, text: "tajna", visibility: "dm" })])),
      "forbidden",
    );
    const ok = executeBatch(db, AI, batch([cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null })]));
    const actor = db.prepare(`SELECT actorKind FROM "DomainEvent" WHERE id = ?`).get(ok.events[0]!.id) as { actorKind: string };
    expect(actor.actorKind).toBe("ai_service");
  });

  it("naredba ne može dirati entitet druge kampanje", () => {
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ConsumeResource", { resourcePoolId: `${C2}-slot-1`, amount: 1 })])),
      "rule_violation",
    );
    expect(pool(db, `${C2}-slot-1`)).toBe(2);
  });

  it("receipt druge kampanje nije dostupan akteru koji tamo nije član", () => {
    const r = executeBatch(db, OWNER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })]));
    expectDomainError(() => getBatchReceipt(db, STRANGER, C1, r.batchId), "forbidden");
  });
});

describe("Pristup potvrdi batcha (autor ili vlasnik)", () => {
  function dmNoteBatch() {
    return batch([
      cmd("ApplyDamage", { characterId: PC, amount: 1, damageType: null }),
      cmd("AppendJournalNote", { title: "Tajna", text: "Samo za DM-a.", visibility: "dm" }),
    ]);
  }

  it("autor nakon timeouta dohvaća potvrdu i smije ponoviti batch; vlasnik vidi potvrdu", () => {
    const b = dmNoteBatch();
    expect(() =>
      executeBatch(db, PLAYER, b, {
        afterCommit: () => {
          throw new Error("timeout");
        },
      }),
    ).toThrow("timeout");
    const mine = getBatchReceipt(db, PLAYER, C1, b.batchId);
    expect(mine.journalEntryIds).toHaveLength(2);
    expect(executeBatch(db, PLAYER, b).replayed).toBe(true);
    expect(getBatchReceipt(db, OWNER, C1, b.batchId).events).toEqual(mine.events);
  });

  it.each([
    ["drugi igrač", PLAYER2],
    ["viewer", VIEWER],
    ["ai_service", AI],
  ])("%s ne dobiva metapodatke tuđeg batcha ni kroz GET ni kroz ponavljanje", (_l, other) => {
    const b = dmNoteBatch();
    const r = executeBatch(db, PLAYER, b);
    const dmNoteId = r.journalEntryIds[1]!;

    const getErr = expectDomainError(() => getBatchReceipt(db, other, C1, b.batchId), "not_found");
    const missing = expectDomainError(() => getBatchReceipt(db, other, C1, randomUUID()), "not_found");
    expect(getErr.message).toBe(missing.message);
    expect(JSON.stringify(getErr.details)).not.toContain(dmNoteId);

    // Ponavljanje istog batcha od drugog aktera ne otkriva sadržaj (ai/viewer padaju već na ovlastima).
    const err = (() => {
      try {
        executeBatch(db, other, b);
      } catch (e) {
        return e as DomainError;
      }
      throw new Error("očekivana pogreška");
    })();
    expect(["batch_id_reused", "forbidden"]).toContain(err.code);
    expect(JSON.stringify(err.details)).not.toContain(dmNoteId);
    expect(JSON.stringify(err.details)).not.toContain(r.events[0]!.id);
    expect(count(db, "BatchReceipt")).toBe(1);
  });
});

describe("Naslijeđena svojstva objekta nisu entiteti (Codex P1)", () => {
  const protoKeys = () => Object.getOwnPropertyNames(Object.prototype).sort();

  it.each([
    ["ApplyDamage", { characterId: "toString", amount: 3, damageType: null }],
    ["ApplyHealing", { characterId: "hasOwnProperty", amount: 1 }],
    ["SetTemporaryHp", { characterId: "valueOf", amount: 5, mode: "replace" }],
    ["ConsumeResource", { resourcePoolId: "isPrototypeOf", amount: 1 }],
    ["SpendCurrency", { walletId: "toLocaleString", amountMinor: 1, reason: "x" }],
  ] as const)("%s s ID-em naslijeđenog svojstva → odbijeno bez ikakve promjene", (type, payload) => {
    const keysBefore = protoKeys();
    const stateBefore = loadState(db, C1);
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd(type, payload as never)])),
      "rule_violation",
    );
    expect(protoKeys()).toEqual(keysBefore);
    expect(({} as Record<string, unknown>).hpTemp).toBeUndefined();
    expect(({} as Record<string, unknown>).hpCurrent).toBeUndefined();
    expect(loadState(db, C1)).toEqual(stateBefore);
    expect(campaignVersion(db)).toBe(0);
    for (const t of ["DomainEvent", "BatchReceipt", "JournalEntry"]) expect(count(db, t)).toBe(0);
  });

  it.each(["__proto__", "constructor", "prototype"])("rezervirani ključ %s se odbija već pri validaciji", (id) => {
    expectDomainError(() => executeBatch(db, OWNER, batch([cmd("ApplyDamage", { characterId: id, amount: 1, damageType: null })])), "validation");
    expect(count(db, "BatchReceipt")).toBe(0);
  });

  it("valjani ID i dalje prolazi", () => {
    const r = executeBatch(db, OWNER, batch([cmd("ApplyDamage", { characterId: PC, amount: 3, damageType: null })]));
    expect(r.replayed).toBe(false);
    expect(loadState(db, C1).characters[PC]!.hpCurrent).toBe(17);
  });

  it("učitavanje stanja s ID-em __proto__ iz baze stvara vlastito svojstvo, ne mijenja prototip", () => {
    db.prepare(`INSERT INTO "Character" (id, campaignId, name, hpCurrent, hpMax, hpTemp) VALUES ('__proto__', ?, 'X', 1, 1, 0)`).run(C1);
    const s = loadState(db, C1);
    expect(Object.hasOwn(s.characters, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(s.characters)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).hpCurrent).toBeUndefined();
    const cloned = structuredClone(s).characters;
    expect(Object.hasOwn(cloned, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(cloned, "__proto__")?.value).toMatchObject({ name: "X" });
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
  });
});

describe("Validacija ulaza", () => {
  it("nepoznata polja i decimalni iznosi se odbijaju", () => {
    const b = batch([cmd("ApplyHealing", { characterId: PC, amount: 1 })]) as Record<string, unknown>;
    expectDomainError(() => executeBatch(db, OWNER, { ...b, actorId: "lažni" }), "validation");
    expectDomainError(
      () => executeBatch(db, OWNER, batch([cmd("ApplyHealing", { characterId: PC, amount: 1.5 })])),
      "validation",
    );
    expect(count(db, "BatchReceipt")).toBe(0);
  });
});
