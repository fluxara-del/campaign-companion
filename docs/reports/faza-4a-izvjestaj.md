# Izvještaj Faze 4a — dnevnik, znanje, sesije i izvoz (domena i server)

Datum: 28. 11. 2026. Pripremio: Claude Code. Issue #18 (Faza 4 = 4a domena/server/izvoz + 4b sučelje Dnevnika). Status: **čeka review i odobrenje vlasnika.** Bez UI-ja i HTTP ruta Dnevnika (4b). Deploy nije aktiviran; podaci kampanje nisu mijenjani (probni uvoz radi nad kopijom).

## Isporučeno

- **Aditivna migracija** `20261128090000_phase4_journal_knowledge`: `DomainEvent.sessionId` (NULL za starije događaje), tablice `Session` i `KnowledgeAssertion` s CHECK-ovima (statusi, vrste znanja, vidljivost, dosljednost otvorene/zatvorene sesije i statusa tvrdnje), djelomični unique indeks „najviše jedna otvorena sesija”, okidači (zatvorena sesija nepromjenjiva, tekst/vrsta/vidljivost tvrdnje nepromjenjivi, bez brisanja). Ništa se ne briše ni ne prepisuje.
- **Naredbe** (ADR-0009): `ReviseJournalNote`, `RecordWorldFact`, `CorrectConfirmedFact`, `StartSession`, `EndSession`; svi upisi kroz `executeBatch` (jedna transakcija, receipt, idempotentnost kao i dosad).
- **Projekcije** dnevnika, znanja i sesija iz događaja; `verifyJournalProjections` ih ponovno generira i uspoređuje (dio `verifyReplay`).
- **Read model** `getJournal` (filtri: sesija, lik/NPC/subjekt, vrsta unosa, vrsta znanja, pretraga, stranice) i `getKnowledge`; vidljivost u SQL-u prije filtara i pretrage.
- **Izvoz** `npm run export -- --campaign <id> --out <dir> [--audience player|dm]` i `--verify`: nova generacija s manifestom (`stateVersion`, event cursor, SHA-256 datoteka i cijele generacije), JSON + Markdown dnevnik + handoff, atomsko objavljivanje i pointer. `/exports/` je u `.gitignore`.

## Testovi iz plana

| Zahtjev plana | Test |
|---|---|
| Filtriranje tajni na serveru | `journal.test.ts` „igrač i promatrač ne vide DM tvrdnje, DM ispravke ni DM bilješke …” (cijeli odgovor, pretraga, filtar po skrivenom NPC-u, prazni rezultati); `export.test.ts` „player izvoz … bez DM sadržaja” (svaka datoteka) |
| Razlika glasine i kanona | „glasina ostaje glasina; ispravka u kanon …” (filtar `rumor`/`canon`, stara tvrdnja `superseded`, nova `canon`) |
| Referenciranje izvornog događaja | isti test: `FactCorrected.targetEventId/targetSeq`; „povlačenje tvrdnje i ispravka običnog događaja” |
| Ispravka bez brisanja povijesti | izvorni događaj i tekst tvrdnje nepromijenjeni (i okidač u bazi); revizije bilješke ostaju u događajima („autor mijenja svoju bilješku …”) |
| Ponovno generiranje projekcije | „projekcije iz događaja jednake su spremljenima; neovlaštena izmjena se otkriva” |
| Izvoz s verzijom i provjerenim hashovima | „player izvoz: manifest s verzijom, cursorom i hashovima …”, „izmijenjena, dodana ili uklonjena datoteka … otkriva se” |
| Prekid izvoza bez miješanog skupa | „prekid u koraku …” (pet koraka: nema nove generacije ni privremenih datoteka, pointer na prethodnoj) i „prekid prije pointera” |
| Gate: sesija s ručnim DM unosom bez AI-ja | `export.test.ts` igra kratku sesiju (šteta, bilješke, tvrdnje igrača i DM-a) samo ručnim naredbama i izvozi je; AI uloga ne smije upisivati znanje ni sesije |

