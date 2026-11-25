# Izvještaj Faze 2 — uvoz postojeće kampanje (probni, na kopiji)

Datum: 25. 11. 2026. Pripremio: Claude Code (Lead Developer). Issue #13. Status: **čeka Codex review, supervisor review i odobrenje vlasnika.** Uvoz **nije prihvaćen**: stare datoteke u `E:\DnD\Kronike-Devet-Zvona` ostaju autoritet; nema cutovera, deploy nije aktiviran.

## 1. Što je isporučeno

| Dio | Datoteke |
|---|---|
| Aditivna migracija: `ImportBatch`, `LegacyEvent`, `ItemInstance`, `CharacterProfile`, `EntityRecord`, `SourceDocument` (složeni FK na kampanju, CHECK, append-only triggeri za uvezene izvore) | `prisma/migrations/20261125150338_phase2_import/` |
| Kopija dopuštenih izvora s manifestom SHA-256 i provjerom kopije; `dm_private/` se ne otvara | `src/server/import/source-snapshot.ts` |
| Mapiranje (čisto, bez izmišljanja vrijednosti) | `src/server/import/mapper.ts` |
| Provjere dosljednosti (Markdown ↔ strukturirano, reference, verzije, handoff, spremnici) | `src/server/import/checks.ts` |
| Upis u probnu bazu u jednoj transakciji + baseline | `src/server/import/writer.ts`, `campaign-setup.ts` (`extra`) |
| Orkestracija, izvještaj (JSON + Markdown), CLI | `src/server/import/run.ts`, `report.ts`, `scripts/import/trial-import.ts` (`npm run import:trial`) |

### Pravila mapiranja

| Izvor | Odredište | Napomena |
|---|---|---|
| `character.hp/maxHp/temporaryHp` | `Character` | Nepoznat HP ili nenaveden privremeni HP **blokira** uvoz (ne pretpostavlja se 0). |
| `resources.*` | `ResourcePool` (`<PC>:<ključ>`) | `null` ostaje nepoznato; obnova samo ako je izvor navodi (inače nepoznato do Faze 3). |
| `currency` / `groupFunds` | `Wallet` osobni / `group_dedicated` | Odvojeni računi; zbroj se provjerava prema `personalAndGroupFundsTotalGp`. |
| `equipment[i]` | `ItemInstance` (`<PC>:item:NNN`) | Držatelj = lik; vlasnik samo ako je naveden; spremnik po jednoznačnom imenu. |
| `externalItems[i]` | `ItemInstance` (`<kampanja>:external-item:NNN`) | Vlasnik/držatelj/lokacija prema izvoru; količina `null` ako nije navedena. |
| ostala polja lika | `CharacterProfile` | Doslovno sačuvano do Faze 3. |
| `events.jsonl` | `LegacyEvent` | Doslovni redak + SHA-256 + broj retka; **bez** domenskih događaja i izmišljenih delta. |
| `npcs`, `quests`, `relationships` | `EntityRecord` | Legacy ID-jevi; odnosi dobivaju prirodni ključ `REL:<from>-><to>`. |
| svaka izvorna datoteka | `SourceDocument` | Doslovni sadržaj i hash (čuva i nemapirane dijelove, npr. `idReconciliation`). |

## 2. Probni uvoz stvarne kampanje (lokalno, izvan Gita)

Izvršeno 25. 11. 2026. u `import-sandbox/2026-11-25T15-52-50-152Z/` (u `.gitignore`), nakon ispravaka iz §5.

| Provjera | Rezultat |
|---|---|
| Status | probna baza izrađena i provjerena; 0 pogrešaka, 0 upozorenja, 16 info nalaza |
| Replay od baseline-a / povratno čitanje / `integrity_check` | prolazi / jednako planu / ok |
| Determinizam | ponovljene probe daju isti hash sadržaja i isti baseline (`29bc0474…`); hash sadržaja nakon ispravka BOM-a je `d58c7541…` |
| Izvor netaknut | SHA-256 svih 42 datoteka izvan `dm_private/` jednak prije i poslije |
| `dm_private/` | nije čitan, kopiran ni uvezen (samo ime u popisu isključenih) |

Ključne vrijednosti (regresijski slučajevi iz plana): `PC-001` HP 22/22, privremeni 0; spell slots 1. kruga **0/2**; besplatni Divine Smite **0/1** (obnova `long_rest`); Lay on Hands 10/10; Hit Dice d10 2/2; Heroic Inspiration **nepoznat**; osobni novac **21 GP** i namjenski fond **5 GP** u odvojenim novčanicima (zbroj 26 GP odgovara izvoru); legacy verzija 2, posljednji događaj `KDZ-S001-E013`; potvrđen dugi odmor ne postoji i nije stvoren nikakav događaj odmora. Markdown tablice resursa slažu se sa strukturiranim poljima. Opseg: 30 predmeta (20 bez navedenog vlasnika: držatelj lik, vlasnik nepoznat), 25 legacy događaja, 27 zapisa registara, 9 izvornih dokumenata.

