# ADR-0006: Put pisanja domene kroz better-sqlite3 (`BEGIN IMMEDIATE`)

Status: prihvaćeno u Fazi 1 (prijedlog; potvrđuje vlasnik uz PR Faze 1).

## Kontekst

ADR-0004 (kriterij 7) traži da se receipt, indeks naredbi i verzija kampanje čitaju **pod write lockom**, a ne u odgođenoj (deferred) transakciji. SQLite dopušta jednog pisca; `BEGIN` (deferred) uzima write lock tek pri prvom pisanju, pa bi dvije konekcije mogle pročitati istu verziju i obje proći provjere. Prisma interaktivne transakcije nad SQLite-om otvaraju se kao deferred i ne nude izbor `IMMEDIATE`.

## Odluka

- **Prisma posjeduje shemu i migracije** (`prisma/schema.prisma`, `prisma migrate deploy`). Prisma Client ostaje dostupan za read-only upite u kasnijim fazama.
- **Svi potvrđeni upisi stanja kampanje idu isključivo kroz `src/server/store/batch-service.ts`**, koji koristi `better-sqlite3` (isti driver koji koristi Prisma adapter) i `db.transaction(...).immediate()`. Cijela obrada batcha (pristup, receipt, indeks naredbi, verzija, pravila, upis) teče pod istim write lockom.
- Konekcija: `journal_mode=WAL`, `foreign_keys=ON` (provjereno pri otvaranju; inače odbija rad), `synchronous=FULL`, ograničen `busy_timeout`. Istek čekanja na lock → `503 busy`, bez upisa; klijent ponavlja **isti** batch.
- Baza dodatno štiti invarijante: složeni strani ključevi `(campaignId, id)`, CHECK ograničenja (nenegativni HP i resursi, `current ≤ max`, dopuštene vrijednosti), triggeri koji zabranjuju `UPDATE`/`DELETE` nad `DomainEvent`, `BatchReceipt`, `CommandIndex`, `JournalEventLink` i `CampaignBaseline`, nepromjenjiv identitet entiteta i monotona verzija kampanje. Prisma ih ne modelira, pa su dodani ručno u migraciju `20261125001723_phase1_domain_core`; `prisma migrate diff` ih ne prijavljuje kao odstupanje.
- Vremena su ISO 8601 UTC tekst (`String` u shemi), kako bi zapis iz oba sloja bio jednak.

## Dokaz

`tests/db/concurrency.test.ts`: 12 istodobnih identičnih batcheva iz zasebnih konekcija (worker niti) → točno jedan commit; 10 različitih batcheva s istom verzijom → jedan commit i devet `stale_version`. **Kontrolna provjera:** kad se `immediate()` privremeno zamijeni s `deferred()`, oba testa padaju (izvršeno lokalno 25. 11. 2026.), dakle testovi stvarno mjere zaključavanje.

## Posljedice

- Ručni SQL nad produkcijskom bazom izvan ovog servisa je zabranjen (CLAUDE.md, AGENTS.md); replay provjera (`verifyReplay`) otkriva takve promjene.
- Read putovi (snapshot, journal) u kasnijim fazama mogu koristiti Prisma Client ili isti driver, ali ne smiju pisati.
- Ako se kasnije pređe na drugu bazu, ovaj ADR se zamjenjuje.