Kontrolne provjere: bez filtra vidljivosti u `getJournal` i bez maskiranja DM ispravke u `getKnowledge` test privatnosti pada. Lokalno: unit 38, DB 178, e2e 32/32, migracije i shema bez odstupanja. Test nadogradnje (SR-02) sada primjenjuje sve migracije od `20261127170000` nadalje.

## Probni uvoz stvarne kampanje

`npm run import:trial -- --source "E:\DnD\Kronike-Devet-Zvona"`: 0 pogrešaka, 0 upozorenja; izvor samo čitan. Player izvoz te probne baze (u `import-sandbox/`) prošao je provjeru (`--verify`).

## Što ne dokazuje i otvoreno

- Sučelje Dnevnika, HTTP rute i `POST …/exports` (4b).
- Legacy povijest (`LegacyEvent`, `SourceDocument`) još nije u izvozu (vidljivost, O3).
- AI sažeci (`summary`) dolaze s Fazom 5.
- Pretraga je linearna nad vidljivim unosima (dovoljno za jednu kampanju); FTS po potrebi kasnije.

## Codex i supervisor na `ef0263e`

| Nalaz | Rješenje | Test |
|---|---|---|
| SUP-19-01 (Codex P2): kursor je bio samo `lastSeq`, pa je granica stranice između dva unosa istog zadnjeg događaja (bilješka i projekcija revizije) trajno preskakala drugi | Složeni kursor `{ lastSeq, id }` koji prati poredak prikaza (`lastSeq` silazno, `id` uzlazno); odgovor vraća `nextCursor` | „unosi istog zadnjeg događaja ne ispadaju na granici stranice (limit 1)” |
| SUP-19-02 (Codex P2): javna zamjena DM-only tvrdnje nosila je `sourceEventId` i `createdSeq` skrivenog događaja ispravke (igrač i player izvoz) | Za ulogu koja nije vlasnik: `sourceEventId`/`createdSeq` su `null` kad izvorni događaj nije vidljiv; `correctedByEventId`/`supersededById` se uklanjaju kad pokazuju na DM-only događaj ili tvrdnju. Vlasnik vidi puni trag. Bez promjene sheme | „SUP-19-02: javna zamjena DM-only tvrdnje …” (igrač i promatrač), „SUP-19-02: player izvoz …” (nijedna datoteka ne sadrži ID skrivenih događaja) |

Kontrolna provjera: bez ispravaka sva tri nova testa padaju.

## Supervisor na `6a5bfe2` (BLOCK)

| Nalaz | Rješenje | Test |
|---|---|---|
| SUP-19-03 (Codex P1): tvrdnja vidljiva igraču mogla je otkriti `subjectId` DM-only NPC-a ili questa — izravnim upisom vlasnika ili javnom zamjenom DM-only tvrdnje — u `getKnowledge`, `knowledge.json` i `journal.md` | `RecordWorldFact` i `CorrectConfirmedFact` odbijaju tvrdnju ili zamjenu vidljivu igraču (player/shared) čiji subjekt nije vidljiv igračima (isto pravilo kao za `EntityRecord`), s porukom vlasniku i `reason: hidden_subject`. DM tvrdnje i DM zamjene o skrivenom subjektu ostaju dopuštene. Bez promjene sheme | „SUP-19-03: tvrdnja vidljiva igraču ne smije otkriti skriveni subjekt …” (oba puta; igrač i promatrač bez ID-a i imena; DM vidi obje tvrdnje), „SUP-19-03: player izvoz ne sadrži ID skrivenog subjekta …” (`knowledge.json`, `journal.md`, `events.jsonl`, `journal.json`) |

Kontrolna provjera: bez provjere skrivenog subjekta oba nova testa padaju. Testovi SUP-19-02 sada koriste DM tvrdnju o javnom subjektu (svijet), jer javna zamjena tvrdnje o skrivenom NPC-u više nije moguća.