Puni izvještaj (sadrži podatke kampanje, zato nije u repozitoriju) predan je vlasniku zasebno.

## 3. Testovi (sintetički uzorak `tests/fixtures/kampanja-uzorak`)

13 novih testova u `tests/db/import.test.ts`; ukupno 89. Dokazuju: probna baza bez pogrešaka i s prolaznim replayem; izvor (uključujući `dm_private` i `backups`) nepromijenjen; tajni sadržaj iz `dm_private` nije u bazi ni izvještaju; regresijske vrijednosti; legacy redci doslovni s hashom; vlasništvo/držanje/lokacija/spremnik; prirodni ključ odnosa i doslovno čuvanje datoteka; namjerni nesklad Markdowna (`2/2` naspram `0/2`) prijavljen bez promjene vrijednosti; determinizam; rad domenskog servisa nad uvezenim stanjem; odbacivanje generacije; blokiranje kod neispravnog JSON-a, nenavedenog privremenog HP-a i pogrešnog `lastEventId`; odbijanje sandboxa unutar izvora.

**Ne dokazuje:** ispravnost klasifikacije znanja i vidljivosti registara (svi uvezeni kao vidljivi igraču, Faza 4); mapiranje čarolija/osobina u model pravila (Faza 3); predmete u kanonskom snapshotu za replay (dolaze s naredbama predmeta); stvarni prelazak na novu bazu (nije dio ove faze).

## 4. Odluke za potvrdu vlasnika

1. `dm_private/` se ne uvozi dok ne odlučiš O3 (DM tajne u AI kontekstu / zasebnoj pohrani).
2. Registri NPC-eva i zadataka uvoze se kao vidljivi igraču.
3. Predmeti bez navedenog vlasnika: držatelj je lik, vlasnik nepoznat.
4. Obnova resursa koju izvor ne navodi ostaje nepoznata (ne izvodi se iz pravila klase) do Faze 3.
5. Akter vlasnika u probnoj bazi je `owner` (stvarna autentifikacija čeka O5).
6. Prihvaćanje uvoza i prelazak na bazu je zasebna, izričita odluka nakon Faze 7 (plan): do tada se proba može ponavljati nad svježom kopijom.

## 5. Odgovor na supervisor pregled (BLOCK na `9a24897`) i Codex nalaze

| Nalaz | Rješenje | Dokaz (test) |
|---|---|---|
| Visoka: importer slijedi vezu na nadređenom direktoriju (privatni DM sadržaj može ući u kopiju) | `resolveInsideSource` provjerava **svaku** komponentu putanje od stvarnog korijena izvora (`lstat`: symlink/junction odbijen) i potvrđuje da je `realpath` točno očekivana putanja unutar izvora. Direktorij se ne popisuje i datoteka se ne čita dok provjera ne prođe; ako ijedna putanja padne, ništa se ne kopira i uvoz je blokiran (`source_link_rejected`). Bajtovi se čitaju jednom, iz provjerene putanje. | „Markdown direktorij preusmjeren na dm_private” i „JSON direktorij preusmjeren izvan izvora” (Windows junction): blokirano, manifest prazan, tajni sadržaj nigdje u generaciji, izvor nepromijenjen |
| Visoka: provjera izlaza uspoređuje tekst prije `mkdirSync` | `assertOutputOutsideSource` prije prvog upisa razrješava stvarnu lokaciju izvora i **najbližeg postojećeg roditelja** izlaza (`realpath`) i odbija izlaz unutar izvora (i obrnuto); nakon stvaranja direktorija provjera se ponavlja. Kopija se piše s `flag: "wx"`. | „Izlaz preko veze” za `link`, `link/sandbox`, `link/a/b`: odbijeno; popis direktorija, datoteka i njihovih hashova jednak prije i poslije |
| Srednja: `SourceDocument` sprema sadržaj bez BOM-a, a hash izvornih bajtova | BOM se uklanja samo za parsiranje JSON-a; dokument se sprema doslovno. Ako sadržaj nije valjan UTF-8 (pa se ne može doslovno sačuvati kao tekst), uvoz se blokira (`document_not_utf8`). | „Doslovno čuvanje dokumenata (BOM)”: SHA-256 sadržaja pročitanog iz SQLitea jednak manifestu za Markdown s BOM-om, bez njega i za JSON s BOM-om |

Kontrolne provjere osjetljivosti (lokalno, zatim vraćeno): uklanjanjem provjere komponenti padaju oba testa veza; tekstualnom provjerom izlaza padaju sva tri testa izlaza; uklanjanjem BOM-a iz sadržaja pada test BOM-a. Ukupno lokalno: 95 testova.
