# ADR-0009: Dnevnik, znanje, sesije i verzionirani izvoz

Status: prihvaćeno za Fazu 4a (28. 11. 2026., Issue #18). Vlasnik je zatražio nastavak na sljedeću fazu („nastavi dalje”) nakon spajanja Faze 3.

## Kontekst

Specifikacija §4, §9 i §10 traži dnevnik u tri sloja (nepromjenjivi događaji, uređive osobne bilješke, izvedeni sažeci), tvrdnje s vrstom znanja i vidljivošću, ispravke koje ne brišu povijest, filtriranje tajni na serveru te izvoz kao novu generaciju s manifestom i hashovima. Plan Faze 4 traži i da se projekcija može ponovno generirati te da prekinut izvoz ne ostavi navodno dovršen miješani skup datoteka.

## Odluka

1. **Događaji su izvor istine.** `JournalEntry`, `KnowledgeAssertion` i `Session` su projekcije događaja: pišu se u istoj `BEGIN IMMEDIATE` transakciji batcha (ADR-0006) i ne ulaze u mehaničko stanje lika ni u snapshot (format 2 ostaje isti). `verifyJournalProjections` ih ponovno izračunava iz događaja i uspoređuje sa spremljenima; provjera je dio `verifyReplay`.
2. **Nove naredbe** (sve kroz `executeBatch`):
   - `ReviseJournalNote`: nova revizija uz očekivanu staru (`revision_stale` inače). Smije autor bilješke ili vlasnik. Prethodni tekst ostaje u događajima `JournalNoteAppended` / `JournalNoteRevised`.
   - `RecordWorldFact`: subjekt (`npc`/`quest` iz registra, vidljiv autoru; `location`/`world`), tekst, `knowledgeKind` (observed, reported, rumor, inferred, canon), vidljivost i izvor. Kanon i DM tvrdnje upisuje samo vlasnik. Tvrdnja vidljiva igraču (player/shared), kao i javna zamjena, ne smije imati subjekt (NPC/quest) vidljiv samo DM-u: takav upis se odbija (`hidden_subject`), jer bi ID subjekta završio u događaju, dnevniku i izvozu.
   - `CorrectConfirmedFact` (samo vlasnik): novi događaj `FactCorrected` referencira izvorni događaj (`targetEventId`, `targetSeq`). Ako je izvor tvrdnja, ona postaje `superseded` (uz zamjensku tvrdnju, npr. glasina → kanon) ili `retracted`. Izvorni događaj i tekst tvrdnje se nikad ne mijenjaju (okidači u bazi). Ispravka ispravljene tvrdnje nije dopuštena; ispravlja se njezina zamjena.
   - `StartSession` / `EndSession` (samo vlasnik): najviše jedna otvorena sesija (djelomični unique indeks), zatvorena sesija je nepromjenjiva. Svaki događaj nosi `sessionId` sesije otvorene u tom trenutku.
3. **Vidljivost na serveru.** Read model (`getJournal`, `getKnowledge`) primjenjuje vidljivost u SQL-u prije filtara i pretrage, pa ni broj rezultata ni ID-jevi DM sadržaja ne dolaze do igrača ili promatrača. Ispravka vidljiva samo DM-u ne mijenja ono što igrač zna: za igrača tvrdnja ostaje aktivna, bez reference na skrivenu ispravku. Događaj ispravke je DM-only ako je izvor ili zamjena DM-only.
4. **Pretraga** je neosjetljiva na velika/mala slova i dijakritike (č, ć, š, ž, đ). Filtri: sesija, lik/NPC/subjekt (iz povezanih događaja), vrsta unosa i vrsta znanja.
5. **Izvoz** (`src/server/export/export.ts`, `npm run export`) samo čita bazu, u jednoj read transakciji. Generacija `generations/<vrijeme>-v<stateVersion>-<publika>/` sadrži `state.json`, `entities.json`, `events.jsonl`, `journal.json`, `knowledge.json`, `sessions.json`, `journal.md`, `handoff.md` i `manifest.json` (`stateVersion`, event cursor, broj događaja, veličina i SHA-256 svake datoteke, `generationSha256`). Postupak: pisanje u `.tmp-*` uz fsync → ponovno čitanje i provjera → atomsko premještanje generacije → atomska zamjena pointera `CURRENT.<publika>.json`. Prekid prije premještanja briše privremeni direktorij; pointer uvijek pokazuje na cjelovitu provjerenu generaciju. Player izvoz uvijek je filtriran kao za igrača (i kad ga pokreće vlasnik): bez DM događaja, tvrdnji, bilješki, NPC-eva i njihovih predmeta. DM izvoz smije samo vlasnik.

## Posljedice

- `ExportJob` tablica iz modela §6 nije uvedena: izvoz ne piše u bazu, a stanje izvoza je pointer na disku. HTTP endpoint `POST /api/campaigns/:id/exports` i sučelje dolaze u Fazi 4b.
- Legacy povijest (`LegacyEvent`, `SourceDocument`) još nije dio izvoza; dodaje se kad se odluči njezina klasifikacija vidljivosti (O3).
- AI sažeci (`kind = summary`) nisu dio Faze 4; provjera projekcija ih preskače.
