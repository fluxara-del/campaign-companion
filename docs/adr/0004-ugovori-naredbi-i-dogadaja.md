# ADR-0004: Tipizirani ugovori naredbi i događaja (nacrt)

Status: nacrt za Fazu 1 (dopunjeno 25. 11. 2026. prema supervisor nalazu SR-01: semantika batcha). Izvor: specifikacija §6–§8. Implementacija (zod sheme, Prisma model) dolazi u Fazi 1 nakon odobrenja; ovdje se fiksira oblik ugovora.

## Envelope batcha i naredbe

Jedinica idempotentnosti, konkurentnosti i atomarnosti je **batch**. Pojedinačna naredba uvijek se šalje kao batch s jednim članom; zaseban put za „samostalnu naredbu” ne postoji.

```ts
type CommandBatch = {
  schemaVersion: 1;
  batchId: string;              // UUID v7, generira klijent; JEDINI idempotentni ključ operacije
  campaignId: string;           // jedna kampanja za cijeli batch
  expectedStateVersion: number; // jedna očekivana verzija za cijeli batch; razlika → 409
  commands: BatchCommand[];     // 1..50 članova; REDOSLIJED JE ZNAČAJAN i dio je hasha
};
type BatchCommand<T extends CommandType = CommandType> = {
  commandId: string;             // UUID v7; jedinstven unutar batcha i trajno unutar kampanje
  type: T;
  intentRef: IntentRef;         // igračev odabir | potvrđeno bacanje | dopuštena DM posljedica
  payload: CommandPayload[T];   // stroga zod shema po tipu; nepoznata polja odbijena
};
type IntentRef =
  | { kind: "player_choice"; turnId?: string; messageId: string }
  | { kind: "roll_result"; rollId: string }
  | { kind: "dm_consequence"; turnId: string; ruleRef: string };
```

Članovi **nemaju** vlastiti `campaignId` ni `expectedStateVersion`; te vrijednosti postoje samo na razini batcha. `commandId` služi za referenciranje iz događaja i za zabranu ponovne uporabe člana, ne kao zaseban idempotentni ključ.

Actor i ovlasti **ne** dolaze iz envelopea: server ih određuje iz autentificirane sesije ili AI service actora (uži scope).

### Kanonski hash

`requestHash = SHA-256(JCS(x))`, gdje je JCS kanonska JSON serijalizacija (RFC 8785), a `x`:

```ts
{ schemaVersion, campaignId, expectedStateVersion,
  commands: commands.map(c => ({ commandId: c.commandId, type: c.type, intentRef: c.intentRef, payload: c.payload })) }
```

Hash se računa **nakon** zod validacije i normalizacije (uklonjena nepoznata polja odbijaju zahtjev prije hashiranja, pa nema „istog zahtjeva s dodatnim smećem”). Promjena redoslijeda članova, dodavanje, uklanjanje ili izmjena bilo kojeg polja daje drugi hash.

### Pohrana

| Tablica | Ključ | Sadržaj |
|---|---|---|
| `BatchReceipt` | unique `(campaignId, batchId)` | `requestHash`, actor, `stateVersionBefore`, `stateVersionAfter`, raspon `seq` događaja, serijalizirani odgovor za ponavljanje, `committedAt` |
| `CommandIndex` | unique `(campaignId, commandId)` | `batchId`, pozicija u batchu |

Receipt nastaje **samo** za potvrđen (commitan) batch. Odbijeni zahtjevi (409/422/403) ne upisuju ništa.

## Početni tipovi naredbi

`ApplyDamage`, `ApplyHealing`, `SetTemporaryHp`, `ConsumeResource`, `ResolveCast`, `TransferItem`, `SpendCurrency`, `ApplyCondition`, `EndConcentration`, `RecordRoll`, `CompleteRest`, `AppendJournalNote`, `RecordWorldFact`, `CorrectConfirmedFact`.

Pravila payloada: stabilni ID-jevi (nikad samo naziv), cijeli brojevi za HP i novac (najmanja jedinica), eksplicitan izvor troška (`resourcePoolId` ili `freeUseFeatureId`), `null` za nepoznato.

## Obrada (nepromjenjiv redoslijed)

1. **Izvan transakcije:** autentifikacija, scope kampanje, veličina, zod validacija batcha i svih članova, duplikat `commandId` unutar batcha → `422 duplicate_command_in_batch`. Izračun `requestHash`.
2. **Otvoriti write transakciju koja odmah drži SQLite write lock** (`BEGIN IMMEDIATE` ili dokazani ekvivalent). Sve iduće provjere čitaju stanje pod istim lockom.
3. Postoji `BatchReceipt (campaignId, batchId)`:
   - isti `requestHash` → vratiti spremljeni odgovor (`200`, `replayed: true`), bez ikakvog upisa i **bez** provjere trenutačne verzije (izgubljeni odgovor se može dohvatiti i nakon kasnijih promjena);
   - drugi hash → `409 batch_id_reused`, bez upisa.
4. Bilo koji `commandId` iz batcha već postoji u `CommandIndex` (pod drugim `batchId`) → `409 command_id_reused`, bez upisa. Time je zabranjeno miješanje stare i nove naredbe i ponavljanje člana u novom batchu.
5. `expectedStateVersion ≠ Campaign.stateVersion` → `409 stale_version` s trenutačnom verzijom, bez upisa.
6. Preduvjeti pravila redom kojim su članovi navedeni; svaki član vidi stanje nakon prethodnih. Neuspjeh bilo kojeg člana → rollback cijelog batcha, `422` s indeksom člana i razlogom.
7. Atomski upis: novi snapshot, svi događaji (`seq` raste po događaju), minimalni journal, `CommandIndex` za sve članove, `BatchReceipt` i **jedno** povećanje `stateVersion` (+1 po batchu). Commit.
8. Odgovor tek nakon commita. AI/HTTP pozivi nikad unutar transakcije.

