# Izvještaj Faze 3b — sučelje character sheeta

Datum: 25. 11. 2026. Pripremio: Claude Code. Issue #15. Grana `feature/faza-3b-sucelje-lika` nadograđuje se na 3a (PR #16, još nespojen); PR 3b uspoređuje se s granom 3a. Status: **čeka review i odobrenje vlasnika.** Deploy nije aktiviran; podaci kampanje nisu mijenjani.

## Isporučeno

- **HTTP sloj** (`src/app/api/campaigns/…`): `GET /api/campaigns`, `GET …/characters/:id/sheet`, `POST …/batches`, `GET …/batches/:batchId`. Sve mutacije idu isključivo kroz `executeBatch`.
- **Pristup dok O5 nije odlučen** (`src/server/app/access.ts`): `KDZ_AUTH_MODE=local-owner` — samo loopback host, jedan vlasnik; bez te postavke (npr. produkcijska slika) API vraća 503. Mutacije traže isti origin (CSRF) i JSON, tijelo do 256 KiB, `campaignId` u tijelu mora odgovarati adresi. `npm run dev` sluša samo na `127.0.0.1`.
- **Sučelje** (`src/components/sheet/*`, `/kampanja/:id/lik/:characterId`): kompaktno zaglavlje (HP, koncentracija, verzija), status upisa u live regionu (Provjera → Spremanje → „Spremljeno, verzija N” / Konflikt / Odbijeno / Veza prekinuta s gumbom „Ponovi isti zahtjev” koji šalje isti `batchId`), kartice Pregled, Borba, Oprema, Magija, Sposobnosti, Bilješke; objašnjenja izvedenih vrijednosti (otvaranje klikom/tipkovnicom, bez hovera); dijalozi za trajnu promjenu (razlog), bacanje (izričit izbor troška), podatke čarolije i pregled odmora; donja navigacija Igra/Lik/Dnevnik/Više na mobitelu (Igra i Dnevnik označeni „uskoro”).
- **Vizualni sustav:** vlastita paleta (pergament/tinta/bronca/zvono), serifni naslovi, bez dekorativnih okvira i bez tuđih asseta; mete dodira ≥ 44 px; vidljiv fokus.
- **Demo podaci:** `npm run dev:seed -- --db ./data/dev.db` (sintetička kampanja, bez stvarnih podataka).

## E2E (Playwright) — 13 scenarija × desktop 1280 px i 390 px = 26 testova

| Scenarij iz plana | Test |
|---|---|
| Promjena ability score-a s preračunom | „promjena atributa preračunava …” (CHA 14→16: mod, save, spell DC) |
| Šteta kroz temp HP; liječenje s granicom | „šteta prvo troši privremeni HP; liječenje ima granicu” |
| Nevaljani unos | „nevaljani unos se odbija bez upisa” |
| Potrošnja zadnjeg resursa | „potrošnja zadnjeg resursa” |
| Oprema iz spremnika | „oprema iz spremnika: izvadi pa opremi” |
| Transfer predmeta | „transfer predmeta NPC-u (spremnik nosi sadržaj)” |
| Priprema čarolije | „priprema čarolije” |
| Cast s odabranim troškom; concentration save | „bacanje s odabranim troškom i concentration save” |
| Pregled i potvrda odmora | „pregled i potvrda dugog odmora” |
| Ulazak u karticu/filter ne mutira | „ulazak u kartice … ne šalju nijednu promjenu” (nijedan ne-GET zahtjev) |
| Vidljivo stanje spremanja i konflikti | svi testovi čekaju „Spremljeno, verzija N”; „konflikt: zastarjela verzija …” |
| Tipkovnica | „tipkovnica: kartica, unos i radnja bez miša” |
| 390 px, bez horizontalnog skrola | „raspored: bez horizontalnog skrola; na mobitelu donja navigacija” |

Svaki test radi nad vlastitom sintetičkom kampanjom u svježoj privremenoj bazi (`scripts/e2e/serve.ts`), na `127.0.0.1`. Lokalno: 26/26. CI: novi job „E2E (Playwright, desktop i 390 px)”. Ukupno unit/DB: 158 testova (uključujući 3 za pristup API-ju).

## Što ne dokazuje

Stvarne iOS/Android uređaje i Safari (390 px je Chromium viewport), čitač zaslona i 200 % zoom (nije automatizirano), autentifikaciju i mrežni pristup (O5), Igru i Dnevnik (Faze 4–6).

## Raspored prema primjeru vlasnika (26. 11. 2026.)

Vlasnik je zatražio izgled prema `primjer dizajna ui.png` (snimka D&D Beyonda, lokalno, izvan Gita). Specifikacija §1 i analiza §10 zabranjuju preuzimanje kompozicije, okvira, pozadina i stila referentnog proizvoda, pa je do vlasnikove odluke primijenjena **opcija 1**: isti *raspored informacija* (gornja traka: šest atributa s velikim modifikatorom i vrijednošću, proficiency, brzina, inspiracija, AC, inicijativa i HP okvir s Liječenje/iznos/Šteta i trenutni/maks./privremeni; ispod tri stupca: saving throwovi i pasivna osjetila, tablica vještina s oznakom proficiencyja, radni panel s karticama), uz **vlastiti vizualni sustav** (pergament/tinta/bronca/zvono, bez crvenih ukrasnih okvira i pozadinske ilustracije, vlastiti nazivi i oznake ●/○/◆). Na mobitelu je radni panel odmah ispod HP-a, a saveovi, osjetila i vještine slijede. Dodane su pasivna istraga i pasivni uvid (izvedene vrijednosti s objašnjenjem). E2E: 26/26 nakon promjene.

