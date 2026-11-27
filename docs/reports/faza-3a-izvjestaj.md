# Izvještaj Faze 3a — domena i model lika

Datum: 25. 11. 2026. Pripremio: Claude Code. Issue #15 (Faza 3 = 3a domena + 3b sučelje). Status: **čeka review i odobrenje vlasnika.** Bez UI-ja i HTTP ruta (3b). Deploy nije aktiviran; podaci kampanje nisu mijenjani.

## Isporučeno

- Aditivna migracija `phase3_character_sheet`: stupci lika (razina, brzina, AC, atribut čaranja, šest atributa, proficiency saveova i vještina), `StatModifier`, `SpellSelection`, `FeatureInstance`, `ActiveCondition`, `Concentration`, `RollRequest`; CHECK-ovi i triggeri (identitet, riješen zahtjev nepromjenjiv, resurs značajke i koncentracija moraju pripadati istom liku). Triggeri i CHECK-ovi Faze 1 sačuvani (provjereno).
- 12 novih naredbi (ADR-0007), događaji s vrijednostima prije/poslije, reducer koji provjerava „prije”, pregled odmora s hashom, izvedene vrijednosti s izvorima, read model `getCharacterSheet` (jedna read transakcija, bez DM sadržaja).
- Uvoz: atributi, razina, AC, brzina, proficiency (izvedena iz zbrojeva ili override), inicijativa kao bonus, atribut čaranja, čarolije (bez razine), značajke, uvjeti.

## Scenariji iz plana — pokriveni na razini domene

| Scenarij | Test (`tests/db/sheet.test.ts`) |
|---|---|
| Promjena ability score-a s preračunom | „promjena atributa preračunava …” (CHA 14→16: save, DC, Persuasion) |
| Šteta kroz temp HP; liječenje s granicom | postojeći testovi Faze 1 + koncentracija s temp HP-om |
| Nevaljani unos | „nevaljan unos se odbija …” |
| Potrošnja zadnjeg resursa | postojeći + „odbija … prazan resurs” |
| Oprema iz spremnika; transfer predmeta | „oprema iz spremnika”, „transfer spremnika NPC-u …” |
| Priprema čarolije; cast s odabranim troškom | „priprema čarolije …”, „cast s odabranim slotom …”, „odbija …” |
| Concentration save zahtjev | „šteta tijekom koncentracije otvara zahtjev …”, „pad na 0 HP …” |
| Pregled i potvrda odmora | „dugi odmor …”, „zastarjeli pregled …” |
| Ulazak u karticu ne mutira | „čitanje sheeta ne mijenja stanje ni verziju” |
| Replay cijele sesije | „uvjeti … cijela sesija prolazi replay” |

Ukupno 144 testa. Probni uvoz stvarne kampanje: 0 pogrešaka, 0 upozorenja; saveovi WIS/CHA, pet vještina s proficiencyjem, inicijativa +2 kao bonus, CHA kao atribut čaranja (iz DC-a 12), četiri čarolije bez razine — sve u skladu sa zapisom lika.

## Što ne dokazuje (3b i kasnije)

Desktop/390 px/tipkovnica, vidljivo stanje spremanja i konflikti u sučelju (3b, Playwright); HTTP sloj i autentifikacija (O5); katalog čarolija/predmeta (O1).

## Codex pregled `b3fb208`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: `getCharacterSheet` vraća DM-only NPC-eve u `holders` svakom članu | Vidljivost registra po ulozi (`visibilityClause`): vlasnik vidi sve, ostali samo `player`/`shared`; isto pravilo za dopuštene držatelje u `TransferItem` (igrač ne može ciljati ni otkriti DM-only NPC-a) | „P1: NPC vidljiv samo DM-u …” |
| P2: stari concentration save može prekinuti novu koncentraciju | `Concentration.instanceId`, `RollRequest.concentrationInstanceId`; završetak koncentracije poništava njezine otvorene zahtjeve (`cancelled`), a rezultat djeluje samo na instancu koja ga je otvorila | tri testa „P2 …” (druga čarolija, ponovno bacanje iste, dva zahtjeva) |