Unique ograničenja na `BatchReceipt` i `CommandIndex` su posljednja zaštita: ako upis ipak naiđe na konflikt, transakcija se vraća, receipt se ponovno čita i primjenjuje se korak 3 ili 4.

### Ponašanje u rubnim slučajevima

| Slučaj | Ishod |
|---|---|
| Isti batch ponovljen nakon izgubljenog odgovora (timeout, prekid SSE/HTTP) | Spremljeni receipt; jedan commit, jedno povećanje verzije, jedan trošak |
| Isti `batchId`, promijenjen payload / redoslijed / broj članova | `409 batch_id_reused`, bez upisa |
| Novi `batchId`, ali sadrži već potvrđen `commandId` | `409 command_id_reused`, bez upisa |
| Isti `commandId` dvaput unutar batcha | `422 duplicate_command_in_batch`, bez upisa |
| Klijent nakon `409 stale_version` želi ponovno poslati namjeru | Nova procjena nad novim snapshotom, **novi** `batchId` i novi `commandId`-jevi |
| Dva paralelna identična zahtjeva | Write lock serijalizira; prvi commita, drugi čeka (`busy_timeout`, ograničen retry), zatim u koraku 3 dobiva isti receipt |
| Dva paralelna različita batcha s istom `expectedStateVersion` | Prvi commita; drugi dobiva `409 stale_version` |
| SQLite zauzet dulje od limita | `503 busy` bez upisa; klijent smije ponoviti **isti** batch (isti `batchId`) |
| Prekid procesa nakon commita, prije odgovora | Klijent šalje isti batch ili `GET …/batches/:batchId` → spremljeni receipt |

Odgovori: `200` receipt (`replayed` true/false); `409` `stale_version` | `batch_id_reused` | `command_id_reused`; `422` neispravno/nepodržano (`needs_ruling`, indeks člana); `403` bez ovlasti; `503` zauzeta baza.

HTTP (usklađeno sa specifikacijom §7): `POST /api/campaigns/:id/batches` za slanje i ponavljanje, `GET /api/campaigns/:id/batches/:batchId` za oporavak ishoda (spremljeni receipt ili `404` ako batch nije potvrđen; `404` nije dokaz konačnog neuspjeha dok je isti zahtjev možda u obradi, pa klijent tada ponavlja **isti** batch). Ruta po `commandId` ne postoji.

**Postupak klijenta:** (1) generira `batchId` i `commandId`-jeve; (2) šalje `POST …/batches`; (3) nakon timeouta ili prekida ponavlja isti nepromijenjeni batch ili čita `GET …/batches/:batchId`; (4) nakon `409 stale_version` gradi novi batch s novim ID-jevima nad novim snapshotom.

### Kriteriji prihvata u Fazi 1 (izvršivi testovi)

1. Isti batch poslan dvaput (sekvencijalno i paralelno, ≥ 10 istodobnih) → točno jedan `BatchReceipt`, jedno povećanje `stateVersion`, jedan trošak resursa, isti odgovor.
2. Isti `batchId` s izmijenjenim payloadom, obrnutim redoslijedom ili dodatnim članom → 409, stanje i broj događaja nepromijenjeni.
3. Novi batch s ranije potvrđenim `commandId` → 409 bez upisa.
4. Dva različita batcha s istom verzijom → jedan commit, jedan 409.
5. Pogreška u zadnjem članu batcha → nijedan događaj, receipt ni promjena snapshot-a.
6. Simulirani prekid nakon commita → ponovljeni zahtjev vraća receipt bez novog troška.
7. Test dokazuje da se verzija i receipt čitaju pod write lockom (ne samo pod read transakcijom). Ako Prisma interaktivna transakcija to ne omogućuje nad SQLite-om, write put koristi driver adapter/`better-sqlite3` izravno uz istu shemu — odluka i dokaz idu u PR Faze 1.

## Envelope događaja

```ts
type DomainEvent = {
  id: string; campaignId: string; seq: number;   // (campaignId, seq) unique, raste po događaju
  sessionId: string | null; batchId: string; commandId: string;
  type: EventType; schemaVersion: number; payload: unknown; // tipizirano po (type, schemaVersion)
  actor: { kind: "player" | "dm_manual" | "ai_service" | "import"; id: string };
  sourceRef: string | null;                       // npr. legacy ID "KDZ-S001-E013"
  occurredAt: string;                             // UTC ISO
  worldTime: NarethTime | null;                   // vrijeme svijeta, odvojeno
  visibility: "player" | "dm" | "shared";
  knowledgeKind: "observed" | "reported" | "rumor" | "inferred" | "canon" | null;
};
```

Događaji su nepromjenjivi. Ispravka = novi događaj s `correctsEventId`. Legacy događaji iz uvoza čuvaju izvorni payload i hash (`actor.kind = "import"`), bez izmišljenih mehaničkih delta.

## AI prijedlog

AI vraća `{ narrativeDraft, proposedCommands: BatchCommand[], openRequests: (RollRequest | RulingRequest | DecisionRequest)[] }`. Prijedlog se pretvara u `CommandBatch` s novim `batchId` i prolazi istu validaciju kao ručna naredba; nepotpun ili nevaljan JSON se ne izvršava. Auto-apply (Faza 6) samo za naredbe s valjanim `intentRef`, podržanim pravilom i točnom verzijom.