## Izgled prema primjeru — odluka vlasnika (26. 11. 2026., ADR-0008)

Vlasnik je izabrao izgled prema svom primjeru i zatražio izmjenu specifikacije. Ažurirani su spec §1 i §3, analiza §10, README i NEDOSLJEDNOSTI (N15); dodan ADR-0008. Sheet sada ima tamnu gornju traku (inicijali, ime, razina, Kratki/Dugi odmor, verzija), stalno vidljiv status upisa, svijetlu pozadinu, bijele okvire s crvenim rubom, atribute s modifikatorom u kutiji i vrijednošću u ovalu, pokazatelje (proficiency, hodanje, heroic inspiracija), HP okvir (Liječenje / iznos / Šteta, trenutni / maks. / privremeni), inicijativu i oklop uz radni panel, saving throwove kao oznake s vrijednošću, osjetila s vrijednošću u ovalu, tablicu vještina (PROF · ATR · VJEŠTINA · BONUS) i radni panel s crvenom oznakom aktivne kartice. Sve je vlastiti kod i CSS; nisu preuzeti slike, ilustracije, logotipi, fontovi, ikone ni CSS referentnog proizvoda. E2E 26/26, ostali testovi 158/158.

## Codex i supervisor na `dd26802`

| Nalaz | Rješenje | Test |
|---|---|---|
| SUP-17-01 (Codex P2): `target.split(":", 2)` reže ID spremnika s dvotočkama (`container:DEMO-001-PC:item:pack` → `DEMO-001-PC`), pa premještanje u spremnik iz sučelja ne radi | `parseMoveTarget`: vrsta do prve dvotočke, ostatak je cijeli ID; nepoznata/nepotpuna vrijednost se ne šalje | unit „parseMoveTarget”; e2e „premjesti predmet u ruksak (ID spremnika s dvotočkama)” na desktopu i 390 px |
| SUP-17-02 (Codex P2): 2xx s nečitljivim tijelom briše čekajući batch i prikazuje „Spremljeno, verzija undefined” | `postBatch`: uspjeh tek s pročitanom verzijom; inače se potvrda dohvaća s `GET …/batches/:batchId`, a ako ni to ne uspije, ishod je nepoznat i ostaje isti batch za „Ponovi isti zahtjev” | unit „postBatch”: `json()` baca, potvrda dostupna / nedostupna / 404 / prekid veze, tijelo bez verzije, 503 busy, 409, 422 |

Mutacije i dalje idu samo kroz `POST …/batches` (`executeBatch`); ponavljanje šalje isti `batchId`. Lokalno: unit 33, DB 157, e2e 28/28.

## Supervisor na `cde88d0`

| Nalaz | Rješenje | Test |
|---|---|---|
| SUP-17-03: „samo loopback” oslanjao se na klijentov Host; `npm start` (`next start`) vezao se na sva sučelja, pa je zahtjev iz LAN-a s lažnim Host/Origin 127.0.0.1 dobivao vlasnički pristup | `npm run dev` / `npm start` idu kroz `scripts/app/launch.mjs`: bind na `127.0.0.1` (ili `KDZ_LISTEN_HOST`), a uz `local-owner` ne-loopback adresa odbija pokretanje. API u lokalnom načinu radi samo uz potvrđen loopback bind (`KDZ_LISTEN_HOST` iz pokretača, `HOSTNAME` nije ne-loopback); inače 503. Host provjera ostaje samo kao dodatna obrana i u kodu i README-u izričito nije sigurnosna granica. Po odluci vlasnika `local-owner` je u `.env.example` **isključen po zadanom** (zakomentiran, uz uputu). Nova arhitektura prijave nije uvedena (O5 otvoren) | unit „SUP-17-03”: lažni Host 127.0.0.1 bez potvrđenog binda (nepostavljeno, 0.0.0.0, LAN IP, ::) → 503; `HOSTNAME=0.0.0.0` → 503; pokretač odbija ne-loopback uz `local-owner`; ručno: `KDZ_AUTH_MODE=local-owner KDZ_LISTEN_HOST=0.0.0.0 npm start` izlazi s greškom |
| SUP-17-04 (Codex P2): nova radnja nakon „nepoznatog” ishoda prepisivala je ili brisala nerazriješeni batch | `BatchSender`: dok postoji nerazriješeni batch (nepoznat ishod ili zauzeta baza), nova radnja se ne šalje i prikazuje se poruka; kontrole lista zaključane su (`fieldset disabled`) dok se ne ponovi isti zahtjev (isti `batchId`); obavijest se ne može zatvoriti prije razrješenja | unit „BatchSender”: nepoznat ishod pa nova radnja (ništa se ne šalje, isti batch se ponavlja), busy pa 409; e2e „nepoznat ishod: radnje zaključane …” (desktop i 390 px) |

Lokalno: unit 37, e2e 30/30.
