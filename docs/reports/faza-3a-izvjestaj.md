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
