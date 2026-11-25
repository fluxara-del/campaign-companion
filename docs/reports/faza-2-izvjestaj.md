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

## 6. Odgovor na preliminarni pregled `01323ba`: NTFS i TOCTOU

**NTFS junction (dokaz, ne samo poziv `symlinkSync`).** Pomoćna funkcija testova nakon stvaranja veze na Windowsu pokreće `dir /AL` i test pada ako redak ne prikazuje `<JUNCTION>`; `lstat` mora prijaviti vezu. Lokalni testovi rade na NTFS-u (C: i E:, provjereno `Get-Volume`). Dodan je CI job **„Uvoz na Windowsu (NTFS junction)”** (`windows-2025`) koji izvršava sve testove uvoza na NTFS-u; Linux job iste testove izvršava sa simboličkim vezama.

**TOCTOU (provjera putanje naspram čitanja).** Izvor se čita isključivo kroz `readVerified`: provjera svih komponenti → otvaranje datoteke (na POSIX-u `O_NOFOLLOW`) → `fstat` otvorenog opisnika → **ponovna** provjera svih komponenti → identitet (`dev` + `ino`) na putanji mora biti jednak otvorenoj datoteci → čitanje iz istog opisnika. Ako se išta promijeni, uvoz se blokira (`source_changed_before_read`) i ništa se ne kopira. Imena u direktoriju koriste se samo za popis; svaka datoteka prolazi vlastitu provjeru prije čitanja.

| Test | Rezultat |
|---|---|
| Direktorij `npcs` zamijenjen junctionom (prema datoteci s tajnim sadržajem) **između provjere i otvaranja** | blokirano, tajni sadržaj nigdje u generaciji |
| Ista zamjena **nakon otvaranja** | POSIX: blokirano ponovnom provjerom; Windows/NTFS: OS ne dopušta preimenovanje direktorija dok je datoteka otvorena (`EPERM`), pa uvoz čita izvornu datoteku |
| Kontrolna provjera: bez ponovne provjere i usporedbe identiteta | test „između provjere i otvaranja” pada |

**Preduvjet (dokumentiran).** Probni uvoz pokreće se dok se kampanja ne mijenja (npr. nije u tijeku spremanje iz ChatGPT Worka). Importer prvo izrađuje vlastitu kopiju (generacija u `import-sandbox/`, pod isključivom kontrolom importera, `flag: "wx"`), a mapiranje i probna baza čitaju isključivo tu kopiju; na kraju se izvor ponovno hashira prema manifestu (`source_changed_during_import`). Teoretski preostaje samo zamjena-pa-povratak unutar jednog čitanja, koju ni ponovna provjera identiteta ne može isključiti; ona ne može dovesti do čitanja `dm_private` jer i tada svaka komponenta mora proći provjeru. Ukupno lokalno: 97 testova.

## 7. Odgovor na pregled `b6d0a81` (BLOCK): završno hashiranje izvora

**Nalaz:** `verifySourcesUnchanged` je provjerio putanju pa je ponovno otvorio pozivom `readFileSync(putanja)`; promjena roditeljskog direktorija između te dvije operacije mogla je dovesti do čitanja sadržaja izvan izvora.

**Rješenje:** završna provjera koristi isti `readVerified` kao izrada kopije (provjera komponenti → otvaranje → `fstat` → ponovna provjera → isti `dev`/`ino` → čitanje iz opisnika). Nestanak datoteke, veza, promjena identiteta, neuspjelo otvaranje ili nedostupan korijen izvora daju `source_changed_during_import` i status `blocked`.

**Dokaz:** test „zamjena putanje tijekom završnog hashiranja” mijenja `npcs/` u junction prema datoteci s **identičnim bajtovima** kao original: kad bi provjera pročitala zamjensku datoteku, hash bi se poklopio i promjena se ne bi prijavila; prijava `source_changed_during_import` dokazuje da sadržaj nije pročitan. Varijanta nakon otvaranja: POSIX otkriva, NTFS odbija preimenovanje (`EPERM`). Dodatni test: nestanak datoteke tijekom provjere blokira uvoz. Kontrolna provjera: bez ponovne provjere i usporedbe identiteta padaju test izrade kopije i test završne provjere. Ukupno lokalno: 100 testova.

## 8. Codex P2 na `c653d55`: izričito nepoznata količina

**Nalaz:** `"quantity": null` u opremi lika blokirao je uvoz, iako je izostavljena količina i `null` kod vanjskih predmeta već značila „nepoznato”.

**Rješenje:** izostavljena ili `null` količina = nepoznato (`ItemInstance.quantity` NULL) za sve predmete; svaka druga vrijednost mora biti cijeli broj ≥ 0, inače `item_quantity` blokira uvoz (prije je kod vanjskih predmeta neispravna vrijednost tiho postajala `null`).

**Usput otkriveno testom:** decimalni broj bilo gdje u izvornim podacima (npr. `massLb: 3.5`) rušio je uvoz jer je kanonski hash dopuštao samo cijele brojeve. Kanonski JSON sada ima način `numbers: "any"` (konačni brojevi zapisani kao u RFC 8785) koji koristi samo uvoz; domena i dalje dopušta isključivo cijele brojeve. Hash sadržaja stvarne kampanje nije se promijenio (`d58c7541…`).

**Dokaz:** testovi „izričito null se čuva”, „tekst/negativna/decimalna količina blokira”, „decimalni brojevi u izvornim podacima ne ruše uvoz” i unit test za način `any`. Ukupno lokalno: 106 testova.

## 9. Pregled `58b2bf9`: spell slotovi s nepoznatim vrijednostima (Codex P2) i matrica količina (supervisor)

**Codex P2:** spell slot s `null` vrijednošću (npr. `{ "current": null, "max": 2 }`) bio je preskočen, a upozorenje je netočno tvrdilo da je sačuvan u profilu (profil ne sadrži `resources`). Sada se slot uvozi kao resurs s očuvanim `null` (domena tada vraća `needs_ruling` umjesto „ne postoji”), izostavljen `max` = nepoznato, a neispravna vrijednost (`"nula"`, negativna, decimalna) blokira uvoz kodom `resource_value` — isto pravilo vrijedi i za ostale resurse, koji su prije neispravnu vrijednost tiho pretvarali u `null`. Poruke za nemapirane oblike sada točno navode da izvor ostaje doslovno u `SourceDocument`.

**Supervisor (pokriće):** isti skup od 7 ulaza za količinu (izostavljena, `null`, 0, 3, tekst, negativna, decimalna) provjerava se za opremu **i** za predmete izvan inventara; prihvaćene vrijednosti čitaju se natrag iz SQLitea, a odbijene blokiraju uvoz s `item_quantity` na točnom izvoru.

Testirane kombinacije spell slota (čitano iz SQLitea): (null, 2), (1, null), (null, null), (0, 2), (0, null) i izostavljen max; `ConsumeResource` daje `needs_ruling` za nepoznat current, `rule_violation` za poznatu nulu i uspijeva za poznatu vrijednost > 0. Hash sadržaja stvarne kampanje nepromijenjen (`d58c7541…`). Ukupno lokalno: 127 testova.