Migracija Faze 3 (nespojena) ponovno je generirana s novim stupcima i CHECK-ovima (`status ∈ pending/resolved/cancelled`, `total` samo kod riješenih, concentration save mora imati instancu). Ukupno 151 test.

## Codex pregled `0682a58`

| Nalaz | Rješenje | Test |
|---|---|---|
| P2: uz nepoznatu razinu zabilježeni saveovi i vještine se gube (sheet prikazuje drugi broj) | Kad zbroj postoji, a proficiency se ne može izvesti, zbroj se čuva kao override s razlogom | „Uvezeni zbrojevi ostaju jednaki zabilježenima”: nepoznata razina |
| P2: override proficiency bonusa nije korišten pri izvođenju | Efektivni PB = zabilježeni (ako postoji) ili po razini; isti se koristi za saveove, vještine i atribut čaranja; razlika ili nepoznata razina → override bonusa | isti test: bonus 3 uz razinu 2; nepoznata razina uz bonus 2 |

Test uspoređuje sve zabilježene saveove, vještine, spell DC i napad s vrijednostima koje sheet izračuna nakon uvoza. Kontrolna provjera: sa starim mapiranjem padaju tri varijante. Ukupno 155 testova.

## Codex pregled `31fc1ab`

| Nalaz | Rješenje | Test |
|---|---|---|
| P2: bez razine i proficiency bonusa (ili bez DC-a) gube se zabilježeni spell DC i napad | Kad se atribut čaranja ne može izvesti, svaki zabilježeni zbroj (DC, napad) čuva se kao override s razlogom; nalaz `spellcasting_unknown` | „Uvezeni zbrojevi …”: nepoznata razina bez bonusa; napad bez DC-a |

## Codex i supervisor na `20e7c6a`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: transfer DM-only NPC-u stvara `ItemMoved` vidljiv igračima, a dnevnik projekcije (uvijek `player`) otkriva ID NPC-a | Vidljivost transfera određuje se prema polaznom i odredišnom držatelju: ako je bilo koji DM-only NPC, događaj i događaji sadržaja spremnika imaju `dm`. Projekcija dnevnika dijeli se po vidljivosti, pa javni dio istog batcha ostaje vidljiv. Za ulogu koja ne vidi NPC-a predmet ili spremnik kod njega ponaša se kao nepostojeći. | „P1 (20e7c6a): transfer od i prema DM-only NPC-u …”: oba smjera, sadržaj spremnika, igrač i promatrač bez ID-a i imena, vlasnik puni trag, javni transfer vidljiv, replay |
| P2 (dopuna): samo zapisan DC | Ponašanje iz `20e7c6a` | „Pojedinačno zabilježen spell DC ili napad”: samo DC, samo napad (sa i bez poznatog bonusa); sačuvana vrijednost je override s razlogom, drugi zbroj ostaje nepoznat |

## Codex i supervisor na `4649fbd`

| Nalaz | Rješenje | Test |
|---|---|---|
| P2: `SetEquipped` zaobilazi provjeru skrivenog držatelja (igrač može promijeniti `equipped: null` → `false` i objaviti naziv predmeta) | Ista provjera kao u `TransferItem`: za ulogu koja ne vidi NPC-a predmet kod njega je „nepostojeći”; vlasnikova promjena takvog predmeta ima vidljivost `dm` | „P2 (4649fbd): SetEquipped …”: isti odgovor kao za nepostojeći predmet, bez promjene stanja, verzije, događaja i dnevnika; vlasnikova promjena samo u DM zapisu; replay |
| P2: zabilježena inicijativa gubi se kad DEX nije poznat | Zbroj se čuva kao override s razlogom i izvorom | „Zabilježena inicijativa uz nepoznat DEX”: `DEX: null` i izostavljen DEX → 2 |
| SR-01: idempotencija batcha s javnim i DM zapisom | Bez promjene koda | „SR-01: ponovljeni batch …”: isti odgovor i ID-jevi, bez novih događaja, zapisa, poveznica i verzije |

