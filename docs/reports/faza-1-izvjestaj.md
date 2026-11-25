# Izvještaj Faze 1 — podaci i povjerenje u zapis

Datum: 25. 11. 2026. Pripremio: Claude Code (Lead Developer). Issue #10. Status: **čeka Codex review, supervisor review i odobrenje vlasnika.** Faza 2 nije započeta; deploy nije aktiviran; postojeća kampanja nije čitana ni mijenjana u ovoj fazi.

## 1. Što je isporučeno

| Dio | Datoteke |
|---|---|
| Shema i migracija (11 tablica, složeni strani ključevi (uključujući veze dnevnika), CHECK, append-only triggeri) | `prisma/schema.prisma`, `prisma/migrations/20261125062322_phase1_domain_core/` |
| Ugovor batcha (zod), kanonski JSON + SHA-256 | `src/domain/commands.ts`, `src/domain/canonical.ts` |
| Pravila 6 sintetičkih naredbi, događaji s vrijednostima prije/poslije, reducer | `src/domain/rules.ts`, `events.ts`, `reducer.ts`, `journal.ts` |
| Pristup kampanji i ovlasti po ulozi | `src/domain/authz.ts` |
| Jedinstveni servis pisanja (`BEGIN IMMEDIATE`), receipt, oporavak po `batchId` | `src/server/store/batch-service.ts`, `connection.ts`, `state-repo.ts` |
| Baseline i replay provjera | `src/server/store/replay.ts`, `campaign-setup.ts` |
| Odluka o putu pisanja | `docs/adr/0006-put-pisanja-sqlite.md` |

Naredbe: `ApplyDamage`, `ApplyHealing`, `SetTemporaryHp`, `ConsumeResource`, `SpendCurrency`, `AppendJournalNote`. Ostale naredbe iz specifikacije dolaze s fazama koje ih trebaju.