## Codex i supervisor na `dd09670`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: `inventory[].ownerRef` u sheetu otkriva ID DM-only NPC-a kada lik nosi njegov predmet | Read model za ulogu koja nije vlasnik vraća `ownerRef: null` kad je vlasnik DM-only NPC; vlasništvo u bazi se ne mijenja | „P1 (dd09670): inventar …”: izravno nošen predmet i predmet u spremniku; cijeli odgovor za igrača i promatrača bez ID-a i imena; DM vidi vlasnika; vidljive reference (lik, vidljivi NPC) ostaju; čitanje ne mijenja bazu. Kontrolna provjera: bez ispravka test pada |

## Codex i supervisor na `5513d9a`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: `savingThrows.CHA: null` ili `skills.Persuasion: null` uvozi se kao „bez proficiencyja” pa sheet prikazuje +2 | Polje prisutno u izvoru bez cijelog broja bilježi se kao izričito nepoznato (`Character.unknownTotalsJson`, nalaz `total_unknown`); izračun za taj cilj daje nepoznato (ručni override i dalje moguć). Nova nedestruktivna migracija `20261127170000_character_unknown_totals` (samo `ADD COLUMN` s defaultom `[]`). Baseline formata 2 bez novog polja čita se kao `[]` | „Izričito nepoznat zbroj …”: oba polja nepoznata nakon ponovnog učitavanja; kontrole: nenavedena vještina daje modifikator, poznati zbrojevi sačuvani. „baseline formata 2 bez polja unknownTotals …”: replay prolazi. Oba testa padaju bez ispravka |

## Codex i supervisor na `e0454d0` / `b174d24`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: predmet DM-only NPC-a unutar vidljivog spremnika prikazuje se igraču s `holderRef` NPC-a | Read model za ulogu koja nije vlasnik izostavlja predmet skrivenog držatelja na svakoj razini stabla. Uvoz ne postavlja vezu predmeta na spremnik drugog držatelja (`container_holder_mismatch`, izvor sačuvan doslovno) | „P1 (e0454d0): predmet skrivenog NPC-a unutar vidljivog spremnika …”: igrač i promatrač bez skrivenog predmeta i ID-a, vidljivi sadržaj spremnika ostaje, DM vidi sve; uvoz: „predmet s drugim držateljem od spremnika …” |
| P2: `Bless` i `bless` daju isti primarni ključ i ruše uvoz | Čarolije se spajaju po normaliziranom nazivu (oznake pripremljenosti se zbrajaju, `spell_name_merged`); značajke se ne spajaju nagađanjem nego dobivaju jedinstven stabilan ID (`-2`, `feature_id_collision`); isto pravilo štiti čarolije s istim ključem a različitim nazivom | „„Bless” i „bless” …”: jedna pripremljena čarolija, izvještaj zapisan; „dvije značajke s istim ključem …” |

Kontrolna provjera: sva četiri nova testa padaju bez ispravka.

## Codex i supervisor na `b2f9300`

| Nalaz | Rješenje | Test |
|---|---|---|
| P2: normalizacija naziva čarolija koristila je `/s+/g` (slovo s) umjesto `/\s+/g` (razmak), pa `Bless`/`BLESS` daju dva zapisa | Ispravljen izraz | „Bless / BLESS …” i „višerječni naziv s višestrukim razmacima (alwaysPrepared) …”: jedan zapis nakon uvoza i ponovnog čitanja, oznake sačuvane; bez ispravka padaju |

## Codex i supervisor na `5f1f6ce` / `a47484e`

| Nalaz | Rješenje | Test |
|---|---|---|
| P2: `uniqueIds` broji ponavljanja osnovnog ključa, ali ne pamti dodijeljene ID-jeve (`Bless!`, `Bless?`, `Bless-2` → dvaput `bless-2`, uvoz pada na primarnom ključu) | Vodi se skup svih dodijeljenih konačnih ID-jeva; svaki kandidat (i osnovni ID) provjerava se prije dodjele | čarolije i značajke, redoslijedi `Bless!, Bless?, Bless-2` i `Bless-2, Bless!, Bless?`: tri zapisa s različitim ID-jevima nakon ponovnog čitanja, izvještaj zapisan; bez ispravka padaju |

## Supervisor na `f353b8c`

| Nalaz | Rješenje | Test |
|---|---|---|
| P1: premještanje vidljivog spremnika koji (u nedosljednom starom zapisu) sadrži predmet DM-only NPC-a mijenja držatelja tog predmeta i objavljuje njegovo ime u dnevniku igrača | `TransferItem` provjerava cijelo stablo prije promjene: uloga koja ne vidi NPC-a dobiva atomsko odbijanje s neutralnom porukom („Premještanje ovog predmeta nije moguće.”, bez naziva i ID-ja sadržaja). Za vlasnika se vidljivost određuje za svaki predmet sadržaja prema njegovu starom i novom držatelju | prošireni „P1 (e0454d0) …”: igračev `executeBatch` odbijen, držatelji, verzija, događaji i dnevnik nepromijenjeni, pogreška bez skrivenog naziva/ID-ja; običan ugniježđeni sadržaj i dalje putuje; vlasnikov prijenos: pomak skrivenog predmeta samo `dm`. Bez ispravka test pada |

Semantika SR-01 je nepromijenjena: ovlasti i potvrda batcha provjeravaju se prije pravila, pa odbijanje ne stvara potvrdu ni događaje.

## SR-02: zamijenjena razvojna migracija Faze 3

Migracija `20261125214816_phase3_character_sheet` (b3fb208) zamijenjena je s `20261125221334_phase3_character_sheet` (0682a58) prije spajanja. Provjera svih lokalnih baza (samo čitanje `_prisma_migrations`, 27. 11. 2026.):

- produkcijska baza ne postoji (deploy nikad nije pokrenut);
- `data/dev.db` (sintetički demo) ima novu migraciju;
- jedina baza sa starom migracijom je jednokratni probni uvoz `import-sandbox/2026-11-25T22-02-06-069Z/trial.db`. Probni uvoz se svaki put gradi iznova iz nepromijenjenog izvora, pa nema povijesti koju treba sačuvati; tu generaciju ne treba nadograđivati nego je zanemariti ili obrisati.

Zato nadogradnja sa stare na novu migraciju nije potrebna. Napomena za buduće faze: jednom spojena migracija se ne mijenja; ispravak ide novom migracijom.

## SR-02: migracija `20261127170000_character_unknown_totals` i postojeći likovi

- **Nadogradnja:** migracija samo dodaje stupac `unknownTotalsJson` s defaultom `[]`; ništa ne briše ni ne prepisuje. Test „SR-02: nadogradnja baze prethodne verzije” gradi sintetičku bazu sa svim prethodnim migracijama (bez novog stupca), puni je likovima, događajima i baselineom kakav je zapisivao stari kod (snapshot bez polja `unknownTotals`), izvodi SQL nove migracije i provjerava: svi stupci likova nepromijenjeni, novi stupac `[]`, događaji, baseline i verzije kampanja identični, `integrity_check` i `foreign_key_check` čisti, replay obiju kampanja prolazi, izračun lista jednak kao prije, novi batch radi.
- **Ograničenje:** podatak o tome koji je zbroj u izvoru bio izričito nepoznat ne postoji u bazi uvezenoj prije ove migracije i nadogradnja ga ne može obnoviti (`[]` znači „nema zabilježenih nepoznatih”).
- **Uvjet i postupak:** do sada su postojali samo jednokratni probni uvozi u `import-sandbox/`; produkcijska baza ni produkcijski uvoz ne postoje. Izvorne datoteke kampanje ostaju autoritativne, pa se ispravak za ranije uvezene likove dobiva **ponovnim probnim uvozom iz izvora u novu generaciju** (`npm run import:trial -- --source …`), a ne prepravljanjem stare baze. Test „Postupak za ranije uvezene likove” potvrđuje da nova generacija dobiva oznake nepoznatog, a prethodna generacija i izvor ostaju bajt-za-bajt nepromijenjeni. Prije budućeg produkcijskog uvoza ovaj uvjet vrijedi i dalje: uvoz uvijek iz izvora, nikad iz starije probne baze.