**Namjerno izostavljeno:** HTTP rute za pisanje i čitanje (čekaju autentifikaciju, odluka O5 — bez nje bi rute bile neautentificirane), AI, UI, uvoz kampanje (Faza 2), SR-02..SR-04 (#7–#9).

## 2. Kriteriji prihvata (Issue #10) i dokazi

| Kriterij | Dokaz (test) | Status |
|---|---|---|
| ADR-0004 k1: isti batch dvaput → jedan commit/trošak | `batch-service` „sekvencijalno ponavljanje”, „nakon kasnijih promjena”; `concurrency` „12 istodobnih identičnih” | ✓ |
| k2: isti `batchId`, drugi sadržaj (iznos, redoslijed, dodatni član) → 409 bez upisa | `batch-service` k2 (3 slučaja) | ✓ |
| k3: ponovljen `commandId` → 409; duplikat u batchu → 422 | `batch-service` k3 | ✓ |
| k4: dva batcha s istom verzijom → jedan commit, jedan 409 | `batch-service` k4; `concurrency` „10 istodobnih različitih” | ✓ |
| k5: pogreška u zadnjem članu ili prije COMMIT-a → ništa upisano | `batch-service` k5 (2 testa) | ✓ |
| k6: prekid nakon commita → receipt bez novog troška; `GET` po `batchId` | `batch-service` k6 | ✓ |
| k7: provjere pod write lockom | `concurrency` + kontrolna provjera (s `deferred()` oba testa padaju) | ✓ |
| Zauzeta baza → 503 bez upisa; isti batch zatim jednom | `concurrency` „Zauzeta baza” | ✓ |
| Replay od baseline-a: isti hash i verzija; otkriva promjenu izvan servisa | `integrity-replay` „Replay” (2 testa) | ✓ |
| Baza odbija vezu među kampanjama i izmjenu povijesti | `integrity-replay` (strani ključevi, triggeri, CHECK) | ✓ |
| Svaka promjena ima događaj i receipt | `batch-service` „svaka potvrđena promjena…” | ✓ |
| Nepoznato ostaje `null`; 0/1 ostaje potrošeno | `batch-service` „Nepoznate vrijednosti” | ✓ |
| Restore vraća isto stanje i replay prolazi | `integrity-replay` „Restore sintetičke baze” | ✓ |
| CI zelen | GitHub Actions na PR-u | vidi PR |

Ukupno lokalno: 59 testova u 6 datoteka (unit + db), typecheck, lint (0 upozorenja), provjera migracija i drift sheme prolaze.

## 3. Što testovi NE dokazuju

- Ponašanje **HTTP sloja** (rute ne postoje), autentifikacija, CSRF, izolacija DM sadržaja u odgovorima.
- **D&D pravila izvan šest naredbi**: odmor, čarolije, koncentracija, uvjeti, death saves (šteta na 0 HP vraća `needs_ruling`), masivna šteta (bilježi se samo `excessDamage`).
- **Uvoz stvarne kampanje** i usporedba s legacy podacima (Faza 2).
- Zamjena aktivne baze uz prekid, zajednički lock s deployem (SR-03, #8) i checksum migracija (SR-02, #7).
- Performanse s velikim brojem događaja (replay je linearan; za MVP solo kampanje prihvatljivo).
- Stvarni višeprocesni rad: testirane su niti s odvojenim konekcijama u istom procesu (SQLite lock je na razini datoteke, pa je to reprezentativno, ali ne i dokaz za NFS/mrežne diskove, koji su ionako zabranjeni).

## 4. Odluke donesene u ovoj fazi (za potvrdu vlasnika)

1. **ADR-0006:** put pisanja kroz better-sqlite3 + `BEGIN IMMEDIATE`; Prisma za shemu/migracije.
2. **Privremeni HP (2024):** naredba traži izričit izbor `replace` ili `keep_current`; ne zbraja se.
3. **Šteta do 0 HP** se primjenjuje i bilježi višak; daljnja šteta na 0 HP traži DM odluku.
4. **AI service actor** u Fazi 1 ne troši novac i ne piše DM/zajedničke bilješke (revizija u Fazi 5).
5. **Nepostojeća i tuđa kampanja** daju isti `403` (bez otkrivanja postojanja).
6. **ID-jevi entiteta** dopuštaju legacy oblike (`PC-001`); ID-jevi batcha i naredbi su UUID.

## 5. Rizici

- Ručni SQL nad bazom zaobilazi pravila; ublaženo triggerima za povijest i replay provjerom za stanje, ali ne može se potpuno spriječiti na razini datoteke.
- CHECK i triggeri su ručno dodani u migraciju; buduće Prisma `RedefineTables` migracije te tablice moraju ih ponovno stvoriti (kontrolna točka za review migracija).
- Otvorene odluke O1–O5 i N3 i dalje stoje; Faza 2 (uvoz) treba barem potvrdu o načinu obrade `dm_private/` (O3).

## 6. Odgovor na preliminarni supervisor pregled (25. 11. 2026., head `7da51a8`)

| Nalaz | Rješenje | Dokaz |
|---|---|---|
| Visoka: `JournalEventLink` dopušta vezu zapisa i događaja iz različitih kampanja | `JournalEventLink` dobiva `campaignId` i složene strane ključeve `(campaignId, journalEntryId)` → `JournalEntry(campaignId, id)` i `(campaignId, eventId)` → `DomainEvent(campaignId, id)`. Dodatno: `JournalEntry.batchId` ima složeni FK na `BatchReceipt`, a `id/campaignId/batchId` zapisa dnevnika su nepromjenjivi (trigger). Migracija Faze 1 (nespojena) je ponovno generirana kao `20261125062322_phase1_domain_core`. | `integrity-replay`: „veza dnevnika i događaja mora ostati unutar jedne kampanje” (A↔B odbijeno u oba smjera, A↔A prihvaćeno) |
| Važno: `getBatchReceipt` vraća metapodatke tuđeg batcha svakom članu | Pravilo: potvrdu batcha vidi samo **autor** batcha ili **vlasnik** kampanje; isto vrijedi za ponavljanje batcha. Ostali članovi dobivaju `not_found` (GET; isto kao nepostojeći batch) odnosno `batch_id_reused`/`forbidden` (ponavljanje), bez ID-jeva događaja i bilješki. | `batch-service`: „Pristup potvrdi batcha” (autor nakon timeouta, vlasnik, drugi igrač, viewer, ai_service) |
| Važno: `verifyReplay` čita u više odvojenih upita | Cijela provjera teče u jednoj read transakciji (jedna WAL snimka). | `integrity-replay`: „valjan commit drugog pisca tijekom provjere ne izaziva lažno odstupanje”; postojeći test „otkriva promjenu stanja izvan domenskog servisa” i dalje prolazi |

**Kontrolne provjere osjetljivosti testova** (izvršene lokalno, zatim vraćeno): kad se provjera izvodi bez zajedničke transakcije, novi replay test pada; kad pravilo pristupa propušta sve, padaju sva tri testa pristupa. Ukupno lokalno: 65 testova.
